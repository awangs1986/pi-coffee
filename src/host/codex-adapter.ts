import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type {
  CommandInfo,
  ExtensionInfo,
  HistoryEntry,
  ImageInput,
  JsonValue,
  SessionState,
  SessionStats,
  UiResponse,
} from "../shared/protocol.js";
import {
  buildHostChildEnv,
  type PiHistory,
  type PiModels,
  type PiSession,
  type PiSessionFactory,
  type PiSessionListing,
} from "./pi-adapter.js";

/**
 * Codex CLI behind the same seam as the original Pi (ADR-0011).
 *
 * `codex app-server` speaks newline-delimited JSON-RPC on stdio. One server
 * process serves one Browser User (one factory = one cwd); each conversation
 * is a Codex *thread*. Everything the Host and browser see is translated into
 * the small Pi event vocabulary the shell already renders — `agent_start`,
 * `message_update` deltas, `tool_execution_start/end`, `message_end`,
 * `agent_settled`, `extension_ui_request` — so nothing above this file knows
 * which agent is running.
 *
 * Login is Codex's own (`codex login` once in the VM, credentials in
 * `CODEX_HOME`); every user's server process shares it.
 */
export interface CodexSessionFactoryOptions {
  /** The user's working directory; also the `thread/list` filter. */
  cwd: string;
  /** `codex` executable; `codex` on PATH by default. */
  cliPath?: string;
  /** Shared Codex home (auth, config, session rollouts); Codex's default when omitted. */
  codexHome?: string;
  model?: string;
  reasoningEffort?: string;
  /** Codex sandbox for the agent's own tools; full access mirrors Pi's Execution Seam (ADR-0005). */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /** `never` runs unattended; `on-request` / `untrusted` route approvals to the browser as confirm dialogs. */
  approvalPolicy?: "never" | "on-request" | "untrusted";
  /** Extra `codex app-server` arguments (e.g. `-c key=value`). */
  args?: string[];
  env?: Record<string, string>;
  /** Where PI Coffee session ids that predate their Codex thread are remembered. */
  mappingFile?: string;
  clientName?: string;
  clientVersion?: string;
}

interface RpcError { code?: number; message: string }

type Json = JsonValue;
type Obj = { [key: string]: Json };

/** A server-initiated request we owe an answer to (approvals). */
interface PendingServerRequest {
  id: Json;
  method: string;
  params: Obj;
}

