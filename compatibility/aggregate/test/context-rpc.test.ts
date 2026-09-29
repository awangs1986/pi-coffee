import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("real Pi RPC local context recovery (no model service)", () => {
  it("compacts offline and aborts an oversized final payload before the provider receives it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-local-recovery-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    let requests = 0;
    const server = createServer((_req, res) => { requests++; res.writeHead(500); res.end("Model requests are forbidden in this test"); });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { localtest: {
      baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "test-placeholder-not-a-secret",
      models: [{ id: "tiny", name: "tiny", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 1024 }],
    } } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1024, reserveTokens: 2048 } }));
    const file = join(root, "session.jsonl");
    const entries: any[] = [{ type: "session", version: 3, id: "22222222-2222-4222-8222-222222222222", timestamp: new Date().toISOString(), cwd: root }];
    let parentId: string | null = null;
    for (let i = 0; i < 24; i++) {
      const id = `m${i}`;
      const role = i % 2 ? "assistant" : "user";
      entries.push({ type: "message", id, parentId, timestamp: new Date().toISOString(), message: {
        role, content: [{ type: "text", text: role === "user" ? `Task ${i}: verify file src/main.ts` : `Evidence ${i} ` + "old evidence ".repeat(700) }],
        timestamp: Date.now(), ...(role === "assistant" ? { api: "openai-completions", provider: "localtest", model: "tiny", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}),
      } });
      parentId = id;
    }
    await writeFile(file, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    const client = new RpcClient({
      cliPath: resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), cwd: root,
      provider: "localtest", model: "tiny",
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", CONTEXTFOLD_COMPACT: "det", CONTEXTFOLD: "1" },
      args: ["--offline", "--session", file, "--extension", resolve("dist/src/harness/extension.js"), "--extension", resolve("dist/src/context/extension.js")],
    });
    try {
      await client.start();
      expect((await client.getCommands()).some(command => command.name === "context-recovery")).toBe(true);
      const compacted = await client.compact();
      expect(compacted.summary).toContain("deterministic seed index");
      expect(requests).toBe(0);
      expect(await readFile(file, "utf8")).toContain("old evidence");
      const events = await client.promptAndWait("new uncompressible input ".repeat(1800), undefined, 15000);
      expect(JSON.stringify(events)).toContain("context_budget_exceeded");
      expect(requests).toBe(0);
    } finally {
      await client.stop();
      await new Promise<void>(r => server.close(() => r()));
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
