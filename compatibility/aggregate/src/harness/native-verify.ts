import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { NativeCommandResult, NativeCommandRunner } from "./native-git.js";

export type VerifyProfile = "none" | "quick" | "tdd";
export type VerifyStatus = "passed" | "failed" | "not_run";

export interface VerifyCommand {
  name: string;
  command: string;
  timeoutMs?: number;
  matchCountPattern?: string;
}

export interface VerifyCommandResult {
  name: string;
  status: VerifyStatus;
  code: number;
  detail: string;
  durationMs: number;
}

export interface VerifyRun {
  profile: VerifyProfile;
  overall: VerifyStatus;
  configPath: string;
  commands: VerifyCommandResult[];
  startedAt: string;
}

export interface VerifyWorkspaceState {
  profile: VerifyProfile;
  lastRun?: VerifyRun;
}

export interface VerifyStateStore {
  get(cwd: string): VerifyWorkspaceState;
  set(cwd: string, state: VerifyWorkspaceState): void;
}

export interface VerifyToolOptions {
  run: NativeCommandRunner;
  state: VerifyStateStore;
  persist?: (cwd: string, state: VerifyWorkspaceState) => void;
  maxOutputBytes?: number;
}

const CONFIG_RELATIVE_PATH = join(".picode", "verify.json");
const TDD_ACTIONS = new Set([
  "tdd_status",
  "tdd_start",
  "tdd_red",
  "tdd_green",
  "tdd_refactor",
  "tdd_gate",
  "tdd_review",
  "tdd_smoke",
  "tdd_complete",
  "tdd_budget",
  "tdd_abandon",
  "qa_handoff",
]);

/**
 * V5-compatible `verify` tool surface with an intentionally small native
 * runner.  The command definition lives in the User VM and is executed by
 * that VM's shell.  V5 trust gates, Guard decisions, Gate Evidence,
 * Completion Labels, and the Devloop state machine are not recreated.
 */
export function createNativeVerifyTool(options: VerifyToolOptions): ToolDefinition {
  const maxOutputBytes = options.maxOutputBytes ?? 24_000;
  return {
    name: "verify",
    label: "Verify",
    description:
      "Run the selected commands from .picode/verify.json in the User VM and report passed, failed, or not_run. " +
      "Verification reports observed results; it is not an automatic completion gate. TDD state-machine actions are unsupported.",
    promptSnippet: "Run the project's configured verification commands when evidence is needed.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("run"),
        Type.Literal("complete"),
        Type.Literal("tdd_status"),
        Type.Literal("tdd_start"),
        Type.Literal("tdd_red"),
        Type.Literal("tdd_green"),
        Type.Literal("tdd_refactor"),
        Type.Literal("tdd_gate"),
        Type.Literal("tdd_review"),
        Type.Literal("tdd_smoke"),
        Type.Literal("tdd_complete"),
        Type.Literal("tdd_budget"),
        Type.Literal("tdd_abandon"),
        Type.Literal("qa_handoff"),
      ]),
      objective: Type.Optional(Type.String()),
      reviewer: Type.Optional(Type.String()),
      verdict: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()),
      extra: Type.Optional(Type.Number()),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = workspaceOf(ctx);
      const input = params as unknown as { action: string };
      const action = input.action;
      if (action === "status") return statusResult(cwd, options.state.get(cwd), maxOutputBytes);
      if (action === "run") {
        const run = await executeProfile(cwd, options.state, options.persist, options.run, signal, maxOutputBytes);
        return textResult(renderRun(run), run);
      }
      if (action === "complete") {
        const state = options.state.get(cwd);
        const run = state.lastRun;
        const facts = run
          ? `${run.overall}; ${run.commands.filter((command) => command.status === "passed").length}/${run.commands.length} command(s) passed`
          : "not_run; no verification result exists";
        return textResult(`completion: ${facts} (observed checks only; not an automatic completion gate)`, { profile: state.profile, run });
      }
      if (TDD_ACTIONS.has(action)) {
        return textResult(
          `not-supported: ${action}. TDD is guidance, not an enforced state machine. Run the configured profile with action=run instead.`,
          { status: "not-supported", action },
        );
      }
      return textResult(`unknown action '${action}'`, { status: "not-supported", action });
    },
  };
}

export function createMemoryVerifyState(initialProfile: VerifyProfile = "none"): VerifyStateStore {
  const states = new Map<string, VerifyWorkspaceState>();
  return {
    get(cwd) {
      return states.get(cwd) ?? { profile: initialProfile };
    },
    set(cwd, state) {
      states.set(cwd, state);
    },
  };
}

export async function executeProfile(
  cwd: string,
  stateStore: VerifyStateStore,
  persist: ((cwd: string, state: VerifyWorkspaceState) => void) | undefined,
  run: NativeCommandRunner,
  signal: AbortSignal | undefined,
  maxOutputBytes = 24_000,
): Promise<VerifyRun> {
  const state = stateStore.get(cwd);
  const profile = state.profile;
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);
  const config = readConfig(configPath);
  const commands = config === undefined ? [] : commandsFor(config, profile);
  const startedAt = new Date().toISOString();
  const results: VerifyCommandResult[] = [];

  if (profile !== "none" && commands.length > 0) {
    for (const command of commands) {
      if (signal?.aborted) {
        results.push({
          name: command.name,
          status: "not_run",
          code: -1,
          detail: "aborted before execution",
          durationMs: 0,
        });
        continue;
      }
      results.push(await runOne(cwd, command, run, signal, maxOutputBytes));
    }
  }

  const overall: VerifyStatus =
    profile === "none" || config === undefined || commands.length === 0
      ? "not_run"
      : results.every((result) => result.status === "passed")
        ? "passed"
        : "failed";
  const result: VerifyRun = { profile, overall, configPath, commands: results, startedAt };
  const next = { ...state, lastRun: result };
  stateStore.set(cwd, next);
  persist?.(cwd, next);
  return result;
}

