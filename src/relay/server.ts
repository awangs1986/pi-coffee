import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface RelayServerOptions {
  host?: string;
  port?: number;
  /** Upstream OpenAI-compatible base URL including `/v1`, e.g. `https://b.awangsawangs.xyz/v1`. */
  upstreamBaseUrl: string;
  /** The sole upstream credential. Lives only in the Control Plane process. */
  upstreamKey: string;
  /** Bearer tokens Hosts present. Required unless bound to loopback. */
  clientTokens?: string[];
  /** Fail the request if upstream response headers do not arrive in time. */
  upstreamHeadersTimeoutMs?: number;
  /** Request bodies are buffered (they must be complete for the upstream); cap them. */
  maxRequestBytes?: number;
  /** Bounded usage metadata sink. Records never contain bodies or credentials. */
  onRecord?: (record: RelayRecord) => void;
  /** In-memory ring of recent records exposed via `records()`. */
  recordLimit?: number;
}

export type RelayOutcome =
  | "completed"
  | "rejected"
  | "upstream_error"
  | "upstream_unreachable"
  | "upstream_timeout"
  | "upstream_stream_broken"
  | "client_aborted";

/**
 * Bounded, content-free usage metadata (D-018). Deliberately no prompt, tool
 * output, response text, headers, or credentials.
 */
export interface RelayRecord {
  id: string;
  startedAt: string;
  method: string;
  route: string;
  model?: string;
  stream: boolean;
  status?: number;
  outcome: RelayOutcome;
  durationMs: number;
  firstByteMs?: number;
  requestBytes: number;
  responseBytes: number;
}

export interface RelayAddress {
  host: string;
  port: number;
}

const ROUTES: Record<string, ReadonlySet<string>> = {
  "/v1/models": new Set(["GET"]),
  "/v1/chat/completions": new Set(["POST"]),
  "/v1/responses": new Set(["POST"]),
  "/v1/responses/compact": new Set(["POST"]),
};

/** Never forwarded in either direction: hop-by-hop, framing, and credentials. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailer",
  "expect",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "trailer",
  "upgrade",
]);

/**
 * Transparent LLM Relay for the Control Plane (CP-001 / ADR-0003).
 *
 * It owns exactly one secret, the upstream key, and does exactly one thing per
 * request: swap the Host's transport token for that key and pipe bytes. It
 * does not parse model protocols, does not buffer response streams, and keeps
 * only bounded metadata.
 */
export class RelayServer {
  private readonly host: string;
  private readonly port: number;
  private readonly upstreamBaseUrl: string;
  private readonly upstreamKey: string;
  private readonly clientTokens: Set<string>;
  private readonly upstreamHeadersTimeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly onRecord?: (record: RelayRecord) => void;
  private readonly recordLimit: number;
  private readonly recent: RelayRecord[] = [];
  private readonly http: HttpServer;
  private readonly inflight = new Set<AbortController>();
  private started = false;

  constructor(options: RelayServerOptions) {
    if (options.upstreamKey.length === 0) {
      throw new Error("Relay needs the upstream credential: set PI_COFFEE_UPSTREAM_KEY");
    }
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8789;
    this.upstreamBaseUrl = options.upstreamBaseUrl.replace(/\/+$/, "");
    this.upstreamKey = options.upstreamKey;
    this.clientTokens = new Set((options.clientTokens ?? []).filter((token) => token.length > 0));
    this.upstreamHeadersTimeoutMs = options.upstreamHeadersTimeoutMs ?? 60_000;
    this.maxRequestBytes = options.maxRequestBytes ?? 32 * 1024 * 1024;
    this.onRecord = options.onRecord;
    this.recordLimit = options.recordLimit ?? 1000;
    this.http = createServer((request, response) => void this.handle(request, response));
    // Streams can legitimately sit idle for a long time between tokens.
    this.http.requestTimeout = 0;
    this.http.headersTimeout = 60_000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!isLoopback(this.host) && this.clientTokens.size === 0) {
      throw new Error(
        `Refusing to bind the Relay to ${this.host} without PI_COFFEE_RELAY_TOKENS; the Relay holds the upstream key`,
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

  address(): RelayAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") {
      throw new Error("RelayServer is not listening");
    }
    return { host: this.host, port: address.port };
  }

  /** Most recent bounded records, oldest first. */
  records(): RelayRecord[] {
    return [...this.recent];
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const controller of this.inflight) controller.abort();
    this.http.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.http.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAtMs = Date.now();
    const url = new URL(request.url ?? "/", "http://relay.local");
    const method = request.method ?? "GET";
    const record: RelayRecord = {
      id: randomUUID(),
      startedAt: new Date(startedAtMs).toISOString(),
      method,
      route: url.pathname,
      stream: false,
      outcome: "rejected",
      durationMs: 0,
      requestBytes: 0,
      responseBytes: 0,
    };
    const finish = (outcome: RelayOutcome, status?: number) => {
      record.outcome = outcome;
      if (status !== undefined) record.status = status;
      record.durationMs = Date.now() - startedAtMs;
      this.emit(record);
    };
    const reject = (status: number, type: string, message: string) => {
      sendJson(response, status, { error: { message, type } });
      finish("rejected", status);
    };

    if (url.pathname === "/healthz" && method === "GET") {
      sendJson(response, 200, { ok: true, role: "relay" });
      return;
    }

