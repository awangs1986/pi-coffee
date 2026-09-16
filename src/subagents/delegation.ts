import { subagentsAllowed } from "../harness/runtime-mode.js";
import { capabilityManifestRegistrations } from "../capabilities/registry.js";
import { readGlobalSubagentModel } from "./model-policy.js";
import { boundSubagentResult } from "./result-artifact.js";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_DELEGATION_CANCEL_EVENT,
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
  type SubagentDelegationRequest,
  type SubagentDelegationResponse,
} from "pi-subagents/delegation";

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const MAX_TASK_CHARS = 24_000;
const MAX_RESULT_CHARS = 3600;

export interface NativeSubagentInvocation {
  task: string;
  context: ExtensionContext;
  signal?: AbortSignal;
  agent?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Invoke the loaded pi-subagents executor through its documented in-process
 * delegation bus. This keeps the Web extension independent of the private
 * ToolDefinition object and gives the request an explicit cancellation and
 * terminal-response identity.
 */
export async function invokeNativeSubagent(
  pi: ExtensionAPI,
  input: NativeSubagentInvocation,
): Promise<string | undefined> {
  if (!subagentsAllowed(pi)) throw new Error("Subagents are disabled in Simple/Lean; switch to Full to delegate.");
  if (process.env.PI_SUBAGENT_CHILD === "1") throw new Error("Research children cannot delegate recursively");
  if (input.signal?.aborted) return undefined;
  if (!capabilityManifestRegistrations(pi).some(r => r.manifest.id === "subagent" && r.manifest.runnerConformance === "passed" && r.conformanceSource === "local")) return undefined;
  const configuredModel = input.model ?? await readGlobalSubagentModel();
  if (input.signal?.aborted) return undefined;
  const requestId = randomUUID();
  const ownerRunId = `pi-coffee-web-${randomUUID()}`;
  const nodeId = "research-brief";
  const request: SubagentDelegationRequest = {
    requestId,
    ownerRunId,
    nodeId,
    agent: input.agent?.trim() || process.env.PI_COFFEE_WEB_SUBAGENT_AGENT?.trim() || "coffee-research",
    task: input.task.slice(0, MAX_TASK_CHARS),
    ...(configuredModel ? { model: configuredModel } : {}),
    context: "fresh",
    cwd: input.context.cwd,
    timeoutMs: clampTimeout(input.timeoutMs),
    toolBudget: { hard: 24, block: ["subagent", "bg_wait"] },
    artifacts: true,
    result: { kind: "text" },
  };

  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;

    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      removeAbort?.();
      unsubscribe();
      resolve(value === undefined ? undefined : boundSubagentResult(value).content[0].text.slice(0, MAX_RESULT_CHARS));
    };

    const unsubscribe = pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
      const response = payload as SubagentDelegationResponse;
      if (!isMatchingResponse(response, request)) return;
      if (response.status !== "completed" || response.result?.kind !== "text") {
        finish(undefined);
        return;
      }
      finish(response.result.text);
    });

    const cancel = (): void => {
      pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
        requestId,
        ownerRunId,
        nodeId,
      });
      finish(undefined);
    };
    if (input.signal !== undefined) {
      if (input.signal.aborted) {
        cancel();
        return;
      }
      input.signal.addEventListener("abort", cancel, { once: true });
      removeAbort = () => input.signal?.removeEventListener("abort", cancel);
    }

    timer = setTimeout(() => {
      cancel();
    }, request.timeoutMs);
    timer.unref?.();
    pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
  });
}

function isMatchingResponse(
  response: SubagentDelegationResponse,
  request: SubagentDelegationRequest,
): boolean {
  return response.requestId === request.requestId
    && response.ownerRunId === request.ownerRunId
    && response.nodeId === request.nodeId;
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(value, 20 * 60_000));
}
