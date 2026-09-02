import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import type { PiSession, PiSessionFactory } from "../src/host/pi-adapter.js";
import { WebServer } from "../src/web/server.js";
import { decodeServerFrame, encodeFrame, type ImageInput, type ServerFrame } from "../src/shared/protocol.js";

class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  private state = { isStreaming: false, messageCount: 0 };

  async prompt(text: string, _images?: ImageInput[]): Promise<void> {
    this.state = { ...this.state, isStreaming: true };
    this.emit({ type: "agent_start" });
    this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `echo: ${text}` } });
    this.state = { isStreaming: false, messageCount: this.state.messageCount + 2 };
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
  private readonly sessions = new Map<string, FakePiSession>();

  async create(options: { sessionId: string }): Promise<PiSession> {
    const existing = this.sessions.get(options.sessionId);
    if (existing) return existing;
    const session = new FakePiSession();
    this.sessions.set(options.sessionId, session);
    return session;
  }
}

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
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

let host: HostServer | undefined;
let web: WebServer | undefined;

afterEach(async () => {
  await web?.close();
  await host?.close();
  web = undefined;
  host = undefined;
});

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

describe("Web Server seam", () => {
  it("bridges a browser conversation to Host and serves the shell", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();

    const health = await fetch(`http://127.0.0.1:${web.address().port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, role: "web" });
    const shell = await fetch(`http://127.0.0.1:${web.address().port}/`);
    expect(await shell.text()).toContain("PI Coffee");

    const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const frames = new FrameQueue(browser);
    browser.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    expect(opened.type).toBe("opened");
    if (opened.type !== "opened") throw new Error("expected opened");
    browser.send(encodeFrame({ v: 1, type: "prompt", requestId: "web-r1", text: "hello web" }));
    expect(await frames.next()).toMatchObject({ type: "ack", requestId: "web-r1" });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(await frames.next()).toMatchObject({
      type: "event",
      event: { assistantMessageEvent: { delta: "echo: hello web" } },
    });
    const settled = await frames.next();
    expect(settled.type).toBe("event");
    if (settled.type !== "event") throw new Error("expected event");
    const cursor = settled.cursor;
    const sessionId = opened.sessionId;
    browser.close();
    await once(browser, "close");

    const reconnected = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const replay = new FrameQueue(reconnected);
    reconnected.send(encodeFrame({ v: 1, type: "open", sessionId, after: 0 }));
    expect(await replay.next()).toMatchObject({ type: "opened", sessionId });
    const replayed: ServerFrame[] = [];
    while (replayed.length < cursor) replayed.push(await replay.next());
    expect(replayed.some((frame) => frame.type === "event" && frame.cursor === cursor)).toBe(true);
    reconnected.close();
  });

  it("returns a structured error when the browser sends malformed JSON", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();
    const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const frames = new FrameQueue(browser);
    browser.send("not-json");
    await expect(frames.next()).resolves.toMatchObject({ type: "error", code: "invalid_json", fatal: true });
    browser.close();
  });
});
