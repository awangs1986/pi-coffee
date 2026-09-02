import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, SessionManager } from "@earendil-works/pi-coding-agent";
import type { HistoryEntry, ImageInput, JsonValue, SessionState, SessionSummary } from "../shared/protocol.js";

export interface PiHistory {
  entries: HistoryEntry[];
  leafId: string | null;
}

/** A conversation known to the durable session store; `running` is added by the Host. */
export type PiSessionListing = Omit<SessionSummary, "running">;

/**
 * The only Pi-specific seam in PI Coffee.  The Host and Web Server depend on
 * this small interface rather than on Pi's SDK or RPC implementation.
 */
export interface PiSession {
  prompt(text: string, images?: ImageInput[]): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<SessionState>;
  /** Completed conversation entries from the durable session, display-ready. */
  getHistory(): Promise<PiHistory>;
  onEvent(listener: (event: unknown) => void): () => void;
  stop(): Promise<void>;
}

export interface PiSessionFactory {
  /** Start (or resume, when the store already has it) the session with this id. */
  create(options: { sessionId: string }): Promise<PiSession>;
  /** Conversations in the durable store, newest first. */
  list(): Promise<PiSessionListing[]>;
}

export interface RpcPiSessionFactoryOptions {
  cwd?: string;
  agentDir?: string;
  sessionDir?: string;
  cliPath?: string;
  provider?: string;
  model?: string;
  args?: string[];
  /** Additional native Pi extensions loaded for every Host session. */
  extensions?: string[];
  env?: Record<string, string>;
}

/** Adapter around the original Pi agent's documented RPC client. */
export class RpcPiSessionFactory implements PiSessionFactory {
  private readonly options: RpcPiSessionFactoryOptions;

  constructor(options: RpcPiSessionFactoryOptions = {}) {
    this.options = options;
  }

  async create(options: { sessionId: string }): Promise<PiSession> {
    const args = appendExtensionArgs([...(this.options.args ?? [])], this.options.extensions ?? []);
    // Resume from the durable store when the conversation already exists there;
    // only a genuinely new conversation gets a fresh file with our id.
    const existing = (await this.listWithPaths()).find((session) => session.id === options.sessionId);
    if (!args.includes("--session") && !args.includes("--session-id")) {
      if (existing?.path !== undefined) args.push("--session", existing.path);
      else args.push("--session-id", options.sessionId);
    }
    if (this.options.sessionDir !== undefined) {
      args.push("--session-dir", this.options.sessionDir);
    }
    const client = new RpcClient({
      cliPath: this.options.cliPath ?? resolvePiCliPath(),
      cwd: this.options.cwd,
      provider: this.options.provider,
      model: this.options.model,
      env: {
        ...(this.options.agentDir === undefined ? {} : { PI_CODING_AGENT_DIR: this.options.agentDir }),
        ...this.options.env,
      },
      args,
    });
    const session = new RpcPiSession(client);
    await session.start();
    return session;
  }

  async list(): Promise<PiSessionListing[]> {
    return (await this.listWithPaths()).map(({ path: _path, ...listing }) => listing);
  }