/** Codex thread ids are UUIDs; anything else is a PI Coffee id that still needs a thread. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CodexSessionFactory implements PiSessionFactory {
  private readonly options: CodexSessionFactoryOptions;
  private server?: CodexAppServer;
  private readonly mappingFile: string;
  /** PI Coffee session id → Codex thread id, for conversations the Host named before Codex did. */
  private mapping?: Map<string, string>;

  constructor(options: CodexSessionFactoryOptions) {
    this.options = options;
    this.mappingFile = options.mappingFile ?? join(options.cwd, ".pi-coffee", "codex-threads.json");
  }

  private async connection(): Promise<CodexAppServer> {
    if (this.server && this.server.alive) return this.server;
    const args = ["app-server", ...(this.options.args ?? [])];
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...buildHostChildEnv(this.options.env),
      ...(this.options.codexHome === undefined ? {} : { CODEX_HOME: this.options.codexHome }),
    };
    const server = new CodexAppServer({
      cliPath: this.options.cliPath ?? "codex",
      args,
      cwd: this.options.cwd,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    });
    await server.start(this.options.clientName ?? "pi_coffee", this.options.clientVersion ?? "0.1.0");
    this.server = server;
    return server;
  }

  private async loadMapping(): Promise<Map<string, string>> {
    if (this.mapping) return this.mapping;
    try {
      const parsed = JSON.parse(await readFile(this.mappingFile, "utf8")) as Record<string, string>;
      this.mapping = new Map(Object.entries(parsed).filter(([k, v]) => typeof k === "string" && typeof v === "string"));
    } catch {
      this.mapping = new Map();
    }
    return this.mapping;
  }

  private async remember(sessionId: string, threadId: string): Promise<void> {
    const mapping = await this.loadMapping();
    mapping.set(sessionId, threadId);
    await mkdir(dirname(this.mappingFile), { recursive: true });
    await writeFile(this.mappingFile, JSON.stringify(Object.fromEntries(mapping), null, 2));
  }

  /** Threads recorded under this user's cwd, newest first. */
  private async threads(): Promise<Obj[]> {
    const server = await this.connection();
    const result = await server.request("thread/list", {
      cwd: this.options.cwd,
      limit: 200,
      sortKey: "updated_at",
      sourceKinds: ["appServer", "vscode", "cli", "exec"],
    }) as Obj;
    return Array.isArray(result.data) ? (result.data as Obj[]) : [];
  }

  async create(options: { sessionId: string }): Promise<PiSession> {
    const server = await this.connection();
    const mapping = await this.loadMapping();
    const known = mapping.get(options.sessionId) ?? options.sessionId;
    const common = {
      cwd: this.options.cwd,
      ...(this.options.sandbox === undefined ? {} : { sandbox: this.options.sandbox }),
      approvalPolicy: this.options.approvalPolicy ?? "never",
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    };
    // Resume first: `thread/list` omits threads that have not spoken yet, and a
    // failed lookup must never fork a user's conversation into a fresh thread.
    let response: Obj | undefined;
    if (UUID_LIKE.test(known)) {
      response = await server.request("thread/resume", { threadId: known, ...common }).then((result) => result as Obj, () => undefined);
    }
    if (!response) {
      response = await server.request("thread/start", { ...common, threadSource: null }) as Obj;
      const thread = response.thread as Obj;
      if (typeof thread.id === "string" && thread.id !== options.sessionId) await this.remember(options.sessionId, thread.id);
    }
    const thread = response.thread as Obj;
    const session = new CodexSession(server, String(thread.id), {
      model: typeof response.model === "string" ? response.model : this.options.model,
      reasoningEffort: typeof response.reasoningEffort === "string" ? response.reasoningEffort : this.options.reasoningEffort,
      approvalPolicy: this.options.approvalPolicy ?? "never",
    });
    session.absorbThread(thread);
    return session;
  }

  async list(): Promise<PiSessionListing[]> {
    let threads: Obj[];
    try {
      threads = await this.threads();
    } catch {
      return [];
    }
    const mapping = await this.loadMapping();
    const reverse = new Map<string, string>();
    for (const [sessionId, threadId] of mapping) reverse.set(threadId, sessionId);
    return threads
      .filter((thread) => typeof thread.id === "string" && thread.parentThreadId == null)
      .map((thread) => {
        const id = String(thread.id);
        const preview = typeof thread.preview === "string" ? thread.preview.replace(/\s+/g, " ").trim().slice(0, 120) : "";
        const name = typeof thread.name === "string" && thread.name.length > 0 ? thread.name : undefined;
        return {
          id: reverse.get(id) ?? id,
          ...(name === undefined ? {} : { name }),
          createdAt: toIso(thread.createdAt),
          updatedAt: toIso(thread.updatedAt),
          // thread/list carries no counts; a preview means the user has spoken.
          messageCount: preview.length > 0 ? 1 : 0,
          preview,
        };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async delete(sessionId: string): Promise<boolean> {
    const mapping = await this.loadMapping();
    const threadId = mapping.get(sessionId) ?? sessionId;
    try {
      const server = await this.connection();
      await server.request("thread/delete", { threadId });
    } catch {
      return false;
    }
    if (mapping.delete(sessionId)) await writeFile(this.mappingFile, JSON.stringify(Object.fromEntries(mapping), null, 2)).catch(() => undefined);
    return true;
  }

  /** Stop the user's app-server; sessions resume from Codex's rollouts next time. */
  async close(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
  }
}

interface CodexSessionSettings {
  model?: string;
  reasoningEffort?: string;
  approvalPolicy: string;
}

class CodexSession implements PiSession {
  private readonly server: CodexAppServer;
  readonly threadId: string;
  private readonly listeners = new Set<(event: unknown) => void>();
  private readonly unsubscribe: () => void;
  private model?: string;
  private effort?: string;
  private sessionName?: string;
  private activeTurnId?: string;
  private streaming = false;
  private messageCount = 0;
  private tokenUsage?: Obj;
  /** agentMessage items that streamed deltas; the completed item must not be re-emitted as text. */
  private readonly streamedItems = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private readonly followUps: Array<{ text: string; images?: ImageInput[] }> = [];
  private readonly pendingApprovals = new Map<string, PendingServerRequest>();
  private stopped = false;

  constructor(server: CodexAppServer, threadId: string, settings: CodexSessionSettings) {
    this.server = server;
    this.threadId = threadId;
    this.model = settings.model;
    this.effort = settings.reasoningEffort;
    this.unsubscribe = server.subscribe(threadId, {
      notification: (method, params) => this.onNotification(method, params),
      request: (request) => this.onServerRequest(request),
      exit: () => this.onServerExit(),
    });
  }

  /** Seed state from a thread object (resume/start response). */
  absorbThread(thread: Obj): void {
    if (typeof thread.name === "string" && thread.name.length > 0) this.sessionName = thread.name;
    if (typeof thread.model === "string") this.model = thread.model;
    if (typeof thread.reasoningEffort === "string") this.effort = thread.reasoningEffort;
    const turns = Array.isArray(thread.turns) ? (thread.turns as Obj[]) : [];
    this.messageCount = countMessages(turns);
    const status = thread.status as Obj | undefined;
    this.streaming = status?.type === "active";
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Json): void {
    for (const listener of this.listeners) listener(event);
  }

  private turnOverrides(): Obj {
    return {
      ...(this.model === undefined ? {} : { model: this.model }),
      ...(this.effort === undefined ? {} : { effort: this.effort }),
    };
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {
    const result = await this.server.request("turn/start", {
      threadId: this.threadId,
      input: toUserInput(text, images),
      ...this.turnOverrides(),
    }) as Obj;
    const turn = result.turn as Obj | undefined;
    if (turn && typeof turn.id === "string") this.activeTurnId = turn.id;
  }

  async steer(text: string, images?: ImageInput[]): Promise<void> {
    if (this.activeTurnId === undefined) return this.prompt(text, images);
    await this.server.request("turn/steer", {
      threadId: this.threadId,
      input: toUserInput(text, images),
      expectedTurnId: this.activeTurnId,
    });
    this.emit({ type: "queue_update", steering: [text], followUp: this.followUps.map((item) => item.text) });
  }

  async followUp(text: string, images?: ImageInput[]): Promise<void> {
    if (!this.streaming) return this.prompt(text, images);
    this.followUps.push({ text, ...(images === undefined ? {} : { images }) });
    this.emit({ type: "queue_update", steering: [], followUp: this.followUps.map((item) => item.text) });
  }

  async abort(): Promise<void> {
    this.followUps.length = 0;
    if (this.activeTurnId === undefined) return;
    await this.server.request("turn/interrupt", { threadId: this.threadId, turnId: this.activeTurnId });
  }

  async getState(): Promise<SessionState> {
    return {
      isStreaming: this.streaming,
      messageCount: this.messageCount,
      ...(this.sessionName === undefined ? {} : { sessionName: this.sessionName }),
    };
  }

  async getHistory(): Promise<PiHistory> {
    const result = await this.server.request("thread/read", { threadId: this.threadId, includeTurns: true }) as Obj;
    const thread = result.thread as Obj;
    const turns = Array.isArray(thread.turns) ? (thread.turns as Obj[]) : [];
    this.messageCount = countMessages(turns);
    const entries = projectTurns(turns);
    return { entries, leafId: entries.at(-1)?.id ?? null };
  }

  async rename(name: string): Promise<void> {
    await this.server.request("thread/name/set", { threadId: this.threadId, name });
    this.sessionName = name;
  }

  async getModels(): Promise<PiModels> {
    const result = await this.server.request("model/list", {}) as Obj;
    const data = Array.isArray(result.data) ? (result.data as Obj[]) : [];
    const current = data.find((model) => model.model === this.model || model.id === this.model) ?? data.find((model) => model.isDefault === true);
    const efforts = (model: Obj | undefined) => Array.isArray(model?.supportedReasoningEfforts)
      ? (model!.supportedReasoningEfforts as Obj[]).map((option) => String(option.reasoningEffort))
      : [];
    const currentId = typeof current?.model === "string" ? current.model : this.model;
    const levels = efforts(current);
    const level = this.effort ?? (typeof current?.defaultReasoningEffort === "string" ? current.defaultReasoningEffort : levels[0] ?? "medium");
    return {
      models: data.filter((model) => model.hidden !== true).map((model) => ({
        provider: "codex",
        id: String(model.model ?? model.id),
        ...(efforts(model).length > 0 ? { reasoning: true } : {}),
      })),
      current: currentId === undefined ? null : { provider: "codex", id: currentId },
      thinkingLevel: level,
      thinkingLevels: levels,
    };
  }

  async setModel(_provider: string, id: string): Promise<void> {
    // Applied as an override on the next turn; Codex has no per-thread setter.
    this.model = id;
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.effort = level;
  }

  async getCommands(): Promise<CommandInfo[]> {
    return [];
  }

  async getExtensions(): Promise<ExtensionInfo[]> {
    return [{ name: "codex app-server", kind: "extension", origin: "package", commands: [] }];
  }

  async getStats(): Promise<SessionStats> {
    const total = (this.tokenUsage?.total ?? {}) as Obj;
    const num = (value: Json | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    const contextWindow = this.tokenUsage?.modelContextWindow;
    const last = (this.tokenUsage?.last ?? {}) as Obj;
    const used = num(last.totalTokens);
    return {
      userMessages: Math.ceil(this.messageCount / 2),
      assistantMessages: Math.floor(this.messageCount / 2),
      toolCalls: 0,
      tokens: {
        input: num(total.inputTokens),
        output: num(total.outputTokens),
        cacheRead: num(total.cachedInputTokens),
        cacheWrite: num(total.cacheWriteInputTokens),
        total: num(total.totalTokens),
      },
      cost: 0,
      ...(typeof contextWindow === "number" && contextWindow > 0
        ? { contextUsage: { tokens: used, contextWindow, percent: Math.round((used / contextWindow) * 1000) / 10 } }
        : {}),
    };
  }

  async compact(): Promise<void> {
    await this.server.request("thread/compact/start", { threadId: this.threadId });
  }

  async respondUi(response: UiResponse): Promise<void> {
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);
    const approved = response.confirmed === true && response.cancelled !== true;
    const legacy = pending.method === "execCommandApproval" || pending.method === "applyPatchApproval";
    const decision = legacy ? (approved ? "approved" : "denied") : (approved ? "accept" : "decline");
    this.server.respond(pending.id, { decision });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    // Decline whatever Codex is still waiting on so its turn can end.
    for (const pending of this.pendingApprovals.values()) {
      const legacy = pending.method === "execCommandApproval" || pending.method === "applyPatchApproval";
      this.server.respond(pending.id, { decision: legacy ? "denied" : "decline" });
    }
    this.pendingApprovals.clear();
    if (this.server.alive) {
      await this.server.request("thread/unsubscribe", { threadId: this.threadId }).catch(() => undefined);
    }
  }

  // ---- Codex → Pi event translation -----------------------------------

  private onNotification(method: string, params: Obj): void {
    switch (method) {
      case "turn/started": {
        const turn = params.turn as Obj | undefined;
        if (turn && typeof turn.id === "string") this.activeTurnId = turn.id;
        this.streaming = true;
        this.emit({ type: "agent_start" });
        return;
      }
      case "item/agentMessage/delta":
        if (typeof params.itemId === "string") this.streamedItems.add(params.itemId);
        this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: String(params.delta ?? "") } });
        return;
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        this.emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: String(params.delta ?? "") } });
        return;
      case "item/started":
        this.onItemStarted(params.item as Obj);
        return;
      case "item/completed":
        this.onItemCompleted(params.item as Obj);
        return;
      case "thread/tokenUsage/updated":
        this.tokenUsage = params.tokenUsage as Obj;
        return;
      case "thread/name/updated":
        if (typeof params.threadName === "string") this.sessionName = params.threadName;
        return;
      case "error": {
        const error = params.error as Obj | undefined;
        const message = typeof error?.message === "string" ? error.message : "Codex error";
        if (params.willRetry === true) {
          const match = /(\d+)\s*\/\s*(\d+)/.exec(message);
          this.emit({ type: "auto_retry_start", attempt: match ? Number(match[1]) : 1, maxAttempts: match ? Number(match[2]) : 1 });
        }
        return;
      }
      case "turn/completed": {
        const turn = params.turn as Obj | undefined;
        if (turn?.status === "failed") {
          const error = turn.error as Obj | null | undefined;
          const message = typeof error?.message === "string" ? error.message : "Codex turn failed";
          const details = typeof error?.additionalDetails === "string" && error.additionalDetails.length > 0 ? ` (${error.additionalDetails})` : "";
          this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: `${message}${details}` } });
        }
        this.activeTurnId = undefined;
        this.streaming = false;
        this.streamedItems.clear();
        this.toolNames.clear();
        this.emit({ type: "agent_settled" });
        const next = this.followUps.shift();
        if (next) {
          this.emit({ type: "queue_update", steering: [], followUp: this.followUps.map((item) => item.text) });
          void this.prompt(next.text, next.images).catch((error) => {
            this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: error instanceof Error ? error.message : String(error) } });
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private onItemStarted(item: Obj | undefined): void {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    const tool = toolCallOf(item);
    if (!tool) return;
    this.toolNames.set(item.id, tool.name);
    this.emit({ type: "tool_execution_start", toolCallId: item.id, toolName: tool.name, args: tool.args });
  }

  private onItemCompleted(item: Obj | undefined): void {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    switch (item.type) {
      case "userMessage":
        this.messageCount += 1;
        return;
      case "agentMessage": {
        const text = typeof item.text === "string" ? item.text : "";
        // Older servers (or opted-out deltas) deliver the message only here.
        if (!this.streamedItems.has(item.id) && text.length > 0) {
          this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
        }
        this.streamedItems.delete(item.id);
        this.messageCount += 1;
        this.emit({ type: "message_end", message: { role: "assistant" } });
        return;
      }
      case "plan": {
        const text = typeof item.text === "string" ? item.text : "";
        if (text.trim().length > 0) this.emit({ type: "message_end", message: { role: "custom", display: true, content: [{ type: "text", text: `计划：\n${text}` }] } });
        return;
      }
      case "contextCompaction":
        this.emit({ type: "compaction_end" });
        return;
      default: {
        const tool = toolCallOf(item);
        if (!tool) return;
        if (!this.toolNames.has(item.id)) {
          this.emit({ type: "tool_execution_start", toolCallId: item.id, toolName: tool.name, args: tool.args });
        }
        this.toolNames.delete(item.id);
        const outcome = toolResultOf(item);
        this.emit({ type: "tool_execution_end", toolCallId: item.id, toolName: tool.name, result: outcome.result, isError: outcome.isError });
      }
    }
  }

  private onServerRequest(request: PendingServerRequest): boolean {
    const params = request.params;
    let title: string;
    let message: string;
    switch (request.method) {
      case "item/commandExecution/requestApproval":
      case "execCommandApproval": {
        const command = typeof params.command === "string" ? params.command : Array.isArray(params.command) ? (params.command as Json[]).map(String).join(" ") : "";
        title = "Codex 请求执行命令";
        message = [command.length > 0 ? `$ ${command}` : "", typeof params.reason === "string" ? params.reason : ""].filter((part) => part.length > 0).join("\n");
        break;
      }
      case "item/fileChange/requestApproval":
      case "applyPatchApproval": {
        title = "Codex 请求修改文件";
        const reason = typeof params.reason === "string" ? params.reason : "";
        const grant = typeof params.grantRoot === "string" ? `写入目录：${params.grantRoot}` : "";
        message = [reason, grant].filter((part) => part.length > 0).join("\n") || "允许 Codex 应用这次修改？";
        break;
      }
      case "item/permissions/requestApproval":
        title = "Codex 请求额外权限";
        message = typeof params.reason === "string" ? params.reason : JSON.stringify(params.permissions ?? params).slice(0, 2000);
        break;
      default:
        return false;
    }
    const id = `codex-${String(request.id)}`;
    this.pendingApprovals.set(id, request);
    this.emit({ type: "extension_ui_request", id, method: "confirm", title, message });
    return true;
  }

  private onServerExit(): void {
    if (this.streaming) {
      this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Codex app-server exited" } });
      this.streaming = false;
      this.activeTurnId = undefined;
      this.emit({ type: "agent_settled" });
    }
  }
}

