import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { WebServer } from "../src/web/server.js";

class FakeHost {
  private readonly http: HttpServer;
  private readonly sockets = new WebSocketServer({ noServer: true });
  private started = false;
  private readonly messages: Array<{ role: "user" | "assistant"; text: string }> = [];

  constructor(private readonly token = "host-token") {
    this.http = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, role: "host", protocolVersion: 1 }));
        return;
      }
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url === "/api/engines") {response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({engines:[{id:"pi",available:true},{id:"codex",available:true},{id:"claude",available:false}]}));return;}
      if (request.url === "/api/workspace" || request.url === "/api/skills") {
        if(request.method==="POST") {let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({forwarded:JSON.parse(body)}));});return;}
        response.writeHead(200, { "content-type": "application/json" });response.end(JSON.stringify({ projects: [], conversations: [] }));
        return;
      }
      if (request.url === "/api/revoke-files" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(404).end();
    });
    this.http.on("upgrade", (request, socket, head) => {
      if (request.url !== "/host" || request.headers.authorization !== `Bearer ${this.token}`) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit("connection", client));
    });
    this.sockets.on("connection", (client) => {
      client.on("message", (raw) => this.handle(client, raw));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolvePromise) => this.http.listen(0, "127.0.0.1", resolvePromise));
    this.started = true;
  }

  url(): string {
    const address = this.http.address();
    if (!address || typeof address === "string") throw new Error("Fake Host is not listening");
    return `ws://127.0.0.1:${address.port}/host`;
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const client of this.sockets.clients) client.close();
    this.sockets.close();
    await new Promise<void>((resolvePromise) => this.http.close(() => resolvePromise()));
    this.started = false;
  }

  private send(client: WebSocket, frame: unknown): void {
    client.send(JSON.stringify(frame));
  }

  private handle(client: WebSocket, raw: RawData): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      this.send(client, { v: 1, type: "error", code: "invalid_json", fatal: true });
      return;
    }
    if (frame.type === "list_sessions") {
      this.send(client, { v: 1, type: "sessions", sessions: this.messages.length ? [{ id: "s1", running: false }] : [] });
      return;
    }
    if (frame.type === "open") {
      this.send(client, { v: 1, type: "opened", sessionId: "s1", cursor: 0, state: { isStreaming: false, messageCount: this.messages.length } });
      this.send(client, { v: 1, type: "history", sessionId: "s1", leafId: null, truncated: false, entries: this.messages.map((item, index) => ({ kind: item.role, id: String(index), text: item.text })) });
      return;
    }
    if (frame.type === "prompt") {
      const text = String(frame.text ?? "");
      this.messages.push({ role: "user", text }, { role: "assistant", text: `echo: ${text}` });
      this.send(client, { v: 1, type: "ack", operation: "prompt", requestId: frame.requestId });
      this.send(client, { v: 1, type: "event", sessionId: "s1", cursor: 1, event: { type: "message_update", assistantMessageEvent: { delta: `echo: ${text}` } } });
      return;
    }
    // Deliberately accept a frame unknown to this Web build. This proves the
    // gateway does not duplicate or constrain the Agent Host protocol.
    this.send(client, { v: 1, type: "future_ack", received: frame });
  }
}

class JsonQueue {
  private readonly frames: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<(frame: Record<string, unknown>) => void> = [];
  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    });
  }
  next(): Promise<Record<string, unknown>> {
    const frame = this.frames.shift();
    return frame ? Promise.resolve(frame) : new Promise((resolvePromise) => this.waiters.push(resolvePromise));
  }
}

let host: FakeHost | undefined;
let web: WebServer | undefined;

afterEach(async () => {
  await web?.close();
  await host?.close();
  web = undefined;
  host = undefined;
});

async function connect(url: string, options?: ConstructorParameters<typeof WebSocket>[1]): Promise<WebSocket> {
  const socket = new WebSocket(url, options);
  await once(socket, "open");
  return socket;
}

