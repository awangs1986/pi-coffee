import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ResearchArtifactStore, pointerContext, renderResearchMarkdown } from "../src/web/research-artifact.js";

describe("research Markdown closure", () => {
  it("writes a User VM artifact atomically and returns a pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-research-"));
    const store = new ResearchArtifactStore(root);
    const ref = store.seal({
      responseId: "response-1",
      sessionId: "session-1",
      queries: ["pi coffee"],
      provider: "serper",
      results: [{ title: "Source", url: "https://example.com/source", snippet: "evidence" }],
      conclusion: "The answer is [safe].",
    });
    const markdown = await readFile(ref.path, "utf8");
    expect(markdown).toContain("# PI Coffee Research Closure");
    expect(markdown).toContain("The answer is [safe].");
    expect(store.read(ref)).toBe(markdown);
    expect((await stat(ref.path)).mode & 0o777).toBe(0o600);
    expect(pointerContext(ref, "answer")).toContain(ref.artifactId);
  });

  it("redacts configured secrets from Markdown and rejects path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-research-"));
    const previous = process.env.PI_COFFEE_RELAY_TOKEN;
    process.env.PI_COFFEE_RELAY_TOKEN = "relay-secret-value";
    try {
      const store = new ResearchArtifactStore(root);
      const ref = store.seal({
        responseId: "response-2",
        queries: ["q"],
        provider: "serper",
        results: [],
        conclusion: "relay-secret-value must not persist",
      });
      expect(await readFile(ref.path, "utf8")).not.toContain("relay-secret-value");
      expect(() => store.read({ ...ref, path: join(root, "..", "other.md") })).toThrow(/outside/);
    } finally {
      if (previous === undefined) delete process.env.PI_COFFEE_RELAY_TOKEN;
      else process.env.PI_COFFEE_RELAY_TOKEN = previous;
    }
  });

  it("keeps the renderer deterministic for bounded source text", () => {
    const markdown = renderResearchMarkdown({
      responseId: "r",
      queries: ["q"],
      provider: "serper",
      results: [],
      conclusion: "conclusion",
      sealedAt: "2026-09-03T00:00:00.000Z",
    });
    expect(markdown).toContain("Sealed at: 2026-09-03T00:00:00.000Z");
  });
});
