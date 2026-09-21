export type SearchRecency = "day" | "week" | "month" | "year";

export interface WebSearchQuery {
  query?: string;
  queries?: string[];
  numResults?: number;
  recencyFilter?: SearchRecency;
  domainFilter?: string[];
  /** Explicitly request the native pi-subagents researcher path. */
  delegate?: boolean;
}
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchBatch {
  responseId: string;
  provider: "serper";
  queries: string[];
  results: WebSearchResult[];
}

export interface SearchTransport {
  search(input: NormalizedWebSearchQuery, signal?: AbortSignal): Promise<WebSearchBatch>;
}

export interface NormalizedWebSearchQuery {
  queries: string[];
  numResults: number;
  recencyFilter?: SearchRecency;
  domainFilter: string[];
}

export function normalizeWebSearchQuery(input: WebSearchQuery): NormalizedWebSearchQuery {
  const raw = [
    ...(typeof input.query === "string" ? [input.query] : []),
    ...(Array.isArray(input.queries) ? input.queries : []),
  ];
  if (raw.some((query) => typeof query !== "string")) throw new Error("web_search queries must be strings");
  const queries = [...new Set(raw.map((query) => query.trim()).filter(Boolean))].slice(0, 4);
  if (queries.length === 0) throw new Error("web_search needs query or queries");
  const numResults = input.numResults === undefined ? 5 : input.numResults;
  if (!Number.isSafeInteger(numResults) || numResults < 1 || numResults > 20) throw new Error("numResults must be an integer from 1 to 20");
  const domainFilter = [...new Set((input.domainFilter ?? []).map((domain) => String(domain).trim()).filter(Boolean))].slice(0, 20);
  if (input.recencyFilter !== undefined && !["day", "week", "month", "year"].includes(input.recencyFilter)) throw new Error("invalid recencyFilter");
  return {
    queries: queries.map((query) => query.slice(0, 512)),
    numResults,
    ...(input.recencyFilter === undefined ? {} : { recencyFilter: input.recencyFilter }),
    domainFilter,
  };
}

/**
 * Host-side Adapter for the Control Plane search route. The request contains
 * only a transport token; the Serper credential never crosses this seam.
 */
export class RelaySearchTransport implements SearchTransport {
  constructor(
    private readonly endpoint: string = resolveSearchEndpoint(),
    private readonly token: string | undefined = process.env.PI_COFFEE_RELAY_TOKEN,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(input: NormalizedWebSearchQuery, signal?: AbortSignal): Promise<WebSearchBatch> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.token !== undefined && this.token.trim() !== "") headers.authorization = `Bearer ${this.token.trim()}`;
    const timeout = AbortSignal.timeout(30_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: requestSignal,
    });
    const body = await boundedResponseText(response);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new Error(`search relay returned invalid JSON (${response.status})`); }
    if (!response.ok) throw new Error(`search relay failed (${response.status}): ${boundedError(parsed)}`);
    return parseSearchBatch(parsed);
  }
}

export class MemorySearchTransport implements SearchTransport {
  calls: NormalizedWebSearchQuery[] = [];

  constructor(private readonly results: WebSearchResult[] = []) {}

  async search(input: NormalizedWebSearchQuery): Promise<WebSearchBatch> {
    this.calls.push(input);
    return {
      responseId: `memory-${this.calls.length}`,
      provider: "serper",
      queries: [...input.queries],
      results: this.results.slice(0, input.numResults),
    };
  }
}

export function resolveSearchEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PI_COFFEE_SEARCH_URL?.trim() || env.PI_COFFEE_RELAY_URL?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/$/, "") + "/v1/search/serper";
  const port = Number.parseInt(env.PI_COFFEE_RELAY_PORT ?? "8789", 10);
  return `http://127.0.0.1:${Number.isSafeInteger(port) && port > 0 ? port : 8789}/v1/search/serper`;
}

export function parseSearchBatch(value: unknown): WebSearchBatch {
  if (!isRecord(value)) throw new Error("search relay envelope must be an object");
  const payload = isRecord(value.search) ? value.search : value;
  if (typeof payload.responseId !== "string" || !Array.isArray(payload.queries) || !Array.isArray(payload.results)) throw new Error("search relay envelope is missing responseId/queries/results");
  const results = payload.results.slice(0, 80).map(parseResult).filter((result): result is WebSearchResult => result !== undefined).slice(0, 80);
  return {
    responseId: payload.responseId.slice(0, 256),
    provider: "serper",
    queries: payload.queries.slice(0, 4).filter((query): query is string => typeof query === "string").map(query => query.slice(0, 512)),
    results,
  };
}

function parseResult(value: unknown): WebSearchResult | undefined {
  if (!isRecord(value) || typeof value.url !== "string" || !/^https?:\/\//i.test(value.url)) return undefined;
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 512) : "Untitled source",
    url: value.url.slice(0, 2048),
    snippet: typeof value.snippet === "string" ? value.snippet.slice(0, 1_000) : "",
  };
}

function boundedError(value: unknown): string {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") return value.error.message.slice(0, 500);
  return "upstream search error";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bound the incoming envelope before JSON parsing, not just the resulting fields. */
async function boundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) {
        await reader.cancel();
        throw new Error("search relay response exceeds 512 KiB");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
