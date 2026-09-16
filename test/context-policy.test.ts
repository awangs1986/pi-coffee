import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installContextPolicy, protectLocalCompaction } from "../src/context/policy.js";

describe("bounded context and local recovery", () => {
  it("never falls back to model compaction if the local handler fails or declines", async () => {
    const notices: string[] = [];
    const ctx = { ui: { notify: (message: string) => notices.push(message) } };
    for (const handler of [() => undefined, () => { throw new Error("disk full"); }]) {
      expect(await protectLocalCompaction(handler)({}, ctx)).toEqual({ cancel: true });
    }
    const value = { compaction: { summary: "local index", firstKeptEntryId: "k", tokensBefore: 5000 } };
    expect(await protectLocalCompaction(() => value)({}, ctx)).toBe(value);
    expect(notices).toHaveLength(2);
  });

  it("archives a large built-in tool result before persistence and bounds the returned content/details", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-policy-"));
    const handlers = new Map<string, Function>();
    installContextPolicy({ on: (event: string, handler: Function) => handlers.set(event, handler) } as never);
    try {
      const result = await handlers.get("tool_result")!({ toolName: "bash", toolCallId: "t", content: [{ type: "text", text: "RAW-LOG\n".repeat(10000) }], details: { big: "d".repeat(40000) }, isError: true }, { sessionManager: { getSessionDir: () => root } });
      expect(result.content[0].text.length).toBeLessThan(7000);
      expect(result.isError).toBe(true);
      expect(result.details.big).toBeUndefined();
      expect(await readFile(result.details.artifactPath, "utf8")).toContain("RAW-LOG");
      const childResult = await handlers.get("tool_result")!({ toolName: "subagent", content: [{ type: "text", text: "brief" }] }, {});
      expect(childResult.content[0].text).toBe("brief");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("returns a bounded explicit error on disk failure instead of a raw log", async () => {
    const handlers = new Map<string, Function>();
    installContextPolicy({ on: (event: string, handler: Function) => handlers.set(event, handler) } as never);
    const result = await handlers.get("tool_result")!({ toolName: "read", content: [{ type: "text", text: "RAW".repeat(10000) }] }, { sessionManager: { getSessionDir: () => '/dev/null/no-dir' } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not saved");
    expect(result.content[0].text).not.toContain("RAW");
  });

  it("uses final request size even if reported usage is absent or zero, reserving output space", async () => {
    const handlers = new Map<string, Function>(); let aborted = 0; const notices: string[] = [];
    installContextPolicy({ on: (event: string, handler: Function) => handlers.set(event, handler) } as never);
    const ctx = { model: { contextWindow: 8000, maxTokens: 2000 }, abort: () => aborted++, ui: { notify: (text: string) => notices.push(text) } };
    const check = handlers.get("before_provider_request")!;
    await check({ payload: { messages: [{ content: "small" }] } }, ctx);
    expect(aborted).toBe(0);
    await check({ payload: { system: "s".repeat(15000), tools: [], messages: [] } }, ctx);
    expect(aborted).toBe(1);
    expect(notices[0]).toContain("context_budget_exceeded");
    // Switching to a larger model uses its current window, not the old model's usage.
    await check({ payload: { system: "s".repeat(15000) } }, { ...ctx, model: { contextWindow: 128000, maxTokens: 8192 } });
    expect(aborted).toBe(1);
  });
});
