import { randomUUID } from "node:crypto";
import type {
  CommandInfo,
  ExtensionInfo,
  ImageInput,
  JsonValue,
  ServerFrame,
  SessionState,
  SessionStats,
  SessionSummary,
  UiResponse,
} from "../shared/protocol.js";
import type { PiHistory, PiModels, PiSessionFactory, PiSession } from "./pi-adapter.js";

export interface SessionSink {
  send(frame: ServerFrame): void;
}

export interface HostSessionOptions {
  id?: string;
  factory: PiSessionFactory;
  eventBufferSize?: number;
  /** Stop the Pi process after this long with no browser attached and nothing running. 0 disables. */
  idleTimeoutMs?: number;
  onIdle?: (session: HostSession) => void;
  /** Called when a run starts or settles (the conversation list's running flag / counts change). */
  onLifecycle?: (session: HostSession) => void;
}

export interface SessionOpenResult {
  session: HostSession;
  history: PiHistory;
  replay: ServerFrame[];
  resync?: { oldestCursor: number; newestCursor: number };
}

/**
 * In-process owner of one original Pi session. Durability lives in Pi's own
 * session file in the User VM: this object can be stopped when idle and
 * recreated later without losing the conversation.
 */
export class HostSession {
  readonly id: string;
  private readonly factory: PiSessionFactory;
  private readonly eventBufferSize: number;
  private readonly idleTimeoutMs: number;
  private readonly onIdle?: (session: HostSession) => void;
  private readonly onLifecycle?: (session: HostSession) => void;
  private readonly sinks = new Set<SessionSink>();
  private readonly events: ServerFrame[] = [];
  private pi?: PiSession;
  private unsubscribe?: () => void;
  private cursor = 0;
  /** Cursor of the latest completed message; everything up to here is in the durable history. */
  private lastMessageEndCursor = 0;
  private state: SessionState = { isStreaming: false, messageCount: 0 };
  private activeRequestId?: string;
  /** Extension dialogs awaiting an answer, keyed by request id. */
  private readonly pendingUi = new Map<string, ServerFrame>();
  private started = false;
  private startPromise?: Promise<void>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(options: HostSessionOptions) {
    this.id = options.id ?? randomUUID();
    this.factory = options.factory;
    this.eventBufferSize = Math.max(1, options.eventBufferSize ?? 256);
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 0);
    this.onIdle = options.onIdle;
    this.onLifecycle = options.onLifecycle;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      this.pi = await this.factory.create({ sessionId: this.id });
      this.unsubscribe = this.pi.onEvent((event) => this.handlePiEvent(event));
      try {
        this.state = await this.pi.getState();
        this.started = true;
      } catch (error) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        await this.pi.stop();
        this.pi = undefined;
        throw error;
      }
    })();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async prepare(after?: number): Promise<SessionOpenResult> {
    await this.start();
    if (!this.pi) throw new Error("Session is not ready");
    const history = await this.pi.getHistory();
    // The durable history already contains every completed message, so the
    // browser only needs the events of the message that is still in flight.
    // A returning browser's `after` cursor can only move that boundary later.
    const replayFrom = Math.max(after ?? 0, this.lastMessageEndCursor);
    const oldestCursor = this.events[0]?.type === "event" ? this.events[0].cursor : this.cursor + 1;
    const resync = replayFrom < oldestCursor - 1
      ? { oldestCursor, newestCursor: this.cursor }
      : undefined;
    const replay = resync
      ? []
      : this.events.filter((frame) => frame.type === "event" && frame.cursor > replayFrom);
    return { session: this, history, replay, ...(resync === undefined ? {} : { resync }) };
  }

  attach(sink: SessionSink): void {
    this.sinks.add(sink);
    this.clearIdleTimer();
  }

  detach(sink: SessionSink): void {
    this.sinks.delete(sink);
    this.scheduleIdleCheck();
  }

  get currentState(): SessionState {
    return { ...this.state };
  }

  get currentCursor(): number {
    return this.cursor;
  }

  get isStreaming(): boolean {
    return this.state.isStreaming;
  }

  get hasSinks(): boolean {
    return this.sinks.size > 0;
  }

  get isBusy(): boolean { return this.state.isStreaming || this.activeRequestId !== undefined; }
  releasePrompt(requestId: string): void { if(this.activeRequestId===requestId)this.activeRequestId=undefined; }

  reservePrompt(requestId: string): void {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (this.activeRequestId !== undefined || this.state.isStreaming) {
      throw new SessionBusyError();
    }
    this.activeRequestId = requestId;
  }

  async prompt(requestId: string, text: string, images?: ImageInput[]): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (this.activeRequestId !== requestId) throw new Error("Prompt was not reserved");
    try {
      await this.pi.prompt(text, images);
    } catch (error) {
      this.activeRequestId = undefined;
      throw error;
    }
  }

  /** Join a busy run: steer interrupts after current tool calls, follow_up waits for the end. */
  async enqueue(mode: "steer" | "follow_up", text: string, images?: ImageInput[]): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (mode === "steer") await this.pi.steer(text, images);
    else await this.pi.followUp(text, images);
  }

  async abort(): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    await this.pi.abort();
  }

  async rename(name: string): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    await this.pi.rename(name);
    this.state = { ...this.state, sessionName: name };
  }

  hasPendingUi(id: string): boolean {
    return this.pendingUi.has(id);
  }

  /**
   * Publish a Host-originated event (e.g. transfer progress) on the same
   * ordered stream as Pi's events, so browsers see one consistent timeline.
   */
  announce(event: JsonValue): void {
    if (!this.started) return;
    this.handlePiEvent(event);
  }

  /** Answer a pending extension dialog; unknown ids are ignored (already answered or timed out). */
  async respondUi(response: UiResponse): Promise<boolean> {
    if (!this.pendingUi.has(response.id)) return false;
    // Remove first so a duplicate answer racing with Pi's follow-on events is rejected.
    this.pendingUi.delete(response.id);
    await this.ready().respondUi(response);
    return true;
  }

  /** Dialogs Pi is still blocked on; re-sent to every browser that opens the Session. */
  get pendingUiRequests(): ServerFrame[] {
    return [...this.pendingUi.values()];
  }

  backgroundState():Promise<{known:boolean;active:number}> {return this.ready().backgroundState?.() ?? Promise.resolve({known:false,active:0});}

  getModels(): Promise<PiModels> { return this.ready().getModels(); }
  setModel(provider: string, id: string): Promise<void> { return this.ready().setModel(provider, id); }
  setThinkingLevel(level: string): Promise<void> { return this.ready().setThinkingLevel(level); }
  getCommands(): Promise<CommandInfo[]> { return this.ready().getCommands(); }
  getExtensions(): Promise<ExtensionInfo[]> { return this.ready().getExtensions(); }
  getStats(): Promise<SessionStats> { return this.ready().getStats(); }
  compact(): Promise<void> { return this.ready().compact(); }

  private ready(): PiSession {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    return this.pi;
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // A failed startup has already cleaned up its adapter.
      }
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.pi) await this.pi.stop();
    this.pi = undefined;
    this.started = false;
    this.sinks.clear();
  }

  private scheduleIdleCheck(): void {
    this.clearIdleTimer();
    if (!this.started || this.idleTimeoutMs === 0 || this.onIdle === undefined) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.sinks.size === 0 && !this.state.isStreaming && this.activeRequestId === undefined) {
        this.onIdle?.(this);
      }
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private handlePiEvent(event: unknown): void {
    const safeEvent = toJsonValue(event);
    let settled = false;
    let lifecycle = false;
    if (isRecord(safeEvent) && typeof safeEvent.type === "string") {
      if (safeEvent.type === "agent_start") {
        this.state = { ...this.state, isStreaming: true };
        lifecycle = true;
      }
      if (safeEvent.type === "agent_settled") {
        this.state = { ...this.state, isStreaming: false };
        this.activeRequestId = undefined;
        settled = true;
        lifecycle = true;
        // Whatever dialogs were open have been answered or timed out by now.
        this.pendingUi.clear();
        void this.refreshState();
      }
    }
    this.cursor += 1;
    // Pi appends a message to its session file when the message ends, so from
    // this cursor on the durable history is complete up to and including it.
    if (isRecord(safeEvent) && (safeEvent.type === "message_end" || safeEvent.type === "agent_settled")) {
      this.lastMessageEndCursor = this.cursor;
    }
    const frame: ServerFrame = {
      v: 1,
      type: "event",
      sessionId: this.id,
      cursor: this.cursor,
      event: safeEvent,
      ...(this.activeRequestId === undefined ? {} : { requestId: this.activeRequestId }),
    };
    this.events.push(frame);
    while (this.events.length > this.eventBufferSize) this.events.shift();
    if (isRecord(safeEvent) && safeEvent.type === "extension_ui_request" && typeof safeEvent.id === "string" && isDialogMethod(safeEvent.method)) {
      this.pendingUi.set(safeEvent.id, frame);
    }
    for (const sink of this.sinks) sink.send(frame);
    if (settled) this.scheduleIdleCheck();
    if (lifecycle) this.onLifecycle?.(this);
  }

  private async refreshState(): Promise<void> {
    if (!this.pi) return;
    try {
      this.state = await this.pi.getState();
    } catch {
      // The authoritative lifecycle event has already been forwarded. A
      // transient state refresh failure must not tear down a live session.
    }
  }
}

