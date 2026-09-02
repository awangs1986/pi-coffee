import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServerFrame,
} from "../shared/protocol.js";
import { HostClient } from "./host-client.js";

export interface WebServerOptions {
  host?: string;
  port?: number;
  hostUrl: string;
  hostToken?: string;
  publicDir?: string;
}

export interface WebAddress {
  host: string;
  port: number;
}

/** Browser-facing HTTP and WebSocket server. */
export class WebServer {
  private readonly host: string;
  private readonly port: number;
  private readonly hostUrl: string;
  private readonly hostToken?: string;
  private readonly publicDir: string;
  private readonly http: HttpServer;
  private readonly wsServer: WebSocketServer;
  private readonly bridges = new Set<BrowserBridge>();
  private started = false;

  constructor(options: WebServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 3000;
    this.hostUrl = options.hostUrl;
    this.hostToken = options.hostToken;
    this.publicDir = options.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
    this.http = createServer((request, response) => void this.handleHttp(request, response));
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.wsServer.on("connection", (socket) => {
      const bridge = new BrowserBridge(socket, {
        url: this.hostUrl,
        token: this.hostToken,
      });
      this.bridges.add(bridge);
      bridge.onClose = () => this.bridges.delete(bridge);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        this.http.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off("error", onError);
        resolvePromise();
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    this.started = true;
  }

  address(): WebAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") throw new Error("WebServer is not listening");
    return { host: this.host, port: address.port };
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const bridge of this.bridges) bridge.close();
    this.bridges.clear();
    this.wsServer.close();
    await new Promise<void>((resolvePromise, reject) => {
      this.http.close((error) => (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ? reject(error)
        : resolvePromise()));
    });
    this.started = false;
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, role: "web" }));
      return;
    }
    if (path === "/" || path === "/index.html") {
      try {
        const html = await readFile(resolve(this.publicDir, "index.html"));
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
      } catch {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("PI Coffee shell is not installed");
      }
      return;
    }
    response.writeHead(404);
    response.end();
  }

  private handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.destroy();
      return;
    }
    this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.wsServer.emit("connection", websocket, request);
    });
  }
}

interface BrowserBridgeOptions {
  url: string;
  token?: string;
}

class BrowserBridge {
  private readonly browser: WebSocket;
  private readonly host: HostClient;
  private hostUnsubscribe?: () => void;
  private opened = false;
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  onClose: () => void = () => undefined;

  constructor(browser: WebSocket, options: BrowserBridgeOptions) {
    this.browser = browser;
    this.host = new HostClient({
      ...options,
      onUnavailable: (error) => {
        this.send({ v: 1, type: "error", code: "host_unavailable", message: error.message });
        this.close();
      },
    });
    browser.on("message", (data: RawData) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data)).catch(() => undefined);
    });
    browser.on("close", () => this.close());
    browser.on("error", () => this.close());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hostUnsubscribe?.();
    this.hostUnsubscribe = undefined;
    this.host.close();
    if (this.browser.readyState !== WebSocket.CLOSED) this.browser.close();
    this.onClose();
  }

  private send(frame: ServerFrame): void {
    if (this.closed || this.browser.readyState !== WebSocket.OPEN) return;
    try {
      this.browser.send(encodeFrame(frame));
    } catch {
      this.close();
    }
  }

  private async handleMessage(data: RawData): Promise<void> {
    if (this.closed) return;
    let frame: ClientFrame;
    try {
      frame = decodeClientFrame(rawDataToBytes(data));
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: error instanceof Error && "code" in error ? String(error.code) : "invalid_frame",
        message: error instanceof Error ? error.message : "Invalid frame",
        fatal: true,
      });
      this.browser.close(1008, "invalid frame");
      return;
    }

    if (frame.type === "close") {
      this.close();
      return;
    }
    if (frame.type === "ping") {
      this.send({ v: 1, type: "pong", nonce: frame.nonce });
      return;
    }
    if (frame.type !== "open" && !this.opened) {
      this.send({ v: 1, type: "error", code: "not_open", message: "Send open before other commands" });
      return;
    }

    try {
      if (frame.type === "open") {
        if (this.opened) {
          this.send({ v: 1, type: "error", code: "already_open", message: "Connection is already open" });
          return;
        }
        await this.host.connect();
        this.hostUnsubscribe = this.host.onFrame((hostFrame) => this.send(hostFrame));
        this.opened = true;
      }
      this.host.send(frame);
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: "host_unavailable",
        message: error instanceof Error ? error.message : "Host is unavailable",
      });
    }
  }
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}
