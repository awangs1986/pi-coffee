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

export type GitAction = "status" | "diff";

/** Read-only inspection of the task's native Git clone. Mutations use explicit Bash workflows. */
export function createNativeGitTool(options: GitToolOptions): ToolDefinition {
  const maxOutputBytes = options.maxOutputBytes ?? 32_000;

  return {
    name: "git",
    label: "Git",
    description: "Inspect Git status and staged/unstaged diffs in the current task directory. Use Bash for explicit Git mutations and publishing.",
    promptSnippet: "Inspect Git status or diff when the task needs repository state.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("status"), Type.Literal("diff")]),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = workspaceOf(ctx);
      const action = String((params as unknown as {action: unknown}).action);
      if (action === "status") return status(options.run, cwd, signal, maxOutputBytes);
      if (action === "diff") return diff(options.run, cwd, signal, maxOutputBytes);
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
    isError: true,
    content: [{
      type: "text",
      text: `not-supported: ${action}. This tool only provides read-only status and diff. Use Bash for explicit Git mutations and publishing.`,
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
  isError?: boolean;
  content: [{ type: "text"; text: string }];
  details: Record<string, unknown>;
}
