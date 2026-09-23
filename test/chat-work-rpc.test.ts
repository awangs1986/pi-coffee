import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { resolvePiExtensions } from "../src/pi-extensions.js";
import { chatPayload } from "../src/harness/chat-payload.js";
import { CHAT_TOOLS, WORK_TOOLS } from "../src/harness/mode.js";

it("removes system instructions across provider payload formats while preserving user content and schemas", () => {
  const user = { role: "user", content: "literal system instructions are user data" };
  for (const key of ["messages", "input", "contents"]) {
    const payload = { [key]: [{ role: "system", content: "BASE" }, { role: "developer", content: "PROJECT" }, user], instructions: "WORK", system: [{ text: "SKILL" }], systemInstruction: { parts: [{ text: "BASE" }] }, config: { systemInstruction: "WORK", temperature: 0.2 }, tools: [{ name: "read" }] };
    expect(chatPayload(payload)).toEqual({ [key]: [user], config: { temperature: 0.2 }, tools: [{ name: "read" }] });
    expect(payload.instructions).toBe("WORK");
  }
});

describe.skipIf(process.platform !== "linux")("Chat provider format integration", () => {
  it.each(["openai-responses", "anthropic-messages", "google-generative-ai"])("sends no system instructions through real Pi %s serialization", async api => {
    const root = await mkdtemp(join(tmpdir(), "coffee-provider-format-"));
    const agentDir = join(root, "agent"); await mkdir(agentDir);
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      // This fixture inspects serialization only, then rejects once without retry.
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "serialization fixture complete", code: 400 } }));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${port}/v1`, api, apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 2048 }] } } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    await writeFile(join(root, "AGENTS.md"), "PROJECT_SENTINEL");
    const extensions = resolvePiExtensions({ PI_COFFEE_AGENT_DIR: agentDir }).map(p => {
      const path = relative(resolve("src"), p); return path.startsWith("..") ? p : resolve("dist/src", path);
    });
    const client = new RpcClient({ cliPath: resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), cwd: root, provider: "fixture", model: "fixture",
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_COFFEE_SCHEDULER_DIR: join(root, "admission"), PI_SUBAGENTS_TEMP_ROOT: join(root, "children") },
      args: ["--offline", "--no-session", ...extensions.flatMap(p => ["--extension", p]), "--skill", resolve("dist/skills/lsp")] });
    try {
      await client.start(); await client.prompt("/chat");
      await client.promptAndWait("Hello", undefined, 15000);
      expect(requests).toHaveLength(1);
      const payload = requests[0];
      expect(payload.system).toBeUndefined(); expect(payload.instructions).toBeUndefined(); expect(payload.systemInstruction).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("PROJECT_SENTINEL");
      expect(JSON.stringify(payload)).not.toContain("Software development");
      expect(JSON.stringify(payload)).not.toContain("coffee-lsp");
      const tools = api === "google-generative-ai" ? payload.tools.flatMap((t: any) => t.functionDeclarations ?? t.function_declarations ?? []) : payload.tools;
      expect(tools.map((t: any) => t.name).sort()).toEqual([...CHAT_TOOLS].sort());
    } finally {
      await client.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});

describe.skipIf(process.platform !== "linux")("Chat/Work real Pi provider seam", () => {
  it("enforces the wire contract through switching, model change, and process restart with all default plugins and LSP Skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-modes-rpc-"));
    const agentDir = join(root, "agent"); await mkdir(agentDir);
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); requests.push(input);
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const choice of [{ index: 0, delta: { role: "assistant", content: "MODE_OK" }, finish_reason: null }, { index: 0, delta: {}, finish_reason: "stop" }]) {
        res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: input.model, choices: [choice] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "fixture", models: ["one", "two"].map(id => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 2048 })) } } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    await writeFile(join(root, "AGENTS.md"), "PROJECT_SENTINEL: project guidance for this fixture.");
    const built = (p: string) => { const path = relative(resolve("src"), p); return path.startsWith("..") ? p : resolve("dist/src", path); };
    const extensions = resolvePiExtensions({ PI_COFFEE_AGENT_DIR: agentDir }).map(built);
    const skills = [resolve("dist/skills/lsp")];
    const session = join(root, "session.jsonl");
    const makeClient = () => new RpcClient({ cliPath: resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), cwd: root, provider: "fixture", model: "one",
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_COFFEE_SCHEDULER_DIR: join(root, "admission"), PI_SUBAGENTS_TEMP_ROOT: join(root, "children") },
      args: ["--offline", "--session", session, ...extensions.flatMap(p => ["--extension", p]), ...skills.flatMap(p => ["--skill", p])] });
    let client = makeClient();
    const names = (request: any) => request.tools.map((t: any) => t.function.name).sort();
    const assertChat = () => {
      const payload = requests.at(-1);
      expect(names(payload)).toEqual([...CHAT_TOOLS].sort());
      expect(payload.messages.some((m: any) => ["system", "developer"].includes(m.role))).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("PROJECT_SENTINEL");
      expect(JSON.stringify(payload)).not.toContain("coffee-lsp");
      expect(JSON.stringify(payload)).not.toContain("Software development");
    };
    try {
      await client.start();
      expect((await client.getCommands()).map(c => c.name)).toEqual(expect.arrayContaining(["chat", "work", "harness"]));
      await client.promptAndWait("Hello", undefined, 20000);
      expect(names(requests.at(-1))).toEqual([...WORK_TOOLS, "recall_folded"].sort());
      expect(JSON.stringify(requests.at(-1))).toContain("PROJECT_SENTINEL");
      expect(JSON.stringify(requests.at(-1))).toContain("Software development");
      expect(JSON.stringify(requests.at(-1))).toContain("lsp");
      const usageNonce="00000000-0000-4000-8000-000000000000";
      const contextCounts=async()=>{
        await client.prompt(`/coffee-context-usage ${usageNonce}`);
        const entries=(await client.getEntries()).entries;
        return (entries.filter(e=>e.type==='custom' && e.customType==='coffee-context-usage').at(-1) as any).data.breakdown;
      };
      const workCounts=await contextCounts();
      expect(workCounts.basis).toBe('last_request');
      for(const id of ['system','tools','rules','skills','conversation'])expect(workCounts.categories.find((c:any)=>c.id===id).tokens).toBeGreaterThan(0);
      expect(JSON.stringify(workCounts)).not.toContain('PROJECT_SENTINEL');
      await client.prompt("/chat");
      await client.promptAndWait("Hello again", undefined, 20000); assertChat();
      const chatCounts=await contextCounts();
      for(const id of ['system','rules','skills','subagents'])expect(chatCounts.categories.find((c:any)=>c.id===id).tokens).toBe(0);
      expect(chatCounts.categories.find((c:any)=>c.id==='tools').tokens).toBeGreaterThan(0);
      await client.setModel("fixture", "two");
      await client.promptAndWait("Model switched", undefined, 20000); assertChat();
      await client.stop(); client = makeClient(); await client.start();
      await client.promptAndWait("Resumed", undefined, 20000); assertChat();
      await client.prompt("/work");
      await client.promptAndWait("Work again", undefined, 20000);
      expect(names(requests.at(-1))).toEqual([...WORK_TOOLS, "recall_folded"].sort());
      const system = requests.at(-1).messages.filter((m: any) => ["system", "developer"].includes(m.role));
      expect(JSON.stringify(system).match(/# Software development/g)).toHaveLength(1);
      expect(JSON.stringify(system)).toContain("PROJECT_SENTINEL");
    } finally {
      await client.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true });
    }
  }, 60000);
});
