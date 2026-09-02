import { randomUUID } from "node:crypto";
import type {
  ImageInput,
  JsonValue,
  ServerFrame,
  SessionState,
} from "../shared/protocol.js";
import type { PiSessionFactory, PiSession } from "./pi-adapter.js";

export interface SessionSink {
  send(frame: ServerFrame): void;
}

export interface HostSessionOptions {
  id?: string;
  factory: PiSessionFactory;
  eventBufferSize?: number;
}

export interface SessionOpenResult {
  session: HostSession;
  replay: ServerFrame[];
  resync?: { oldestCursor: number; newestCursor: number };
}

/** Durable-in-process owner of one original Pi session. */
export class HostSession {
  readonly id: string;
  private readonly factory: PiSessionFactory;
  private readonly eventBufferSize: number;
  private readonly sinks = new Set<SessionSink>();
  private readonly events: ServerFrame[] = [];
  private pi?: PiSession;
  private unsubscribe?: () => void;
  private cursor = 0;
  private state: SessionState = { isStreaming: false, messageCount: 0 };
  private activeRequestId?: string;
  private started = false;

  constructor(options: HostSessionOptions) {
    this.id = options.id ?? randomUUID();
    this.factory = options.factory;
    this.eventBufferSize = Math.max(1, options.eventBufferSize ?? 256);
  }

  async start(): Promise<void> {
    if (this.started) return;
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
  }

  async prepare(after?: number): Promise<SessionOpenResult> {
    await this.start();
    const oldestCursor = this.events[0]?.type === "event" ? this.events[0].cursor : this.cursor + 1;
    const resync = after !== undefined && after < oldestCursor - 1
      ? { oldestCursor, newestCursor: this.cursor }
      : undefined;
    const replay = resync
      ? []
      : this.events.filter((frame) => frame.type === "event" && (after === undefined || frame.cursor > after));
    return { session: this, replay, ...(resync === undefined ? {} : { resync }) };
  }

  attach(sink: SessionSink): void {
    this.sinks.add(sink);
  }

  detach(sink: SessionSink): void {
    this.sinks.delete(sink);
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
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.pi) await this.pi.stop();
    this.pi = undefined;
    this.started = false;
    this.sinks.clear();
  }

  private handlePiEvent(event: unknown): void {
    const safeEvent = toJsonValue(event);
    if (isRecord(safeEvent) && typeof safeEvent.type === "string") {
      if (safeEvent.type === "agent_start") this.state = { ...this.state, isStreaming: true };
      if (safeEvent.type === "agent_settled") {
        this.state = { ...this.state, isStreaming: false };
        this.activeRequestId = undefined;
        void this.refreshState();
      }
    }
    this.cursor += 1;
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
  private readonly sessions = new Map<string, HostSession>();

  constructor(options: { factory: PiSessionFactory; eventBufferSize?: number }) {
    this.factory = options.factory;
    this.eventBufferSize = options.eventBufferSize ?? 256;
  }

  async open(id?: string, after?: number): Promise<SessionOpenResult> {
    const session = id === undefined
      ? new HostSession({ factory: this.factory, eventBufferSize: this.eventBufferSize })
      : (this.sessions.get(id) ?? new HostSession({ id, factory: this.factory, eventBufferSize: this.eventBufferSize }));
    this.sessions.set(session.id, session);
    return session.prepare(after);
  }

  get(id: string): HostSession | undefined {
    return this.sessions.get(id);
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
