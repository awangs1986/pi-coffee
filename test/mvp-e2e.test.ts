import { once } from "node:events";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";
import { HostServer } from "../src/host/server.js";
import { decodeServerFrame, encodeFrame, type ServerFrame } from "../src/shared/protocol.js";
import { WebServer } from "../src/web/server.js";

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
    return new Promise((resolvePromise) => this.waiters.push(resolvePromise));
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

describe("PI Coffee MVP", () => {
  it("carries a browser prompt through the original Pi RPC process", async () => {
    host = new HostServer({
      host: "127.0.0.1",
      port: 0,
      factory: new RpcPiSessionFactory({
        cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"),
        cwd: process.cwd(),
        sessionDir: resolve(".tmp-mvp-sessions"),
      }),
    });
    await host.start();
    web = new WebServer({
      host: "127.0.0.1",
      port: 0,
      hostUrl: `ws://127.0.0.1:${host.address().port}/host`,
    });
    await web.start();

    const browser = new WebSocket(`ws://127.0.0.1:${web.address().port}/ws`);
    await once(browser, "open");
    const frames = new FrameQueue(browser);
    browser.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    expect(opened.type).toBe("opened");
    browser.send(encodeFrame({ v: 1, type: "prompt", requestId: "mvp-1", text: "hello Pi" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "prompt", requestId: "mvp-1" });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(await frames.next()).toMatchObject({
      type: "event",
      event: { type: "message_update", assistantMessageEvent: { delta: "echo: hello Pi" } },
    });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    browser.close();
    await once(browser, "close");
  }, 15_000);
});