export function setVerifyProfile(
  cwd: string,
  profile: VerifyProfile,
  stateStore: VerifyStateStore,
  persist?: (cwd: string, state: VerifyWorkspaceState) => void,
): VerifyWorkspaceState {
  const next = { ...stateStore.get(cwd), profile };
  stateStore.set(cwd, next);
  persist?.(cwd, next);
  return next;
}

export function renderVerifyStatus(cwd: string, state: VerifyWorkspaceState): string {
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);
  const configured = readConfig(configPath) !== undefined;
  return [
    `profile: ${state.profile} | configured: ${configured ? `yes (${CONFIG_RELATIVE_PATH})` : `no (${CONFIG_RELATIVE_PATH} missing or invalid)`}`,
    state.lastRun ? renderRun(state.lastRun) : "no runs recorded (not_run)",
  ].join("\n");
}

function statusResult(cwd: string, state: VerifyWorkspaceState, maxOutputBytes: number): ToolResult {
  return textResult(cap(renderVerifyStatus(cwd, state), maxOutputBytes), {
    profile: state.profile,
    configured: readConfig(join(cwd, CONFIG_RELATIVE_PATH)) !== undefined,
    lastRun: state.lastRun,
  });
}

function renderRun(run: VerifyRun): string {
  const lines = [`verify [${run.profile}] overall: ${run.overall}`];
  for (const command of run.commands) {
    lines.push(`  ${command.status.padEnd(8)} ${command.name}: ${command.detail}`);
  }
  if (run.commands.length === 0) lines.push("  (no commands configured — configure .picode/verify.json)");
  return lines.join("\n");
}

async function runOne(
  cwd: string,
  command: VerifyCommand,
  run: NativeCommandRunner,
  signal: AbortSignal | undefined,
  maxOutputBytes: number,
): Promise<VerifyCommandResult> {
  const started = Date.now();
  let result: NativeCommandResult;
  try {
    result = await run("bash", ["-lc", command.command], {
      cwd,
      signal,
      timeout: command.timeoutMs ?? 120_000,
    });
  } catch (error) {
    return {
      name: command.name,
      status: "failed",
      code: -1,
      detail: cap(error instanceof Error ? error.message : String(error), maxOutputBytes),
      durationMs: Date.now() - started,
    };
  }

  const output = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join("\n");
  let status: VerifyStatus = result.code === 0 && !result.killed ? "passed" : "failed";
  let detail = output || (status === "passed" ? "ok" : `exit ${result.code}`);
  if (command.matchCountPattern !== undefined) {
    try {
      const matches = output.match(new RegExp(command.matchCountPattern, "g")) ?? [];
      if (matches.length === 0) status = "failed";
      detail = `${detail} (${matches.length} match(es))`;
    } catch {
      status = "failed";
      detail = `${detail} (invalid matchCountPattern)`;
    }
  }
  return {
    name: command.name,
    status,
    code: result.code,
    detail: cap(detail, maxOutputBytes),
    durationMs: Date.now() - started,
  };
}

function commandsFor(config: unknown, profile: VerifyProfile): VerifyCommand[] {
  if (!isRecord(config)) return [];
  const raw = config[profile];
  if (profile === "tdd" && isRecord(raw)) {
    const merged: unknown[] = [];
    if (raw.gate !== undefined) merged.push(raw.gate);
    if (raw.smoke !== undefined) merged.push(...(Array.isArray(raw.smoke) ? raw.smoke : [raw.smoke]));
    return normalizeCommands(merged, "tdd");
  }
  return normalizeCommands(Array.isArray(raw) ? raw : raw === undefined ? [] : [raw], profile);
}

function normalizeCommands(raw: unknown[], profile: string): VerifyCommand[] {
  const commands: VerifyCommand[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      commands.push({ name: `${profile}-${index + 1}`, command: entry });
      return;
    }
    if (!isRecord(entry) || typeof entry.command !== "string" || entry.command.trim().length === 0) return;
    commands.push({
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : `${profile}-${index + 1}`,
      command: entry.command,
      ...(typeof entry.timeoutMs === "number" && Number.isFinite(entry.timeoutMs) ? { timeoutMs: Math.max(1, entry.timeoutMs) } : {}),
      ...(typeof entry.matchCountPattern === "string" ? { matchCountPattern: entry.matchCountPattern } : {}),
    });
  });
  return commands;
}

function readConfig(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function workspaceOf(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function textResult(text: string, details: unknown): ToolResult {
  return { content: [{ type: "text", text }], details };
}

function cap(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return `${Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8")}\n…[truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ToolResult {
  content: [{ type: "text"; text: string }];
  details: unknown;
}
