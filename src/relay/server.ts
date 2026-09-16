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
  /** Optional Serper credential; like upstreamKey it is held only here. */
  serperApiKey?: string;
  /** Injectable endpoint for tests; production defaults to Serper's API. */
  serperEndpoint?: string;
  serperTimeoutMs?: number;
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
  "/v1/search/serper": new Set(["POST"]),
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
  private readonly serperApiKey?: string;
  private readonly serperEndpoint: string;
  private readonly serperTimeoutMs: number;
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
    if (options.upstreamKey.length === 0 && !(options.serperApiKey?.trim())) {
      throw new Error("Relay needs an upstream or Serper credential: set PI_COFFEE_UPSTREAM_KEY or PI_COFFEE_SERPER_KEY");
    }
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8789;
    this.upstreamBaseUrl = options.upstreamBaseUrl.replace(/\/+$/, "");
    this.upstreamKey = options.upstreamKey;
    this.serperApiKey = options.serperApiKey?.trim() || undefined;
    this.serperEndpoint = options.serperEndpoint ?? "https://google.serper.dev/search";
    this.serperTimeoutMs = options.serperTimeoutMs ?? 60_000;
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

    if (url.pathname === "/v1/search/serper") {
      await this.handleSerperSearch(request, response, record, body ?? Buffer.alloc(0));
      return;
    }

    if (this.upstreamKey.length === 0) {
      reject(503, "relay_upstream_unconfigured", "OpenAI-compatible upstream is not configured on the Control Plane");
      return;
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

  private async handleSerperSearch(
    request: IncomingMessage,
    response: ServerResponse,
    record: RelayRecord,
    body: Buffer,
  ): Promise<void> {
    const startedAt = Date.now();
    if (this.serperApiKey === undefined) {
      sendJson(response, 503, { error: { message: "Serper search is not configured on the Control Plane", type: "relay_search_unconfigured" } });
      this.emit({ ...record, outcome: "rejected", status: 503, durationMs: Date.now() - startedAt });
      return;
    }
    let input: SerperSearchRequest;
    try {
      input = parseSerperSearchRequest(body);
    } catch (error) {
      sendJson(response, 400, { error: { message: errorMessage(error), type: "relay_search_invalid_request" } });
      this.emit({ ...record, outcome: "rejected", status: 400, durationMs: Date.now() - startedAt });
      return;
    }

    const controller = new AbortController();
    this.inflight.add(controller);
    let clientLeft = false;
    const onClose = () => {
      if (response.writableFinished) return;
      clientLeft = true;
      controller.abort();
    };
    response.once("close", onClose);
    const timer = setTimeout(() => controller.abort(), this.serperTimeoutMs);
    try {
      const responses = await Promise.all(input.queries.map((query) => this.fetchSerper(query, input, controller.signal)));
      const results = responses.flatMap((entries) => entries).slice(0, input.queries.length * input.numResults);
      const payload = {
        responseId: randomUUID(),
        provider: "serper",
        queries: input.queries,
        results,
      };
      const serialized = JSON.stringify(payload);
      record.responseBytes = Buffer.byteLength(serialized, "utf8");
      record.firstByteMs = Date.now() - startedAt;
      sendJson(response, 200, payload);
      this.emit({ ...record, outcome: "completed", status: 200, durationMs: Date.now() - startedAt });
    } catch (error) {
      if (clientLeft) {
        this.emit({ ...record, outcome: "client_aborted", durationMs: Date.now() - startedAt });
      } else if (controller.signal.aborted) {
        sendJson(response, 504, { error: { message: `Serper search timed out after ${this.serperTimeoutMs} ms`, type: "relay_search_timeout" } });
        this.emit({ ...record, outcome: "upstream_timeout", status: 504, durationMs: Date.now() - startedAt });
      } else {
        sendJson(response, 502, { error: { message: `Serper search failed: ${redactSearchError(error, this.serperApiKey)}`, type: "relay_search_error" } });
        this.emit({ ...record, outcome: "upstream_error", status: 502, durationMs: Date.now() - startedAt });
      }
    } finally {
      clearTimeout(timer);
      response.off("close", onClose);
      this.inflight.delete(controller);
    }
  }

  private async fetchSerper(query: string, input: SerperSearchRequest, signal: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch(this.serperEndpoint, {
      method: "POST",
      headers: { "x-api-key": this.serperApiKey!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        q: buildSerperQuery(query, input.domainFilter),
        num: input.numResults,
        ...(input.recencyFilter === undefined ? {} : { tbs: RECENCY_TBS[input.recencyFilter] }),
      }),
      signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Serper upstream ${response.status}: ${raw.slice(0, 300)}`);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("Serper upstream returned invalid JSON"); }
    if (!isRecord(parsed) || !Array.isArray(parsed.organic)) throw new Error("Serper upstream response has no organic results");
    return parsed.organic.map((entry) => normalizeSearchResult(entry, input.domainFilter)).filter((entry): entry is SearchResult => entry !== undefined).slice(0, input.numResults);
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

type SerperRecency = "day" | "week" | "month" | "year";

interface SerperSearchRequest {
  queries: string[];
  numResults: number;
  recencyFilter?: SerperRecency;
  domainFilter: string[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const RECENCY_TBS: Record<SerperRecency, string> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

function parseSerperSearchRequest(body: Buffer): SerperSearchRequest {
  let value: unknown;
  try { value = JSON.parse(body.toString("utf8")); } catch { throw new Error("request body must be JSON"); }
  if (!isRecord(value)) throw new Error("request body must be an object");
  const rawQueries = [
    ...(typeof value.query === "string" ? [value.query] : []),
    ...(Array.isArray(value.queries) ? value.queries : []),
  ];
  if (rawQueries.some((query) => typeof query !== "string")) throw new Error("query values must be strings");
  const queries = [...new Set(rawQueries.map((query) => query.trim()).filter(Boolean))];
  if (queries.length === 0 || queries.length > 4) throw new Error("provide 1 to 4 non-empty queries");
  if (queries.some((query) => query.length > 512)) throw new Error("query exceeds 512 characters");
  const numResults = value.numResults === undefined ? 5 : value.numResults;
  if (typeof numResults !== "number" || !Number.isSafeInteger(numResults) || numResults < 1 || numResults > 20) throw new Error("numResults must be an integer from 1 to 20");
  const recencyFilter = value.recencyFilter;
  if (recencyFilter !== undefined && recencyFilter !== "day" && recencyFilter !== "week" && recencyFilter !== "month" && recencyFilter !== "year") throw new Error("invalid recencyFilter");
  const domainFilter = Array.isArray(value.domainFilter)
    ? value.domainFilter.filter((domain): domain is string => typeof domain === "string").map((domain) => domain.trim()).filter(Boolean).slice(0, 20)
    : [];
  return { queries, numResults, ...(recencyFilter === undefined ? {} : { recencyFilter }), domainFilter };
}

function buildSerperQuery(query: string, domains: string[]): string {
  const clauses = [query];
  for (const raw of domains) {
    const excluded = raw.startsWith("-");
    const domain = raw.replace(/^[-+]/, "").replace(/^https?:\/\//i, "").split("/")[0]?.trim();
    if (!domain || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) continue;
    clauses.push(`${excluded ? "-" : ""}site:${domain}`);
  }
  return clauses.join(" ");
}

function normalizeSearchResult(value: unknown, domains: string[]): SearchResult | undefined {
  if (!isRecord(value) || typeof value.link !== "string" || !/^https?:\/\//i.test(value.link)) return undefined;
  if (!passesDomains(value.link, domains)) return undefined;
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 512) : "Untitled source",
    url: value.link.slice(0, 2048),
    snippet: typeof value.snippet === "string" ? value.snippet.slice(0, 1_000) : "",
  };
}

function passesDomains(rawUrl: string, domains: string[]): boolean {
  const include = domains.filter((domain) => !domain.startsWith("-")).map(normalizeDomain).filter((domain): domain is string => domain !== undefined);
  const exclude = domains.filter((domain) => domain.startsWith("-")).map((domain) => normalizeDomain(domain.slice(1))).filter((domain): domain is string => domain !== undefined);
  let hostname: string;
  try { hostname = new URL(rawUrl).hostname.toLowerCase(); } catch { return false; }
  const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  if (exclude.some(matches)) return false;
  return include.length === 0 || include.some(matches);
}

function normalizeDomain(value: string): string | undefined {
  const input = value.trim().toLowerCase();
  if (!input) return undefined;
  try {
    const hostname = new URL(input.includes("://") ? input : `https://${input}`).hostname.replace(/^\.+|\.+$/g, "");
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function redactSearchError(error: unknown, secret: string): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split(secret).join("[REDACTED]").slice(0, 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
