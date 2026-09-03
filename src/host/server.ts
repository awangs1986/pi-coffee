import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  decodeClientFrame,
  encodeFrame,
  MAX_FRAME_BYTES,
  type ClientFrame,
  type HistoryEntry,
  type JsonValue,
  type ServerFrame,
} from "../shared/protocol.js";
import type { PiSessionFactory } from "./pi-adapter.js";
import { HostSession, HostSessionRegistry, SessionBusyError, type SessionSink } from "./session.js";
import type { TransferServer } from "./transfer.js";

export interface HostServerOptions {
  host?: string;
  port?: number;
  token?: string;
  factory: PiSessionFactory;
  eventBufferSize?: number;
  /** Stop idle Pi processes after this long; the conversation stays in Pi's session store. */
  idleTimeoutMs?: number;
  /** LocalSend v2 transfer endpoint on the User VM; browsers are told about it after `opened`. */
  transfer?: TransferServer;
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
  private readonly transfer?: TransferServer;
  private readonly http: HttpServer;
  private readonly sockets = new Set<HostSocket>();
  private readonly wsServer: WebSocketServer;
  private started = false;

  constructor(options: HostServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8788;
    this.token = options.token;
    this.transfer = options.transfer;
    this.registry = new HostSessionRegistry({
      factory: options.factory,
      eventBufferSize: options.eventBufferSize,
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
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
      const hostSocket = new HostSocket(socket, request, this.registry, this.transfer);
      this.sockets.add(hostSocket);
      hostSocket.onClose = () => this.sockets.delete(hostSocket);
    });
    // Every browser's sidebar mirrors the same store: push the list whenever
    // it changes instead of making each browser poll.
    this.registry.onChange(() => void this.broadcastSessions());
  }

  private broadcastTimer?: ReturnType<typeof setTimeout>;

  private async broadcastSessions(): Promise<void> {
    if (this.broadcastTimer !== undefined) return;
    this.broadcastTimer = setTimeout(async () => {
      this.broadcastTimer = undefined;
      if (this.sockets.size === 0) return;
      try {
        const sessions = await this.registry.list();
        for (const socket of this.sockets) socket.send({ v: 1, type: "sessions", sessions });
      } catch {
        // Listing is best-effort; the browser can still ask explicitly.
      }
    }, 150);
  }

