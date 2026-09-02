import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryEntry, ImageInput } from "../src/shared/protocol.js";
import { decodeServerFrame, encodeFrame, type ServerFrame } from "../src/shared/protocol.js";
import { HostServer } from "../src/host/server.js";
import type { PiSession, PiSessionFactory } from "../src/host/pi-adapter.js";

class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  private state = { isStreaming: false, messageCount: 0, sessionName: undefined as string | undefined };
  readonly history: HistoryEntry[] = [];
  /** When set, prompt() stops after the first delta so the message stays in flight. */
  holdAfterDelta = false;

  async prompt(text: string, _images?: ImageInput[]): Promise<void> {
    this.state = { ...this.state, isStreaming: true };
    this.emit({ type: "agent_start" });
    this.history.push({ kind: "user", id: `u${this.history.length}`, text });
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${text}` },
    });
    if (this.holdAfterDelta) return;
    this.finish(text);
  }

  finish(text: string): void {
    this.history.push({ kind: "assistant", id: `a${this.history.length}`, text: `echo: ${text}` });
    this.emit({ type: "message_end", message: { role: "assistant" } });
    this.state = { ...this.state, isStreaming: false, messageCount: this.state.messageCount + 2 };
    this.emit({ type: "agent_settled" });
  }

  async getHistory() {
    return { entries: [...this.history], leafId: this.history.at(-1)?.id ?? null };
  }

  async abort(): Promise<void> {
    this.state = { ...this.state, isStreaming: false };
    this.emit({ type: "agent_settled" });
  }

  async getState() {
    return this.state;
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stopped = false;
  startedTwice = false;

  async stop(): Promise<void> {
    this.stopped = true;
  }

  private emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeFactory implements PiSessionFactory {
  readonly sessions = new Map<string, FakePiSession>();
  /** Conversations "on disk" that no live session has been created for yet. */
  readonly stored: Array<{ id: string; preview: string }> = [];

  async create(options: { sessionId: string }): Promise<PiSession> {
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      existing.startedTwice = true;
      existing.stopped = false;
      return existing;
    }
    const session = new FakePiSession();
    this.sessions.set(options.sessionId, session);
    return session;
  }

  async list() {
    const now = new Date().toISOString();
    return [
      ...this.stored.map((item) => ({ id: item.id, createdAt: now, updatedAt: now, messageCount: 2, preview: item.preview })),
      ...[...this.sessions.entries()].map(([id, session]) => ({
        id,
        createdAt: now,
        updatedAt: now,
        messageCount: session.history.length,
        preview: session.history.find((entry) => entry.kind === "user")?.text ?? "",
      })),
    ];
  }
}

let server: HostServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

class FrameQueue {
  private readonly frames: ServerFrame[] = [];
  private readonly waiters: Array<(frame: ServerFrame) => void> = [];

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const frame = decodeServerFrame(data as Buffer);
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    });
  }

  next(): Promise<ServerFrame> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        const index = this.waiters.indexOf(resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(error);
      };
      this.socket.once("error", onError);
      this.waiters.push((nextFrame) => {
        this.socket.off("error", onError);
        resolve(nextFrame);
      });
    });
  }
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/host`);
  await once(socket, "open");
  return socket;
}