export class SessionBusyError extends Error {
  constructor() {
    super("A prompt is already running for this session");
    this.name = "SessionBusyError";
  }
}

export class HostSessionRegistry {
  private readonly factory: PiSessionFactory;
  private readonly eventBufferSize: number;
  private readonly idleTimeoutMs: number;
  private readonly sessions = new Map<string, HostSession>();
  private readonly changeListeners = new Set<() => void>();

  constructor(options: { factory: PiSessionFactory; eventBufferSize?: number; idleTimeoutMs?: number }) {
    this.factory = options.factory;
    this.eventBufferSize = options.eventBufferSize ?? 256;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60 * 1000;
  }

  /** Fires whenever the conversation list may have changed (new, settled, renamed, deleted, retired). */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try { listener(); } catch { /* a bad listener must not break the registry */ }
    }
  }

  async open(id?: string, after?: number): Promise<SessionOpenResult> {
    const existing = id === undefined ? undefined : this.sessions.get(id);
    const session = existing ?? new HostSession({
      ...(id === undefined ? {} : { id }),
      factory: this.factory,
      eventBufferSize: this.eventBufferSize,
      idleTimeoutMs: this.idleTimeoutMs,
      onIdle: (idle) => void this.retire(idle),
      onLifecycle: () => this.notifyChange(),
    });
    this.sessions.set(session.id, session);
    try {
      const result = await session.prepare(after);
      if (!existing) this.notifyChange();
      return result;
    } catch (error) {
      if (!existing) {
        this.sessions.delete(session.id);
        await session.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  /** Rename any conversation; a stored-but-idle one is resumed for the call. */
  async rename(id: string, name: string): Promise<void> {
    const { session } = await this.open(id);
    await session.rename(name);
    this.notifyChange();
  }

  /** Delete a conversation from the store, stopping its Pi process first. */
  async delete(id: string): Promise<boolean> {
    if (this.sessions.get(id)?.isBusy) throw new SessionBusyError();
    const live = this.sessions.get(id);
    if (live) {
      this.sessions.delete(id);
      await live.stop().catch(() => undefined);
    }
    const removed = await this.factory.delete(id);
    this.notifyChange();
    return removed || live !== undefined;
  }

  /** Durable conversations from the store, decorated with what is live right now. */
  async list(): Promise<SessionSummary[]> {
    const stored = await this.factory.list();
    const known = new Set(stored.map((item) => item.id));
    // Pi writes the session file at startup; a conversation nobody has spoken
    // in yet is noise in a shared list (the opening browser shows it locally).
    const summaries: SessionSummary[] = stored
      .filter((item) => item.messageCount > 0)
      .map((item) => ({
        ...item,
        running: this.sessions.get(item.id)?.isStreaming ?? false,
      }));
    // A conversation that was just opened has no file yet (Pi writes it with
    // the first message). Like Codex, it only appears in everyone's list once
    // it has content; the browser that opened it shows it locally meanwhile.
    for (const session of this.sessions.values()) {
      if (known.has(session.id) || session.currentState.messageCount === 0) continue;
      const now = new Date().toISOString();
      summaries.unshift({
        id: session.id,
        createdAt: now,
        updatedAt: now,
        messageCount: session.currentState.messageCount,
        preview: "",
        running: session.isStreaming,
      });
    }
    return summaries;
  }

  async stopIdle(id:string):Promise<void> {
    const session=this.sessions.get(id);if(!session)return;
    if(session.isBusy)throw new SessionBusyError();
    await session.stop();this.sessions.delete(id);this.notifyChange();
  }

  get(id: string): HostSession | undefined {
    return this.sessions.get(id);
  }

  private async retire(session: HostSession): Promise<void> {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    const empty = session.currentState.messageCount === 0;
    await session.stop().catch(() => undefined);
    // An abandoned empty conversation leaves no trace in the store.
    if (empty) await this.factory.delete(session.id).catch(() => undefined);
    this.notifyChange();
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    this.sessions.clear();
  }
}

function isDialogMethod(method: unknown): boolean {
  return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 12) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) output[key] = toJsonValue(item, depth + 1);
    return output;
  }
  return String(value);
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
