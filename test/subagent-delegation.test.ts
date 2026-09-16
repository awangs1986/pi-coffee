import { registerCapabilityManifest } from "../src/capabilities/registry.js";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DELEGATION_CANCEL_EVENT, SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "pi-subagents/delegation";
import { invokeNativeSubagent } from "../src/subagents/delegation.js";

class Events {
  private readonly handlers = new Map<string, Set<(value: unknown) => void>>();

  on(channel: string, handler: (value: unknown) => void): () => void {
    const set = this.handlers.get(channel) ?? new Set<(value: unknown) => void>();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => set.delete(handler);
  }

  emit(channel: string, value: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(value);
  }
}

function nativePi(events: Events): ExtensionAPI {
  const pi = { events } as unknown as ExtensionAPI;
  registerCapabilityManifest(pi, { conformanceSource: "local", manifest: {
    id: "subagent", kind: "pi-extension", origin: "suite", title: "Native subagents", summary: "Test executor",
    keywords: [], tools: [], supportedHarness: ["simple", "full"], permissionSummary: "VM", runnerConformance: "passed",
  } });
  return pi;
}

describe("native pi-subagents delegation adapter", () => {
  it("fails immediately when the metered executor is not registered", async () => {
    const events = new Events(); let dispatched = false;
    events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, () => { dispatched = true; });
    expect(await invokeNativeSubagent({ events } as unknown as ExtensionAPI, { task: "q", context: { cwd: "/workspace" } as never })).toBeUndefined();
    expect(dispatched).toBe(false);
  });
  it("does not launch or cancel unrelated work for a pre-aborted request", async () => {
    const events = new Events(); let dispatched = false;
    events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, () => { dispatched = true; });
    expect(await invokeNativeSubagent(nativePi(events), { task: "q", context: { cwd: "/workspace" } as never, signal: AbortSignal.abort() })).toBeUndefined();
    expect(dispatched).toBe(false);
  });
  it("uses fresh research with bounded real tool access and no recursive delegation", async () => {
    const events = new Events();
    events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (value: any) => {
      expect(value.context).toBe("fresh");
      expect(value.result).toEqual({ kind: "text" });
      expect(value.toolBudget).toEqual({ hard: 24, block: ["subagent", "bg_wait"] });
      expect(value.model).toBe("provider/research-model");
      events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
        requestId: value.requestId,
        ownerRunId: value.ownerRunId,
        nodeId: value.nodeId,
        status: "completed",
        result: { kind: "text", text: "brief" },
      });
    });
    const result = await invokeNativeSubagent(nativePi(events), {
      task: "search for evidence",
      model: "provider/research-model",
      context: { cwd: "/workspace" } as never,
    });
    expect(result).toBe("brief");
  });

  it("cancels a pending request when its signal aborts", async () => {
    const events = new Events();
    let cancelled = false;
    events.on(SUBAGENT_DELEGATION_CANCEL_EVENT, () => { cancelled = true; });
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, started);
    const resultPromise = invokeNativeSubagent(nativePi(events), {
      task: "wait",
      context: { cwd: "/workspace" } as never,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    await ready;
    controller.abort();
    expect(await resultPromise).toBeUndefined();
    expect(cancelled).toBe(true);
  });
});