  /**
   * Reads Pi's own session store (one JSONL file per conversation). The Host
   * runs beside Pi in the User VM, so this is the same filesystem Pi writes
   * to; nothing here is ever copied off the VM except the summaries.
   */
  private async listWithPaths(): Promise<Array<PiSessionListing & { path: string }>> {
    const sessionDir = this.options.sessionDir;
    let infos: Awaited<ReturnType<typeof SessionManager.listAll>>;
    try {
      infos = sessionDir === undefined
        ? await SessionManager.list(this.options.cwd ?? process.cwd())
        : await SessionManager.listAll(sessionDir);
    } catch {
      // A missing or empty store is an empty list, not a broken Host.
      return [];
    }
    return infos
      .map((info) => ({
        id: info.id,
        ...(info.name === undefined || info.name.length === 0 ? {} : { name: info.name }),
        createdAt: info.created.toISOString(),
        updatedAt: info.modified.toISOString(),
        messageCount: info.messageCount,
        preview: info.firstMessage.replace(/\s+/g, " ").trim().slice(0, 120),
        path: info.path,
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }
}

/** Add `--extension path` pairs without duplicating explicitly supplied paths. */
export function appendExtensionArgs(args: string[], extensions: readonly string[]): string[] {
  for (const extension of extensions) {
    const trimmed = extension.trim();
    if (trimmed.length === 0) continue;
    const alreadyPresent = args.some((arg, index) =>
      (arg === "--extension" || arg === "-e") && args[index + 1] === trimmed,
    ) || args.includes(`--extension=${trimmed}`);
    if (!alreadyPresent) args.push("--extension", trimmed);
  }
  return args;
}

class RpcPiSession implements PiSession {
  private readonly client: RpcClient;
  private readonly listeners = new Set<(event: unknown) => void>();
  private unsubscribe?: () => void;

  constructor(client: RpcClient) {
    this.client = client;
    this.unsubscribe = client.onEvent((event) => {
      for (const listener of this.listeners) listener(event);
    });
  }

  async start(): Promise<void> {
    try {
      await this.client.start();
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      throw error;
    }
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {
    // The RPC package's wire image shape is intentionally the same compact
    // shape used by PI Coffee.  Keep the cast local to this adapter.
    await this.client.prompt(text, images as never);
  }

  async abort(): Promise<void> {
    await this.client.abort();
  }

  async getState(): Promise<SessionState> {
    const state = await this.client.getState();
    return {
      isStreaming: state.isStreaming,
      messageCount: state.messageCount,
      ...(state.sessionName === undefined ? {} : { sessionName: state.sessionName }),
    };
  }

  async getHistory(): Promise<PiHistory> {
    const result = await this.client.getEntries();
    return projectHistory(result.entries as unknown[], result.leafId ?? null);
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
    await this.client.stop();
  }
}

const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * Turn Pi's append-only entry tree into the flat, display-ready list the
 * browser renders. Follows the active branch (leaf → root) so abandoned
 * branches are not shown; compactions stay visible as notes because the user
 * asked to see the whole past conversation, not the model's current context.
 */
export function projectHistory(rawEntries: unknown[], leafId: string | null): PiHistory {
  const entries = rawEntries.filter(isRecord);
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);

  let path: Record<string, unknown>[];
  if (leafId !== null && byId.has(leafId)) {
    path = [];
    let current: Record<string, unknown> | undefined = byId.get(leafId);
    const seen = new Set<string>();
    while (current && typeof current.id === "string" && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
    }
    path.reverse();
  } else {
    path = entries;
  }

  const out: HistoryEntry[] = [];
  const toolsByCallId = new Map<string, Extract<HistoryEntry, { kind: "tool" }>>();
  for (const entry of path) {
    const id = typeof entry.id === "string" ? entry.id : `entry-${out.length}`;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    const stamp = at === undefined ? {} : { at };
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      const content = message.content;
      if (message.role === "user") {
        out.push({ kind: "user", id, ...stamp, text: textOf(content), ...imageCount(content) });
      } else if (message.role === "assistant") {
        const text = textOf(content);
        if (text.length > 0) out.push({ kind: "assistant", id, ...stamp, text });
        for (const block of blocksOf(content)) {
          if (block.type !== "toolCall" && block.type !== "tool_call") continue;
          const callId = stringOr(block.toolCallId, stringOr(block.id, `${id}-tool-${toolsByCallId.size}`));
          const tool: Extract<HistoryEntry, { kind: "tool" }> = {
            kind: "tool",
            id: callId,
            ...stamp,
            name: stringOr(block.toolName, stringOr(block.name, "tool")),
            args: toJson(block.input ?? block.arguments ?? null),
          };
          toolsByCallId.set(callId, tool);
          out.push(tool);
        }
      } else if (message.role === "toolResult" || message.role === "tool_result") {
        const callId = stringOr(message.toolCallId, "");
        const tool = toolsByCallId.get(callId);
        const result = textOf(content).slice(0, MAX_TOOL_RESULT_CHARS);
        if (tool) {
          tool.result = result;
          tool.isError = message.isError === true;
        } else {
          out.push({ kind: "tool", id, ...stamp, name: stringOr(message.toolName, "tool"), args: null, result, isError: message.isError === true });
        }
      } else if ((message.role === "custom" || message.role === "customMessage") && message.display === true) {
        const text = textOf(content);
        if (text.length > 0) out.push({ kind: "note", id, ...stamp, text });
      }
    } else if (entry.type === "compaction") {
      out.push({ kind: "note", id, ...stamp, text: "会话上下文已压缩；更早的消息仍保留在这里，但模型只看到摘要。" });
    } else if (entry.type === "branch_summary") {
      out.push({ kind: "note", id, ...stamp, text: "已从此处切换分支。" });
    }
  }
  return { entries: out, leafId };
}

function blocksOf(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function imageCount(content: unknown): { imageCount?: number } {
  const count = blocksOf(content).filter((block) => block.type === "image").length;
  return count > 0 ? { imageCount: count } : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function toJson(value: unknown, depth = 0): JsonValue {
  if (depth > 12) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => toJson(item, depth + 1));
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = toJson(item, depth + 1);
    return output;
  }
  return value === undefined ? null : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePiCliPath(): string {
  // The published Pi package ships the CLI bundle beside its main module.
  // Keeping resolution here means the rest of the Host does not know how Pi
  // is installed (npm, pnpm, or a future vendored adapter).
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(packageEntry), "bundle", "cli.js");
}
