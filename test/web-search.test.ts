import { describe, expect, it } from "vitest";
import { MemorySearchTransport, OfficialSerperSearchTransport, normalizeWebSearchQuery } from "../src/extensions/web-access/search.js";

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

  it("passes bounded options to the official provider and retains only usable sources", async () => {
    const calls: unknown[] = [];
    const transport = new OfficialSerperSearchTransport(async (query, options) => {
      calls.push({ query, options });
      return { answer: "", results: [
        { title: "Valid", url: "https://example.com", snippet: "source" },
        { title: "Invalid", url: "file:///tmp/x", snippet: "drop" },
      ] };
    });
    const input = normalizeWebSearchQuery({ query: "official", numResults: 2, recencyFilter: "week", domainFilter: ["example.com"] });
    const batch = await transport.search(input);
    expect(calls).toEqual([{ query: "official", options: { numResults: 2, recencyFilter: "week", domainFilter: ["example.com"] } }]);
    expect(batch.results).toEqual([{ title: "Valid", url: "https://example.com", snippet: "source" }]);
    expect(batch.provider).toBe("serper");
  });

  it("does not publish an invalid or empty official search as evidence", async () => {
    const input = normalizeWebSearchQuery({ query: "no valid source" });
    const transport = new OfficialSerperSearchTransport(async () => ({ answer: "", results: [
      { title: "Invalid", url: "file:///tmp/x", snippet: "" },
    ] }));
    await expect(transport.search(input)).rejects.toThrow("no valid sources");
    const memory = new MemorySearchTransport([{ title: "one", url: "https://one.test", snippet: "" }]);
    await memory.search({ queries: ["a"], numResults: 1, domainFilter: [] });
    expect(memory.calls).toHaveLength(1);
  });
});
