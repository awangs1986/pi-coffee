import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createJiti } from "jiti/static";

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

type OfficialSerperSearch = (query: string, options: {
  numResults?: number;
  recencyFilter?: SearchRecency;
  domainFilter?: string[];
  signal?: AbortSignal;
}) => Promise<{ answer: string; results: WebSearchResult[] }>;

let officialSearch: Promise<OfficialSerperSearch> | undefined;

async function loadOfficialSerper(): Promise<OfficialSerperSearch> {
  officialSearch ??= (async () => {
    const entry = createRequire(import.meta.url).resolve("pi-web-access/serper.ts");
    const loaded = await createJiti(import.meta.url, { moduleCache: false }).import(entry);
    const search = (loaded as { searchWithSerper?: unknown }).searchWithSerper;
    if (typeof search !== "function") throw new Error("pi-web-access Serper provider is unavailable");
    return search as OfficialSerperSearch;
  })();
  return officialSearch;
}

/** Use the pinned upstream provider, keeping Coffee's bounded evidence contract. */
export class OfficialSerperSearchTransport implements SearchTransport {
  constructor(private readonly provider: OfficialSerperSearch = async (query, options) => (await loadOfficialSerper())(query, options)) {}

  async search(input: NormalizedWebSearchQuery, signal?: AbortSignal): Promise<WebSearchBatch> {
    const results: WebSearchResult[] = [];
    for (const query of input.queries) {
      const reply = await this.provider(query, {
        numResults: input.numResults,
        ...(input.recencyFilter === undefined ? {} : { recencyFilter: input.recencyFilter }),
        domainFilter: input.domainFilter,
        ...(signal === undefined ? {} : { signal }),
      });
      if (!Array.isArray(reply.results)) throw new Error("Official Serper returned invalid results");
      results.push(...reply.results.map(parseResult).filter((result): result is WebSearchResult => result !== undefined));
    }
    if (results.length === 0) throw new Error("Official Serper returned no valid sources");
    return { responseId: randomUUID(), provider: "serper", queries: [...input.queries], results: results.slice(0, 80) };
  }
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

function parseResult(value: unknown): WebSearchResult | undefined {
  if (!isRecord(value) || typeof value.url !== "string" || !/^https?:\/\//i.test(value.url)) return undefined;
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 512) : "Untitled source",
    url: value.url.slice(0, 2048),
    snippet: typeof value.snippet === "string" ? value.snippet.slice(0, 1_000) : "",
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
