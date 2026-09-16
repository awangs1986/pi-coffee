import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWebExtension } from "../src/web/extension.js";
import { MemorySearchTransport } from "../src/web/search.js";
import { ResearchArtifactStore } from "../src/web/research-artifact.js";

type Handler = (event: any, context: any) => unknown;

class FakePi {
  readonly handlers = new Map<string, Handler[]>();
  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, { description: string; handler: (args: string, context: unknown) => unknown }>();
  readonly entries: any[] = [];
  readonly messages: any[] = [];

  asExtensionApi(): ExtensionAPI { return this as unknown as ExtensionAPI; }

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  registerTool(tool: ToolDefinition): void { this.tools.set(tool.name, tool); }

  registerCommand(name: string, command: { description: string; handler: (args: string, context: unknown) => unknown }): void {
    this.commands.set(name, command);
  }

  appendEntry(customType: string, data: unknown): void {
    this.entries.push({ type: "custom", customType, data });
  }

  sendMessage(message: unknown): void { this.messages.push(message); }

  context(): any {
    return {
      cwd: "/workspace",
      mode: "rpc",
      hasUI: true,
      ui: { notify: () => undefined },
      sessionManager: { getEntries: () => [...this.entries] },
    };
  }

  async emit(event: string, payload: unknown): Promise<unknown> {
    let result: unknown;
    for (const handler of this.handlers.get(event) ?? []) result = await handler(payload, this.context());
    return result;
  }

  async runTool(name: string, params: Record<string, unknown>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute("call-1", params as never, undefined, undefined, this.context() as never);
  }
}

describe("PI Coffee web extension", () => {
  it("does not search in the parent when default delegation fails", async () => {
    const pi = new FakePi();
    const transport = new MemorySearchTransport([]);
    createWebExtension({ transport, subagentInvoker: async () => undefined })(pi.asExtensionApi());
    await expect(pi.runTool("web_search", { query: "q" })).rejects.toThrow("Research child failed");
    expect(transport.calls).toHaveLength(0);
    expect(pi.entries).toHaveLength(0);
  });
  it("persists only a bounded best-result brief and index before the next model request", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-web-extension-"));
    try {
      const pi = new FakePi();
      let delegated = 0;
      const results = Array.from({ length: 20 }, (_, i) => ({
        title: `Source ${i}`, url: `https://example.com/${i}`, snippet: `UNIQUE_${i} ` + "evidence ".repeat(120),
      }));
      createWebExtension({ transport: new MemorySearchTransport(results), artifactStore: new ResearchArtifactStore(root),
        subagentInvoker: async () => { delegated++; return "brief"; },
      })(pi.asExtensionApi());
      await pi.emit("turn_start", { turnIndex: 1 });
      const result = await pi.runTool("web_search", { query: "pi", numResults: 20, delegate: false });
      expect(delegated).toBe(0);
      expect(result.content[0].text).toContain("[Research sealed]");
      expect(result.content[0].text.length).toBeLessThanOrEqual(4096);
      expect(JSON.stringify(result)).not.toContain("UNIQUE_19");
      expect(JSON.stringify(pi.entries)).not.toContain("UNIQUE_19");
      const entry = pi.entries.find(e => e.customType === "pi-coffee-research-sealed");
      expect(await readFile(entry.data.ref.path, "utf8")).toContain("UNIQUE_19");
      // No final answer and no agent_end are required; multi-turn progression cannot leak raw results.
      await pi.emit("turn_start", { turnIndex: 2 });
      const next = await pi.emit("context", { messages: [{ role: "toolResult", toolCallId: "call-1", content: result.content }] }) as any;
      expect(JSON.stringify(next ?? result)).not.toContain("UNIQUE_19");
      const resumed = new FakePi(); resumed.entries.push(...pi.entries);
      createWebExtension({ artifactStore: new ResearchArtifactStore(root) })(resumed.asExtensionApi());
      await resumed.emit("session_start", {});
      const projected = await resumed.emit("context", { messages: [{ role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "old raw payload" }] }] }) as any;
      expect(projected.messages[0].content[0].text).toContain("[Research sealed]");
      expect(JSON.stringify(projected)).not.toContain("old raw payload");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("delegates by default without searching in the parent and bounds the returned brief", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-web-extension-"));
    try {
      const pi = new FakePi(); let delegated = 0;
      const transport = new MemorySearchTransport([]);
      createWebExtension({ transport, artifactStore: new ResearchArtifactStore(root),
        subagentInvoker: async (input) => { expect(input.task).toContain('"queries":["q"]'); delegated++; return "child brief ".repeat(2000); },
      })(pi.asExtensionApi());
      const result = await pi.runTool("web_search", { query: "q" });
      expect(transport.calls).toHaveLength(0);
      expect(delegated).toBe(1);
      expect(result.content[0].text).toContain("child brief");
      expect(result.content[0].text.length).toBeLessThanOrEqual(4096);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("never falls back to putting raw results in history when artifact persistence fails", async () => {
    const pi = new FakePi();
    createWebExtension({ transport: new MemorySearchTransport([{ title: "raw", url: "https://example.com", snippet: "DO_NOT_PERSIST" }]),
      artifactStore: { seal() { throw new Error("disk full"); } } as unknown as ResearchArtifactStore,
    })(pi.asExtensionApi());
    await expect(pi.runTool("web_search", { query: "q", delegate: false })).rejects.toThrow("disk full");
    expect(JSON.stringify(pi.entries)).not.toContain("DO_NOT_PERSIST");
  });

  it("supports explicit sealing and keeps unknown response IDs bounded", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-web-extension-"));
    try {
      const pi = new FakePi();
      createWebExtension({
        transport: new MemorySearchTransport([{ title: "Source", url: "https://example.com", snippet: "fact" }]),
        artifactStore: new ResearchArtifactStore(root),
        delegateByDefault: false,
      })(pi.asExtensionApi());
      const unknown = await pi.runTool("research_seal", { responseId: "missing", conclusion: "x" });
      expect(unknown.details).toMatchObject({ ok: false, code: "unknown" });
      await pi.runTool("web_search", { query: "fact" });
      const sealed = await pi.runTool("research_seal", { responseId: "memory-1", conclusion: "fact confirmed" });
      expect(sealed.details.ok).toBe(true);
      expect(pi.entries.filter((entry) => entry.customType === "pi-coffee-research-sealed")).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scrubs credentials from the session entry and browser message as well as the artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-web-extension-"));
    const previous = process.env.PI_COFFEE_SERPER_KEY;
    process.env.PI_COFFEE_SERPER_KEY = "serper-conclusion-secret";
    try {
      const pi = new FakePi();
      createWebExtension({
        transport: new MemorySearchTransport([{ title: "Source", url: "https://example.com", snippet: "fact" }]),
        artifactStore: new ResearchArtifactStore(root),
        delegateByDefault: false,
      })(pi.asExtensionApi());
      await pi.runTool("web_search", { query: "fact" });
      await pi.runTool("research_seal", { responseId: "memory-1", conclusion: "serper-conclusion-secret must be hidden" });
      const sealed = pi.entries.filter((entry) => entry.customType === "pi-coffee-research-sealed").at(-1);
      expect(sealed.data.conclusion).not.toContain("serper-conclusion-secret");
      expect(JSON.stringify(pi.messages)).not.toContain("serper-conclusion-secret");
      expect(await readFile(sealed.data.ref.path, "utf8")).not.toContain("serper-conclusion-secret");
    } finally {
      if (previous === undefined) delete process.env.PI_COFFEE_SERPER_KEY;
      else process.env.PI_COFFEE_SERPER_KEY = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});
