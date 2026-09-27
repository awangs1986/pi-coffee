import { resolve } from "node:path";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface NativeCommandResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export interface NativeCommandOptions {
  cwd: string;
  signal?: AbortSignal;
  timeout?: number;
}

export type NativeCommandRunner = (
  command: string,
  args: string[],
  options: NativeCommandOptions,
) => Promise<NativeCommandResult>;

export interface GitToolOptions {
  run: NativeCommandRunner;
  maxOutputBytes?: number;
}

export type GitAction = "status" | "diff" | "checkpoint" | "undo" | "worktree" | "transfer" | "adopt";

/**
 * V5-compatible `git` tool surface backed by the User VM's native git.
 *
 * V5's implementation is a managed-snapshot engine coupled to Guard and
 * permission grants.  PI Coffee deliberately has none of those mechanisms:
 * VM snapshots and publishing remain owner-controlled.  Read-only status and
 * diff, plus an explicit native worktree add/list path, are implemented here;
 * snapshot/transfer/adoption actions return a truthful not-supported result.
 */
export function createNativeGitTool(options: GitToolOptions): ToolDefinition {
  const maxOutputBytes = options.maxOutputBytes ?? 32_000;

  return {
    name: "git",
    label: "Git",
    description:
      "Inspect the User VM's native Git workspace (status and diff) and manage native worktrees. " +
      "Checkpoint, undo, transfer, and adopt are unsupported legacy actions; use native Git and explicit user-authorized workflows.",
    promptSnippet: "Inspect Git status or diff when the task needs repository state.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("diff"),
        Type.Literal("checkpoint"),
        Type.Literal("undo"),
        Type.Literal("worktree"),
        Type.Literal("transfer"),
        Type.Literal("adopt"),
      ]),
      op: Type.Optional(Type.String({ description: "worktree operation: list | register | register-workspace | lease | release" })),
      path: Type.Optional(Type.String({ description: "native worktree path" })),
      worktree_id: Type.Optional(Type.String()),
      transfer_id: Type.Optional(Type.String()),
      dry_run: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = workspaceOf(ctx);
      const input = params as unknown as {
        action: GitAction;
        op?: string;
        path?: string;
      };
      const action = input.action;
      if (action === "status") return status(options.run, cwd, signal, maxOutputBytes);
      if (action === "diff") return diff(options.run, cwd, signal, maxOutputBytes);
      if (action === "worktree") {
        return worktree(options.run, cwd, signal, {
          op: input.op,
          path: input.path,
          maxOutputBytes,
        });
      }
      return unsupported(action);
    },
  };
}

function workspaceOf(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

async function status(
  run: NativeCommandRunner,
  cwd: string,
  signal: AbortSignal | undefined,
  maxOutputBytes: number,
): Promise<ToolResult> {
  const result = await safeRun(run, "git", ["status", "--short", "--branch"], { cwd, signal, timeout: 15_000 });
  return commandResult("status", result, maxOutputBytes, result.code === 0 ? "native-git" : "not-a-git-workspace");
}

async function diff(
  run: NativeCommandRunner,
  cwd: string,
  signal: AbortSignal | undefined,
  maxOutputBytes: number,
): Promise<ToolResult> {
  const [unstaged, staged] = await Promise.all([
    safeRun(run, "git", ["diff", "--no-ext-diff", "--"], { cwd, signal, timeout: 30_000 }),
    safeRun(run, "git", ["diff", "--cached", "--no-ext-diff", "--"], { cwd, signal, timeout: 30_000 }),
  ]);
  const combined = [
    unstaged.stdout.trim(),
    staged.stdout.trim(),
  ].filter((part) => part.length > 0).join("\n\n");
  const errors = [unstaged.stderr.trim(), staged.stderr.trim()].filter((part) => part.length > 0).join("\n");
  const code = unstaged.code !== 0 ? unstaged.code : staged.code;
  const text = combined || (errors ? errors : "no changes");
  return {
    content: [{ type: "text", text: cap(text, maxOutputBytes) }],
    details: {
      backend: "native-git",
      action: "diff",
      code,
      killed: unstaged.killed || staged.killed,
      hasChanges: combined.length > 0,
      ...(errors.length === 0 ? {} : { stderr: cap(errors, maxOutputBytes) }),
    },
  };
}

async function worktree(
  run: NativeCommandRunner,
  cwd: string,
  signal: AbortSignal | undefined,
  input: { op?: string; path?: string; maxOutputBytes: number },
): Promise<ToolResult> {
  const op = (input.op ?? "list").toLowerCase();
  if (op === "list") {
    const result = await safeRun(run, "git", ["worktree", "list", "--porcelain"], { cwd, signal, timeout: 15_000 });
    return commandResult("worktree list", result, input.maxOutputBytes, "native-git");
  }
  if (op === "register") {
    const rawPath = input.path?.trim();
    if (!rawPath) return unsupported("worktree register (path is required)");
    const target = resolve(cwd, rawPath);
    const result = await safeRun(run, "git", ["worktree", "add", "--detach", target, "HEAD"], { cwd, signal, timeout: 60_000 });
    return commandResult(`worktree register ${target}`, result, input.maxOutputBytes, "native-git");
  }
  if (op === "register-workspace") {
    return unsupported("worktree register-workspace (no PI Coffee registry)");
  }
  if (op === "lease" || op === "release") {
    return unsupported(`worktree ${op} (native Git has no lease service)`);
  }
  return unsupported(`worktree ${op}`);
}

async function safeRun(
  run: NativeCommandRunner,
  command: string,
  args: string[],
  options: NativeCommandOptions,
): Promise<NativeCommandResult> {
  try {
    return await run(command, args, options);
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      code: -1,
      killed: false,
    };
  }
}

function commandResult(action: string, result: NativeCommandResult, maxOutputBytes: number, backend: string): ToolResult {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const text = stdout || stderr || (result.code === 0 ? "ok" : `command failed with exit code ${result.code}`);
  return {
    content: [{ type: "text", text: cap(text, maxOutputBytes) }],
    details: {
      backend,
      action,
      code: result.code,
      killed: result.killed,
      ...(stderr.length === 0 ? {} : { stderr: cap(stderr, maxOutputBytes) }),
    },
  };
}

function unsupported(action: string): ToolResult {
  return {
    content: [{
      type: "text",
      text: `not-supported: ${action}. This adapter only provides native status, diff, and basic worktree operations.`,
    }],
    details: { backend: "native-git", status: "not-supported", action },
  };
}

function cap(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return value;
  return `${Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8")}\n…[truncated]`;
}

interface ToolResult {
  content: [{ type: "text"; text: string }];
  details: Record<string, unknown>;
}