describe("Host WebSocket seam", () => {
  it("keeps a Pi session alive across browser disconnect and hands a new browser the durable history", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, eventBufferSize: 32 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    expect(opened.type).toBe("opened");
    if (opened.type !== "opened") throw new Error("expected opened");
    // A brand-new session has an empty history; the frame is still sent so the
    // browser can always reset its view from the Host's truth.
    expect(await firstFrames.next()).toMatchObject({ type: "history", sessionId: opened.sessionId, entries: [], truncated: false });

    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    expect(await firstFrames.next()).toMatchObject({ type: "ack", operation: "prompt", requestId: "r1" });
    expect(await firstFrames.next()).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(await firstFrames.next()).toMatchObject({
      type: "event",
      event: { type: "message_update", assistantMessageEvent: { delta: "echo: hello" } },
    });
    expect(await firstFrames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    const settled = await firstFrames.next();
    expect(settled).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    first.close();
    await once(first, "close");

    // A browser that has never seen this session (no cursor) gets the whole
    // completed conversation from the durable store and no replayed deltas:
    // nothing is in flight, so there is nothing to catch up on.
    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", sessionId: opened.sessionId });
    const history = await secondFrames.next();
    expect(history).toMatchObject({
      type: "history",
      entries: [
        { kind: "user", text: "hello" },
        { kind: "assistant", text: "echo: hello" },
      ],
    });
    second.send(encodeFrame({ v: 1, type: "ping", nonce: "after-history" }));
    expect(await secondFrames.next()).toMatchObject({ type: "pong", nonce: "after-history" });
    second.close();
  });

  it("replays only the in-flight tail after the history when a message is still streaming", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, eventBufferSize: 32 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await firstFrames.next(); // history
    const pi = factory.sessions.get(opened.sessionId)!;

    // First turn completes; second turn is held mid-stream.
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "one" }));
    for (let i = 0; i < 5; i++) await firstFrames.next(); // ack, agent_start, delta, message_end, settled
    pi.holdAfterDelta = true;
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r2", text: "two" }));
    await firstFrames.next(); // ack
    const start = await firstFrames.next();
    const delta = await firstFrames.next();
    expect(start).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(delta).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: two" } } });
    first.close();
    await once(first, "close");

    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", state: { isStreaming: true } });
    const history = await secondFrames.next();
    expect(history).toMatchObject({ type: "history" });
    if (history.type !== "history") throw new Error("expected history");
    // Completed turn is in the history; the in-flight second turn is not yet.
    expect(history.entries.map((entry) => entry.text)).toEqual(["one", "echo: one", "two"]);
    // Replay covers exactly the in-flight events: agent_start and the delta,
    // never the first turn's deltas that the history already contains.
    const replay1 = await secondFrames.next();
    const replay2 = await secondFrames.next();
    expect(replay1).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(replay2).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: two" } } });
    if (start.type === "event" && replay1.type === "event") expect(replay1.cursor).toBe(start.cursor);

    pi.finish("two");
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    second.close();
  });

  it("lists durable and live sessions before any session is opened", async () => {
    const factory = new FakeFactory();
    factory.stored.push({ id: "stored-1", preview: "an older conversation" });
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);

    socket.send(encodeFrame({ v: 1, type: "list_sessions" }));
    const listed = await frames.next();
    expect(listed).toMatchObject({ type: "sessions", sessions: [{ id: "stored-1", preview: "an older conversation", running: false }] });

    // Opening a stored session resumes it through the factory by id.
    socket.send(encodeFrame({ v: 1, type: "open", sessionId: "stored-1" }));
    expect(await frames.next()).toMatchObject({ type: "opened", sessionId: "stored-1" });
    expect(await frames.next()).toMatchObject({ type: "history", sessionId: "stored-1" });
    expect(factory.sessions.has("stored-1")).toBe(true);
    socket.close();
  });

  it("stops an idle Pi process and resumes the conversation from the store on the next open", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, idleTimeoutMs: 60 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await firstFrames.next();
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    for (let i = 0; i < 5; i++) await firstFrames.next();
    const firstPi = factory.sessions.get(opened.sessionId)!;
    first.close();
    await once(first, "close");

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(firstPi.stopped).toBe(true);

    // The store still has the conversation; reopening creates a fresh Pi
    // process for the same id and the browser sees the same history.
    factory.stored.push({ id: opened.sessionId, preview: "hello" });
    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", sessionId: opened.sessionId });
    expect(await secondFrames.next()).toMatchObject({ type: "history", sessionId: opened.sessionId });
    expect(factory.sessions.get(opened.sessionId)).toBe(firstPi); // same fake object reused by the factory
    expect(firstPi.startedTwice).toBe(true);
    second.close();
  });

  it("refuses to listen on a non-loopback address without a transport token", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "0.0.0.0", factory });
    await expect(server.start()).rejects.toThrow(/PI_COFFEE_HOST_TOKEN/);
    // Nothing was bound: start() must fail before listen, not after.
    expect(() => server?.address()).toThrow(/not listening/);
    server = undefined;
  });

  it("rejects a Host connection whose bearer token does not match", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, token: "secret-transport-token" });
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/host`, {
      headers: { authorization: "Bearer wrong" },
    });
    const [error] = (await once(socket, "error")) as [Error];
    expect(error.message).toMatch(/401/);
  });

  it("requires the open frame before accepting commands", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "ping", nonce: "n" }));
    await expect(frames.next()).resolves.toMatchObject({ type: "error", code: "not_open" });
    socket.close();
  });
});