  async start(): Promise<void> {
    if (this.started) return;
    // Fail closed: the Host transport carries prompts and Pi events. Without a
    // bearer token, anything that can reach the port owns the User VM's Pi.
    // Loopback-only binds are the documented local smoke exception.
    if (!isLoopback(this.host) && (this.token === undefined || this.token.length === 0)) {
      throw new Error(
        `Refusing to bind the Host to ${this.host} without PI_COFFEE_HOST_TOKEN; set a transport token or bind to 127.0.0.1`,
      );
    }
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

  /** Publish a Host-originated event (transfer progress, …) to a live Session's browsers. */
  announce(sessionId: string, event: JsonValue): void {
    this.registry.get(sessionId)?.announce(event);
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
  private readonly transfer?: TransferServer;
  private session?: HostSession;
  private opened = false;
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  onClose: () => void = () => undefined;

  constructor(socket: WebSocket, _request: IncomingMessage, registry: HostSessionRegistry, transfer?: TransferServer) {
    this.socket = socket;
    this.registry = registry;
    this.transfer = transfer;
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
        case "list_sessions":
          // Allowed before open: the sidebar needs the list to choose from.
          this.send({ v: 1, type: "sessions", sessions: await this.registry.list() });
          break;
        case "delete_session":
          // Allowed before open: deleting from the sidebar must not require
          // attaching to the conversation first.
          if (!(await this.registry.delete(frame.sessionId))) {
            this.send({ v: 1, type: "error", code: "unknown_session", message: "No such conversation", ...rid(frame) });
            break;
          }
          if (this.session?.id === frame.sessionId) {
            this.session = undefined;
            this.opened = false;
          }
          this.send({ v: 1, type: "ack", operation: "delete_session", ...rid(frame) });
          break;
        case "rename_session":
          if (frame.sessionId !== undefined && frame.sessionId !== this.session?.id) {
            await this.registry.rename(frame.sessionId, frame.name);
          } else {
            if (!this.session || !this.opened) throw new NotOpenError();
            await this.registry.rename(this.session.id, frame.name);
          }
          this.send({ v: 1, type: "ack", operation: "rename_session", ...rid(frame) });
          break;
        case "prompt":
          await this.prompt(frame);
          break;
        case "abort":
          await this.abort(frame);
          break;
        case "get_models": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const models = await this.session.getModels();
          this.send({ v: 1, type: "models", ...models });
          break;
        }
        case "set_model":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setModel(frame.provider, frame.id);
          this.send({ v: 1, type: "ack", operation: "set_model", ...rid(frame) });
          break;
        case "set_thinking":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setThinkingLevel(frame.level);
          this.send({ v: 1, type: "ack", operation: "set_thinking", ...rid(frame) });
          break;
        case "get_commands":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "commands", commands: await this.session.getCommands() });
          break;
        case "get_extensions":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "extensions", sessionId: this.session.id, extensions: await this.session.getExtensions() });
          break;
        case "get_stats":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "stats", sessionId: this.session.id, stats: await this.session.getStats() });
          break;
        case "compact":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "ack", operation: "compact", ...rid(frame) });
          await this.session.compact();
          break;
        case "ui_response": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const { v: _v, type: _t, requestId: _r, ...response } = frame;
          if (!this.session.hasPendingUi(response.id)) {
            this.send({ v: 1, type: "error", code: "unknown_ui_request", message: "That dialog is no longer waiting for an answer", ...rid(frame) });
            break;
          }
          // Ack first: the answer crossed the seam. Pi's follow-on events
          // (the run resuming) arrive after it.
          this.send({ v: 1, type: "ack", operation: "ui_response", ...rid(frame) });
          await this.session.respondUi(response);
          break;
        }
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
        ...rid(frame),
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
    this.send(boundedHistoryFrame(result.session.id, result.history.entries, result.history.leafId));
    if (this.transfer) {
      this.send({
        v: 1,
        type: "transfer",
        sessionId: result.session.id,
        url: this.transfer.publicUrl(),
        scope: result.session.id,
        token: this.transfer.issueToken(result.session.id),
        inbox: this.transfer.inboxFor(result.session.id).split("\\").join("/"),
        maxFileBytes: this.transfer.limits.maxFileBytes,
        maxBatchBytes: this.transfer.limits.maxBatchBytes,
      });
    }
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
    // A dialog Pi is still blocked on must reach this browser even if the
    // request itself predates the replay window (e.g. after a reload).
    const replayed = new Set(result.replay.map((frame) => (frame.type === "event" ? frame.cursor : -1)));
    for (const pending of result.session.pendingUiRequests) {
      if (pending.type === "event" && !replayed.has(pending.cursor)) this.send(pending);
    }
  }

  private async prompt(frame: Extract<ClientFrame, { type: "prompt" }>): Promise<void> {
    if (!this.session || !this.opened) throw new NotOpenError();
    if (frame.mode === "steer" || frame.mode === "follow_up") {
      // Joining a busy run: Pi owns the queue and reports it via queue_update.
      // If nothing is running, treat it as a plain prompt so the message is
      // never silently parked.
      if (this.session.isStreaming) {
        // Same contract as prompt: the ack means "accepted at the seam"; Pi's
        // queue_update event follows and is the authoritative queue state.
        this.send({ v: 1, type: "ack", operation: frame.mode, requestId: frame.requestId });
        await this.session.enqueue(frame.mode, frame.text, frame.images);
        return;
      }
    }
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

function rid(frame: ClientFrame): { requestId?: string } {
  return "requestId" in frame && typeof frame.requestId === "string" ? { requestId: frame.requestId } : {};
}

class NotOpenError extends Error {
  constructor() {
    super("Connection must be opened first");
    this.name = "NotOpenError";
  }
}

/**
 * The history frame must respect MAX_FRAME_BYTES. Keep the newest entries and
 * flag truncation; older conversation stays in the User VM's session file.
 */
function boundedHistoryFrame(sessionId: string, entries: HistoryEntry[], leafId: string | null): ServerFrame {
  const budget = MAX_FRAME_BYTES - 4096;
  let kept = entries;
  let truncated = false;
  const measure = (list: HistoryEntry[]) => Buffer.byteLength(JSON.stringify(list), "utf8");
  while (kept.length > 0 && measure(kept) > budget) {
    kept = kept.slice(Math.max(1, Math.floor(kept.length / 4)));
    truncated = true;
  }
  return { v: 1, type: "history", sessionId, entries: kept, leafId, truncated };
}

function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
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