// ---- JSON-RPC over stdio ---------------------------------------------------

interface ThreadSubscriber {
  notification: (method: string, params: Obj) => void;
  /** Return true when handled; unhandled server requests are declined generically. */
  request: (request: PendingServerRequest) => boolean;
  exit: () => void;
}

interface CodexAppServerOptions {
  cliPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** One `codex app-server` child; requests are multiplexed by id, events routed by threadId. */
export class CodexAppServer {
  private readonly options: CodexAppServerOptions;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly subscribers = new Map<string, Set<ThreadSubscriber>>();
  private exited = false;
  private stderrTail = "";

  constructor(options: CodexAppServerOptions) {
    this.options = options;
  }

  get alive(): boolean {
    return this.child !== undefined && !this.exited;
  }

  async start(clientName: string, clientVersion: string): Promise<void> {
    await mkdir(this.options.cwd, { recursive: true });
    const child = spawn(this.options.cliPath, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    const exit = new Promise<never>((_, reject) => {
      child.once("error", (error) => { this.onExit(`codex app-server failed to start: ${error.message}`); reject(error); });
      child.once("exit", (code, signal) => {
        const reason = `codex app-server exited (${signal ?? code}): ${this.stderrTail.trim().split("\n").at(-1) ?? ""}`;
        this.onExit(reason);
        reject(new Error(reason));
      });
    });
    exit.catch(() => undefined);
    await Promise.race([
      this.request("initialize", { clientInfo: { name: clientName, title: "PI Coffee", version: clientVersion } }),
      exit,
    ]);
    this.notify("initialized", {});
  }

  request(method: string, params: Json): Promise<Json> {
    const child = this.child;
    if (!child || this.exited) return Promise.reject(new Error("codex app-server is not running"));
    const id = this.nextId++;
    return new Promise<Json>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  notify(method: string, params: Json): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: Json, result: Json): void {
    this.child?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  subscribe(threadId: string, subscriber: ThreadSubscriber): () => void {
    let set = this.subscribers.get(threadId);
    if (!set) {
      set = new Set();
      this.subscribers.set(threadId, set);
    }
    set.add(subscriber);
    return () => {
      set!.delete(subscriber);
      if (set!.size === 0) this.subscribers.delete(threadId);
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.kill("SIGTERM");
    await gone;
    clearTimeout(timer);
  }

  private onLine(line: string): void {
    let message: Obj;
    try {
      const parsed = JSON.parse(line) as Json;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      message = parsed;
    } catch {
      return; // Codex writes only JSON to stdout; anything else is noise.
    }
    const id = message.id;
    if (typeof message.method === "string") {
      const params = (typeof message.params === "object" && message.params !== null && !Array.isArray(message.params) ? message.params : {}) as Obj;
      if (id === undefined || id === null) {
        this.dispatchNotification(message.method, params);
      } else {
        this.dispatchServerRequest({ id, method: message.method, params });
      }
      return;
    }
    if (typeof id === "number") {
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      if (message.error !== undefined && message.error !== null) {
        const error = message.error as Partial<RpcError>;
        waiter.reject(new Error(typeof error.message === "string" ? error.message : "Codex RPC error"));
      } else {
        waiter.resolve(message.result ?? null);
      }
    }
  }

  private dispatchNotification(method: string, params: Obj): void {
    const threadId = typeof params.threadId === "string"
      ? params.threadId
      : typeof (params.thread as Obj | undefined)?.id === "string" ? String((params.thread as Obj).id) : undefined;
    if (threadId === undefined) return;
    for (const subscriber of this.subscribers.get(threadId) ?? []) {
      try { subscriber.notification(method, params); } catch { /* one bad listener must not break the stream */ }
    }
  }

  private dispatchServerRequest(request: PendingServerRequest): void {
    const threadId = typeof request.params.threadId === "string" ? request.params.threadId : undefined;
    const handled = [...(threadId === undefined ? [] : this.subscribers.get(threadId) ?? [])].some((subscriber) => {
      try { return subscriber.request(request); } catch { return false; }
    });
    if (handled) return;
    // Nobody can answer: refuse rather than hang Codex.
    const legacy = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
    if (request.method.endsWith("requestApproval") || legacy) {
      this.respond(request.id, { decision: legacy ? "denied" : "decline" });
    } else if (request.method === "item/tool/requestUserInput") {
      this.respond(request.id, { answers: {} });
    } else {
      this.child?.stdin.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: `PI Coffee cannot answer ${request.method}` } })}\n`);
    }
  }

  private onExit(reason = "codex app-server exited"): void {
    if (this.exited) return;
    this.exited = true;
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason));
    this.pending.clear();
    for (const set of this.subscribers.values()) for (const subscriber of set) {
      try { subscriber.exit(); } catch { /* ignore */ }
    }
  }
}

// ---- projections -----------------------------------------------------------

function toUserInput(text: string, images?: ImageInput[]): Json[] {
  const input: Json[] = [{ type: "text", text, text_elements: [] }];
  for (const image of images ?? []) {
    input.push({ type: "image", url: `data:${image.mimeType};base64,${image.data}` });
  }
  return input;
}

function toIso(value: Json | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date(0).toISOString();
}

function countMessages(turns: Obj[]): number {
  let count = 0;
  for (const turn of turns) {
    for (const item of Array.isArray(turn.items) ? (turn.items as Obj[]) : []) {
      if (item.type === "userMessage" || item.type === "agentMessage") count += 1;
    }
  }
  return count;
}

/** Map a Codex item to the tool name/args the shell knows how to summarise. */
function toolCallOf(item: Obj): { name: string; args: Obj } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "bash", args: { command: String(item.command ?? ""), ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}) } };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? (item.changes as Obj[]) : [];
      const paths = changes.map((change) => String(change.path ?? "")).filter((path) => path.length > 0);
      return { name: "edit", args: { path: paths.join(", ") } };
    }
    case "mcpToolCall":
      return { name: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")}`, args: asObj(item.arguments) };
    case "dynamicToolCall":
      return { name: String(item.tool ?? "tool"), args: asObj(item.arguments) };
    case "webSearch":
      return { name: "web_search", args: { query: String(item.query ?? "") } };
    case "imageView":
      return { name: "read", args: { path: String(item.path ?? "") } };
    case "collabAgentToolCall":
      return { name: "subagent", args: { tool: String(item.tool ?? ""), ...(typeof item.prompt === "string" ? { prompt: item.prompt } : {}) } };
    default:
      return undefined;
  }
}

