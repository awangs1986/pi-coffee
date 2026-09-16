import { describe, expect, it } from "vitest";
import { MemorySearchTransport, RelaySearchTransport, normalizeWebSearchQuery, parseSearchBatch } from "../src/web/search.js";

describe("PI Coffee web search adapter", () => {
  it("normalizes bounded multi-query input", () => {
    const normalized = normalizeWebSearchQuery({
      query: "  pi coffee  ",
      queries: ["pi coffee", "second", "third", "fourth", "ignored"],
      numResults: 20,
      domainFilter: [" example.com ", "example.com"],
      recencyFilter: "week",
    });
    expect(normalized).toEqual({
      queries: ["pi coffee", "second", "third", "fourth"],
      numResults: 20,
      recencyFilter: "week",
      domainFilter: ["example.com"],
    });
  });

  it("rejects empty and out-of-range requests", () => {
    expect(() => normalizeWebSearchQuery({})).toThrow(/needs query/);
    expect(() => normalizeWebSearchQuery({ query: "x", numResults: 0 })).toThrow(/numResults/);
    expect(() => normalizeWebSearchQuery({ query: "x", recencyFilter: "hour" as never })).toThrow(/recency/);
  });

  it("keeps the Relay token on the User VM side and parses bounded results", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const transport = new RelaySearchTransport(
      "http://relay.test/v1/search/serper",
      "relay-token",
      async (url, init) => {
        seen = { url: String(url), init };
        return new Response(JSON.stringify({
          responseId: "r-1",
          queries: ["pi"],
          results: [{ title: "Pi", url: "https://example.com/pi", snippet: "bounded" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    );
    const result = await transport.search({ queries: ["pi"], numResults: 5, domainFilter: [] });
    expect(result.results[0]?.url).toBe("https://example.com/pi");
    expect(seen?.url).toBe("http://relay.test/v1/search/serper");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer relay-token");
    expect(JSON.stringify(seen?.init)).not.toContain("SERPER");
  });

  it("bounds the raw Relay body before parsing and always sets a cancellation deadline", async () => {
    let seenSignal: AbortSignal | null | undefined;
    const transport = new RelaySearchTransport("http://relay.test", undefined, async (_url, init) => {
      seenSignal = init?.signal;
      return new Response("x".repeat(600_000));
    });
    await expect(transport.search({ queries: ["q"], numResults: 1, domainFilter: [] })).rejects.toThrow("512 KiB");
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("filters malformed result entries and bounds the in-memory transport", async () => {
    expect(parseSearchBatch({ responseId: "r", queries: ["q"], results: [
      { title: "ok", url: "https://example.com", snippet: "s" },
      { title: "bad", url: "file:///tmp/x", snippet: "drop" },
    ] }).results).toHaveLength(1);
    const memory = new MemorySearchTransport([{ title: "one", url: "https://one.test", snippet: "" }]);
    await memory.search({ queries: ["a"], numResults: 1, domainFilter: [] });
    expect(memory.calls).toHaveLength(1);
  });
});
