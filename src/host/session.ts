import { randomUUID } from "node:crypto";
import type {
  ImageInput,
  JsonValue,
  ServerFrame,
  SessionState,
  SessionSummary,
} from "../shared/protocol.js";
import type { PiHistory, PiSessionFactory, PiSession } from "./pi-adapter.js";

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
  private readonly sinks = new Set<SessionSink>();
  private readonly events: ServerFrame[] = [];
  private pi?: PiSession;
  private unsubscribe?: () => void;
  private cursor = 0;
  /** Cursor of the latest completed message; everything up to here is in the durable history. */
  private lastMessageEndCursor = 0;
  private state: SessionState = { isStreaming: false, messageCount: 0 };
  private activeRequestId?: string;
  private started = false;
  private startPromise?: Promise<void>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(options: HostSessionOptions) {
    this.id = options.id ?? randomUUID();
    this.factory = options.factory;
    this.eventBufferSize = Math.max(1, options.eventBufferSize ?? 256);
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 0);
    this.onIdle = options.onIdle;
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

  async abort(): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    await this.pi.abort();
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
    if (this.idleTimeoutMs === 0 || this.onIdle === undefined) return;
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
    if (isRecord(safeEvent) && typeof safeEvent.type === "string") {
      if (safeEvent.type === "agent_start") this.state = { ...this.state, isStreaming: true };
      if (safeEvent.type === "agent_settled") {
        this.state = { ...this.state, isStreaming: false };
        this.activeRequestId = undefined;
        settled = true;
        void this.refreshState();
      }
    }
    this.cursor += 1;
    // Pi appends a message to its session file when the message ends, so from
    // this cursor on the durable history is complete up to and including it.
    if (isRecord(safeEvent) && (safeEvent.type === "message_end" || safeEvent.type === "agent_settled")) {
      this.lastMessageEndCursor = this.cursor;
    }
    if (settled) this.scheduleIdleCheck();
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
    for (const sink of this.sinks) sink.send(frame);
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

  constructor(options: { factory: PiSessionFactory; eventBufferSize?: number; idleTimeoutMs?: number }) {
    this.factory = options.factory;
    this.eventBufferSize = options.eventBufferSize ?? 256;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60 * 1000;
  }

  async open(id?: string, after?: number): Promise<SessionOpenResult> {
    const existing = id === undefined ? undefined : this.sessions.get(id);
    const session = existing ?? new HostSession({
      ...(id === undefined ? {} : { id }),
      factory: this.factory,
      eventBufferSize: this.eventBufferSize,
      idleTimeoutMs: this.idleTimeoutMs,
      onIdle: (idle) => void this.retire(idle),
    });
    this.sessions.set(session.id, session);
    try {
      return await session.prepare(after);
    } catch (error) {
      if (!existing) {
        this.sessions.delete(session.id);
        await session.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  /** Durable conversations from the store, decorated with what is live right now. */
  async list(): Promise<SessionSummary[]> {
    const stored = await this.factory.list();
    const known = new Set(stored.map((item) => item.id));
    const summaries: SessionSummary[] = stored.map((item) => ({
      ...item,
      running: this.sessions.get(item.id)?.isStreaming ?? false,
    }));
    // A conversation that was just opened may not have a file yet (Pi writes
    // it with the first message); still show it so the sidebar matches the
    // browser's active session.
    for (const session of this.sessions.values()) {
      if (known.has(session.id)) continue;
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

  get(id: string): HostSession | undefined {
    return this.sessions.get(id);
  }

  private async retire(session: HostSession): Promise<void> {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    await session.stop().catch(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    this.sessions.clear();
  }
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
