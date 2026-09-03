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
  readonly entries: any[] = [];
  readonly messages: any[] = [];

  asExtensionApi(): ExtensionAPI { return this as unknown as ExtensionAPI; }

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  registerTool(tool: ToolDefinition): void { this.tools.set(tool.name, tool); }

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
  it("delegates, seals after agent_end, and projects only a pointer into the next context", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coffee-web-extension-"));
    try {
      const pi = new FakePi();
      const transport = new MemorySearchTransport([
        { title: "Pi docs", url: "https://example.com/pi", snippet: "Pi is an agent." },
      ]);
      createWebExtension({
        transport,
        artifactStore: new ResearchArtifactStore(root),
        subagentInvoker: async () => "child evidence brief",
      })(pi.asExtensionApi());

      const result = await pi.runTool("web_search", { query: "pi", delegate: true });
      expect(result.content[0].text).toContain("child evidence brief");
      expect(result.details.responseId).toBe("memory-1");

      await pi.emit("agent_end", {
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "Pi is an agent according to the source." }] }],
      });
      const sealed = pi.entries.find((entry) => entry.customType === "pi-coffee-research-sealed");
      expect(sealed).toBeDefined();
      const markdown = await readFile(sealed.data.ref.path, "utf8");
      expect(markdown).toContain("Pi is an agent according to the source.");
      expect(markdown).toContain("https://example.com/pi");

      const projected = await pi.emit("context", {
        type: "context",
        messages: [{ role: "toolResult", toolCallId: "call-1", content: result.content, details: result.details }],
      });
      expect(projected.messages[0].content[0].text).toContain("[Research sealed]");
      expect(projected.messages[0].content[0].text).toContain("Pi is an agent according to the source.");
      expect(projected.messages[0].content[0].text).not.toContain("Pi docs");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
      expect(pi.entries.filter((entry) => entry.customType === "pi-coffee-research-sealed")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