function toolResultOf(item: Obj): { result: Json; isError: boolean } {
  const text = (value: string) => ({ content: [{ type: "text", text: value }] });
  switch (item.type) {
    case "commandExecution": {
      const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
      const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
      const failed = item.status === "failed" || item.status === "declined" || (exitCode !== undefined && exitCode !== 0);
      const suffix = exitCode !== undefined && exitCode !== 0 ? `\n[exit ${exitCode}]` : item.status === "declined" ? "\n[declined]" : "";
      return { result: text(`${output}${suffix}`), isError: failed };
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? (item.changes as Obj[]) : [];
      const patch = changes.map((change) => {
        const path = String(change.path ?? "");
        const diff = typeof change.diff === "string" ? change.diff : "";
        return diff.startsWith("---") || diff.startsWith("diff ") ? diff : `--- a/${path}\n+++ b/${path}\n${diff}`;
      }).join("\n");
      const failed = item.status === "failed" || item.status === "declined";
      return {
        result: { content: [{ type: "text", text: failed ? `修改未应用（${String(item.status)}）` : `已修改 ${changes.length} 个文件` }], details: { patch } },
        isError: failed,
      };
    }
    case "mcpToolCall": {
      const error = item.error as Obj | null | undefined;
      if (error && typeof error.message === "string") return { result: text(error.message), isError: true };
      return { result: text(stringify(item.result)), isError: item.status === "failed" };
    }
    case "dynamicToolCall": {
      const parts = Array.isArray(item.contentItems) ? (item.contentItems as Obj[]) : [];
      const joined = parts.map((part) => (typeof part.text === "string" ? part.text : stringify(part))).join("\n");
      return { result: text(joined), isError: item.success === false || item.status === "failed" };
    }
    case "webSearch":
      return { result: text(stringify(item.action ?? item)), isError: false };
    default:
      return { result: text(stringify(item)), isError: false };
  }
}