describe("Web gateway seam", () => {
  it("forwards scoped Skill management to the authenticated Host and rejects cross-origin writes",async()=>{
    host=new FakeHost();await host.start();web=new WebServer({host:"127.0.0.1",port:0,hostUrl:host.url(),hostToken:"host-token"});await web.start();const base=`http://127.0.0.1:${web.address().port}`;
    const body={action:'install',engine:'pi',scope:'user',repoUrl:'https://example.com/skills.git',ref:'main',subdir:'skills/example'};
    const post=(origin:string)=>fetch(base+'/api/skills',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    expect((await post('https://unrelated.example')).status).toBe(403);
    const response=await post(base);expect(response.status).toBe(200);expect(await response.json()).toEqual({forwarded:body});
  });
  it("forwards authenticated Agent readiness to the fixed Host as read-only",async()=>{
    host=new FakeHost();await host.start();web=new WebServer({host:"127.0.0.1",port:0,hostUrl:host.url(),hostToken:"host-token"});await web.start();const base=`http://127.0.0.1:${web.address().port}`;
    const response=await fetch(base+"/api/engines");expect(response.status).toBe(200);expect((await response.json()).engines.map((e:any)=>e.id)).toEqual(["pi","codex","claude"]);
    expect((await fetch(base+"/api/engines",{method:"POST",headers:{origin:base}})).status).toBe(405);
  });
  it("forwards Checkout synchronization actions without implementing Git in the gateway",async()=>{
    host=new FakeHost();await host.start();web=new WebServer({host:"127.0.0.1",port:0,hostUrl:host.url(),hostToken:"host-token"});await web.start();const base=`http://127.0.0.1:${web.address().port}`;
    const response=await fetch(`${base}/api/workspace`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({action:"checkpoint",id:"c1",paths:["src/a.ts"],message:"checkpoint"})});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({forwarded:{action:"checkpoint",id:"c1",paths:["src/a.ts"],message:"checkpoint"}});
  });
  it("proxies Host frames, keeps Host state across browser disconnects, and forwards future frame types", async () => {
    host = new FakeHost();
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: host.url(), hostToken: "host-token" });
    await web.start();

    const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const frames = new JsonQueue(browser);
    browser.send(JSON.stringify({ v: 1, type: "open" }));
    expect(await frames.next()).toMatchObject({ type: "opened", sessionId: "s1" });
    expect(await frames.next()).toMatchObject({ type: "history", entries: [] });
    browser.send(JSON.stringify({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    expect(await frames.next()).toMatchObject({ type: "ack", requestId: "r1" });
    expect(await frames.next()).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: hello" } } });
    browser.send(JSON.stringify({ v: 1, type: "future_command", payload: { x: 1 } }));
    expect(await frames.next()).toMatchObject({ type: "future_ack", received: { type: "future_command" } });
    browser.close();
    await once(browser, "close");

    const again = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const replay = new JsonQueue(again);
    again.send(JSON.stringify({ v: 1, type: "open", sessionId: "s1" }));
    expect(await replay.next()).toMatchObject({ type: "opened", sessionId: "s1" });
    expect(await replay.next()).toMatchObject({ type: "history", entries: [{ kind: "user", text: "hello" }, { kind: "assistant", text: "echo: hello" }] });
    again.close();
  });

  it("serves only the flat shell asset allowlist", async () => {
    host = new FakeHost();
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: host.url(), hostToken: "host-token" });
    await web.start();
    const base = `http://127.0.0.1:${web.address().port}`;
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true, role: "web" });
    expect(await (await fetch(`${base}/`)).text()).toContain("PI Coffee");
    expect((await fetch(`${base}/app.css`)).headers.get("content-type")).toContain("text/css");
    for (const path of ["/nested/app.js", "/..%2Fpackage.json", "/package.json", "/app.js.map"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  it("serves HTTPS/WSS when configured with TLS", async () => {
    const cert = readFileSync(resolve("test/fixtures/tls/test-cert.pem"));
    const key = readFileSync(resolve("test/fixtures/tls/test-key.pem"));
    host = new FakeHost();
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: host.url(), hostToken: "host-token", tls: { cert, key } });
    await web.start();
    const page = await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
      httpsRequest({ host: "127.0.0.1", port: web!.address().port, path: "/", ca: cert }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body }));
      }).on("error", reject).end();
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain("PI Coffee");
    const browser = await connect(`wss://127.0.0.1:${web.address().port}/ws`, { ca: cert });
    const frames = new JsonQueue(browser);
    browser.send("not-json");
    expect(await frames.next()).toMatchObject({ type: "error", code: "invalid_json" });
    browser.close();
  });
});
