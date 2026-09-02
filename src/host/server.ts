import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServerFrame,
} from "../shared/protocol.js";
import type { PiSessionFactory } from "./pi-adapter.js";
import { HostSession, HostSessionRegistry, SessionBusyError, type SessionSink } from "./session.js";

export interface HostServerOptions {
  host?: string;
  port?: number;
  token?: string;
  factory: PiSessionFactory;
  eventBufferSize?: number;
}

export interface HostAddress {
  host: string;
  port: number;
}

/**
 * Private WebSocket listener for User VM sessions.  It owns no Pi details;
 * those live behind PiSessionFactory.
 */
export class HostServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token?: string;
  private readonly registry: HostSessionRegistry;
  private readonly http: HttpServer;
  private readonly sockets = new Set<HostSocket>();
  private readonly wsServer: WebSocketServer;
  private started = false;

  constructor(options: HostServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8788;
    this.token = options.token;
    this.registry = new HostSessionRegistry({
      factory: options.factory,
      eventBufferSize: options.eventBufferSize,
    });
    this.http = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, role: "host" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.wsServer.on("connection", (socket, request) => {
      const hostSocket = new HostSocket(socket, request, this.registry, this.token);
      this.sockets.add(hostSocket);
      hostSocket.onClose = () => this.sockets.delete(hostSocket);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.http.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off("error", onError);
        resolve();
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    this.started = true;
  }

  address(): HostAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") {
      throw new Error("HostServer is not listening");
    }
    return { host: this.host, port: address.port };
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    await this.registry.close();
    this.wsServer.close();
    await new Promise<void>((resolve, reject) => {
      this.http.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
  }

  private handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/host") {
      socket.destroy();
      return;
    }
    if (!isAuthorized(request, this.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.wsServer.emit("connection", websocket, request);
    });
  }
}

class HostSocket implements SessionSink {
  private readonly socket: WebSocket;
  private readonly registry: HostSessionRegistry;
  private session?: HostSession;
  private opened = false;
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  onClose: () => void = () => undefined;

  constructor(socket: WebSocket, _request: IncomingMessage, registry: HostSessionRegistry, _token?: string) {
    this.socket = socket;
    this.registry = registry;
    socket.on("message", (data) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data)).catch(() => undefined);
    });
    socket.on("close", () => void this.detach());
    socket.on("error", () => void this.detach());
  }

  send(frame: ServerFrame): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(encodeFrame(frame));
    } catch {
      void this.detach();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
    void this.detach();
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
      this.socket.close(1008, "invalid frame");
      return;
    }

    try {
      switch (frame.type) {
        case "open":
          await this.open(frame);
          break;
        case "prompt":
          await this.prompt(frame);
          break;
        case "abort":
          await this.abort(frame);
          break;
        case "ping":
          if (!this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "pong", nonce: frame.nonce });
          break;
        case "close":
          this.socket.close(1000, "client closed");
          break;
      }
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: error instanceof SessionBusyError
          ? "busy"
          : error instanceof NotOpenError
            ? "not_open"
            : "operation_failed",
        message: error instanceof Error ? error.message : "Operation failed",
        ...(frame.type === "prompt" ? { requestId: frame.requestId } : {}),
      });
    }
  }

  private async open(frame: Extract<ClientFrame, { type: "open" }>): Promise<void> {
    if (this.opened) {
      this.send({ v: 1, type: "error", code: "already_open", message: "Connection is already open" });
      return;
    }
    const result = await this.registry.open(frame.sessionId, frame.after);
    this.session = result.session;
    this.opened = true;
    const state = result.session.currentState;
    // Attach before replaying. No await occurs between these operations, so a
    // Pi event cannot be delivered to this socket ahead of the opened frame.
    result.session.attach(this);
    this.send({
      v: 1,
      type: "opened",
      sessionId: result.session.id,
      cursor: result.session.currentCursor,
      state,
    });
    if (result.resync) {
      this.send({
        v: 1,
        type: "resync_required",
        sessionId: result.session.id,
        oldestCursor: result.resync.oldestCursor,
        newestCursor: result.resync.newestCursor,
      });
      return;
    }
    for (const replay of result.replay) this.send(replay);
  }

  private async prompt(frame: Extract<ClientFrame, { type: "prompt" }>): Promise<void> {
    if (!this.session || !this.opened) throw new Error("Connection must be opened first");
    this.session.reservePrompt(frame.requestId);
    // Acknowledgement means the command crossed the seam and was accepted;
    // lifecycle events continue asynchronously after it.
    this.send({ v: 1, type: "ack", operation: "prompt", requestId: frame.requestId });
    // Yield one turn after the acknowledgement. This gives every transport a
    // deterministic command/event ordering even when a test adapter emits its
    // first Pi event synchronously.
    setImmediate(() => {
      void this.session?.prompt(frame.requestId, frame.text, frame.images).catch((error) => {
        this.send({
          v: 1,
          type: "error",
          code: error instanceof SessionBusyError ? "busy" : "operation_failed",
          message: error instanceof Error ? error.message : "Prompt failed",
          requestId: frame.requestId,
        });
      });
    });
  }

  private async abort(frame: Extract<ClientFrame, { type: "abort" }>): Promise<void> {
    if (!this.session || !this.opened) throw new Error("Connection must be opened first");
    await this.session.abort();
    this.send({ v: 1, type: "ack", operation: "abort", ...(frame.requestId === undefined ? {} : { requestId: frame.requestId }) });
  }

  private async detach(): Promise<void> {
    if (this.closed) {
      this.session?.detach(this);
      this.onClose();
      return;
    }
    this.closed = true;
    this.session?.detach(this);
    this.onClose();
  }
}

class NotOpenError extends Error {
  constructor() {
    super("Connection must be opened first");
    this.name = "NotOpenError";
  }
}

function isAuthorized(request: IncomingMessage, token?: string): boolean {
  if (token === undefined) return true;
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${token}`;
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}