    const allowedMethods = ROUTES[url.pathname];
    if (allowedMethods === undefined) {
      reject(404, "relay_unknown_route", `The Relay does not expose ${url.pathname}`);
      return;
    }
    if (!allowedMethods.has(method)) {
      response.setHeader("allow", [...allowedMethods].join(", "));
      reject(405, "relay_method_not_allowed", `${method} is not allowed on ${url.pathname}`);
      return;
    }
    if (!this.isAuthorized(request)) {
      response.setHeader("www-authenticate", "Bearer");
      reject(401, "relay_unauthorized", "Missing or invalid Relay token");
      return;
    }

    let body: Buffer | undefined;
    if (method !== "GET") {
      try {
        body = await readBody(request, this.maxRequestBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          reject(413, "relay_request_too_large", `Request body exceeds ${this.maxRequestBytes} bytes`);
          return;
        }
        finish("client_aborted");
        response.destroy();
        return;
      }
      record.requestBytes = body.length;
      const meta = peekModelAndStream(body);
      record.model = meta.model;
      record.stream = meta.stream;
    }

    const controller = new AbortController();
    this.inflight.add(controller);
    let clientLeft = false;
    let upstreamBroke = false;
    response.on("close", () => {
      // pipeline() tears the response down when the upstream errors too; only
      // a close that happens while the upstream is healthy is the client's.
      if (response.writableFinished || upstreamBroke) return;
      clientLeft = true;
      controller.abort(new ClientAbortedError());
    });

    const headersTimer = setTimeout(
      () => controller.abort(new UpstreamTimeoutError(this.upstreamHeadersTimeoutMs)),
      this.upstreamHeadersTimeoutMs,
    );

    let upstream: Response;
    try {
      upstream = await fetch(`${this.upstreamBaseUrl}${url.pathname.slice("/v1".length)}${url.search}`, {
        method,
        headers: this.upstreamHeaders(request),
        body: body === undefined ? undefined : new Uint8Array(body),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      clearTimeout(headersTimer);
      this.inflight.delete(controller);
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      if (clientLeft) {
        finish("client_aborted");
        return;
      }
      if (reason instanceof UpstreamTimeoutError) {
        sendJson(response, 504, { error: { message: reason.message, type: "relay_upstream_timeout" } });
        finish("upstream_timeout", 504);
        return;
      }
      sendJson(response, 502, {
        error: { message: "The Relay could not reach the upstream model endpoint", type: "relay_upstream_unreachable" },
      });
      finish("upstream_unreachable", 502);
      return;
    }
    clearTimeout(headersTimer);
    record.firstByteMs = Date.now() - startedAtMs;

    response.writeHead(upstream.status, downstreamHeaders(upstream.headers));
    response.socket?.setNoDelay(true);
    response.flushHeaders();

    if (upstream.body === null) {
      response.end();
      this.inflight.delete(controller);
      finish(upstream.ok ? "completed" : "upstream_error", upstream.status);
      return;
    }

    const source = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>);
    source.on("data", (chunk: Buffer) => {
      record.responseBytes += chunk.length;
    });
    source.once("error", () => {
      if (!clientLeft) upstreamBroke = true;
    });
    try {
      // pipeline() honours backpressure: a slow browser/Host pauses the
      // upstream read instead of growing a buffer inside the Relay.
      await pipeline(source, response);
      finish(upstream.ok ? "completed" : "upstream_error", upstream.status);
    } catch {
      finish(clientLeft ? "client_aborted" : "upstream_stream_broken", upstream.status);
      // Headers are already out; the only honest signal left is a broken
      // connection, never a clean end that looks like a complete answer.
      response.destroy();
    } finally {
      this.inflight.delete(controller);
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    if (this.clientTokens.size === 0) return isLoopback(this.host);
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
    return this.clientTokens.has(authorization.slice("Bearer ".length).trim());
  }

  private upstreamHeaders(request: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || STRIPPED_REQUEST_HEADERS.has(name)) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else {
        headers.set(name, value);
      }
    }
    headers.set("authorization", `Bearer ${this.upstreamKey}`);
    // The Relay forwards raw bytes; do not let the upstream compress them
    // into something fetch would transparently decode and re-frame.
    headers.set("accept-encoding", "identity");
    return headers;
  }

  private emit(record: RelayRecord): void {
    this.recent.push(record);
    if (this.recent.length > this.recordLimit) this.recent.splice(0, this.recent.length - this.recordLimit);
    this.onRecord?.(record);
  }
}

class BodyTooLargeError extends Error {}

class ClientAbortedError extends Error {
  constructor() {
    super("Client disconnected");
    this.name = "ClientAbortedError";
  }
}

class UpstreamTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Upstream did not respond within ${timeoutMs} ms`);
    this.name = "UpstreamTimeoutError";
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        request.removeAllListeners("data");
        request.resume();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
    request.on("aborted", () => reject(new ClientAbortedError()));
  });
}

/**
 * Extract only what the metadata needs. The parsed object is dropped
 * immediately; nothing else from the body is retained.
 */
function peekModelAndStream(body: Buffer): { model?: string; stream: boolean } {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { model?: unknown; stream?: unknown };
    return {
      model: typeof parsed.model === "string" ? parsed.model.slice(0, 128) : undefined,
      stream: parsed.stream === true,
    };
  } catch {
    return { stream: false };
  }
}

function downstreamHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(name)) out[name] = value;
  });
  return out;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
