import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { ImageInput } from "../src/shared/protocol.js";
import { decodeServerFrame, encodeFrame, type ServerFrame } from "../src/shared/protocol.js";
import { HostServer } from "../src/host/server.js";
import type { PiSession, PiSessionFactory } from "../src/host/pi-adapter.js";

class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  private state = { isStreaming: false, messageCount: 0, sessionName: undefined as string | undefined };

  async prompt(text: string, _images?: ImageInput[]): Promise<void> {
    this.state = { ...this.state, isStreaming: true };
    this.emit({ type: "agent_start" });
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${text}` },
    });
    this.state = { ...this.state, isStreaming: false, messageCount: this.state.messageCount + 2 };
    this.emit({ type: "agent_settled" });
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

  async stop(): Promise<void> {}

  private emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeFactory implements PiSessionFactory {
  readonly sessions = new Map<string, FakePiSession>();

  async create(options: { sessionId: string }): Promise<PiSession> {
    const session = this.sessions.get(options.sessionId) ?? new FakePiSession();
    this.sessions.set(options.sessionId, session);
    return session;
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
  it("keeps a Pi session alive across browser disconnect and replays missed events", async () => {
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

    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    const ack = await firstFrames.next();
    expect(ack).toMatchObject({ type: "ack", operation: "prompt", requestId: "r1" });
    const event = await firstFrames.next();
    expect(event).toMatchObject({ type: "event", event: { type: "agent_start" } });
    const delta = await firstFrames.next();
    expect(delta).toMatchObject({
      type: "event",
      event: { type: "message_update", assistantMessageEvent: { delta: "echo: hello" } },
    });
    const settled = await firstFrames.next();
    expect(settled.type).toBe("event");
    if (settled.type !== "event") throw new Error("expected event");
    const lastCursor = settled.cursor;
    first.close();
    await once(first, "close");

    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId, after: 0 }));
    const reopened = await secondFrames.next();
    expect(reopened).toMatchObject({ type: "opened", sessionId: opened.sessionId });
    const replayed: ServerFrame[] = [];
    while (replayed.length < lastCursor) replayed.push(await secondFrames.next());
    expect(replayed.some((frame) => frame.type === "event" && frame.cursor === lastCursor)).toBe(true);
    second.close();
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