/** Completed Codex turns → the shell's history entries. */
export function projectTurns(turns: Obj[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const turn of turns) {
    const at = typeof turn.startedAt === "number" ? toIso(turn.startedAt) : undefined;
    for (const item of Array.isArray(turn.items) ? (turn.items as Obj[]) : []) {
      const id = String(item.id ?? `${entries.length}`);
      const stamp = at === undefined ? {} : { at };
      switch (item.type) {
        case "userMessage": {
          const content = Array.isArray(item.content) ? (item.content as Obj[]) : [];
          const text = content.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n");
          const imageCount = content.filter((part) => part.type === "image" || part.type === "localImage").length;
          entries.push({ kind: "user", id, ...stamp, text, ...(imageCount > 0 ? { imageCount } : {}) });
          break;
        }
        case "agentMessage":
          entries.push({ kind: "assistant", id, ...stamp, text: String(item.text ?? "") });
          break;
        case "plan": {
          const text = String(item.text ?? "");
          if (text.trim()) entries.push({ kind: "note", id, ...stamp, text: `计划：\n${text}` });
          break;
        }
        case "contextCompaction":
          entries.push({ kind: "note", id, ...stamp, text: "已压缩上下文。" });
          break;
        default: {
          const tool = toolCallOf(item);
          if (!tool) break;
          const outcome = toolResultOf(item);
          const result = outcome.result as Obj;
          const content = Array.isArray(result.content) ? (result.content as Obj[]) : [];
          const details = result.details as Obj | undefined;
          entries.push({
            kind: "tool",
            id,
            ...stamp,
            name: tool.name,
            args: tool.args,
            result: content.map((part) => String(part.text ?? "")).join("\n"),
            ...(outcome.isError ? { isError: true } : {}),
            ...(typeof details?.patch === "string" && details.patch.length > 0 ? { diff: details.patch } : {}),
          });
        }
      }
    }
    if (turn.status === "failed") {
      const error = turn.error as Obj | null | undefined;
      entries.push({ kind: "note", id: `${String(turn.id)}-error`, ...(at === undefined ? {} : { at }), text: `模型调用失败：${typeof error?.message === "string" ? error.message : "未知错误"}` });
    }
  }
  return entries;
}

function asObj(value: Json | undefined): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value: value ?? null };
}

function stringify(value: Json | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
