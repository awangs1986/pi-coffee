import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("installs a standalone tarball through Pi and restores modes with native optional-tool discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-native-consumer-"));
  const agent = join(root, "agent"); await mkdir(agent);
  const cli = resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const errors: unknown[] = [], requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const last = body.messages.at(-1);
    const task = last?.role === "user" ? (typeof last.content === "string" ? last.content : (last.content ?? []).map((part: any) => part.text ?? "").join("")) : "";
    const call = task === "fixture git" ? { name: "git", arguments: '{"action":"status"}' }
      : task === "fixture discover" ? { name: "search_tools", arguments: '{"action":"search","query":"lsp"}' }
      : task === "fixture activate" ? { name: "search_tools", arguments: '{"action":"activate","capability_id":"lsp"}' } : undefined;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `fixture-${requests.length}`, type: "function", function: call }] }
      : { role: "assistant", content: "HARNESS_OK" };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }]) {
      res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [choice] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_COFFEE_INITIAL_MODE: "work", PI_COFFEE_CAPABILITY_SETTINGS: "off" };
  let client: RpcClient | undefined;
  const names = () => requests.at(-1).tools.map((t: any) => t.function.name).sort();
  const chat = ["bash", "edit", "read", "write"];
  const work = [...chat, "git", "search_tools"].sort();
  const results: any[] = [];
  const start = async () => {
    client = new RpcClient({ cliPath: cli, cwd: root, provider: "fixture", model: "fixture", env,
      args: ["--offline", "--session", join(root, "session.jsonl")] });
    client.onEvent(event => {
      if (event.type === "extension_error") errors.push(event);
      if (event.type === "tool_execution_end") results.push(event);
    });
    await client.start(); return client;
  };
  try {
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: resolve("."), encoding: "utf8" }));
    const consumer = join(root, "consumer"); await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "pi-coffee-harness": `file:${join(root, pack.filename)}` } }));
    execFileSync("npm", ["install", "--omit=peer", "--no-audit", "--no-fund"], { cwd: consumer, stdio: "pipe" });
    const pkg = join(consumer, "node_modules/pi-coffee-harness");
    const exports = execFileSync(process.execPath, ["--input-type=module", "-e", 'import {currentHarnessMode,registerCapabilityManifest} from "pi-coffee-harness"; console.log(typeof currentHarnessMode,typeof registerCapabilityManifest)'], { cwd: pkg, encoding: "utf8" });
    expect(exports.trim()).toBe("function function");
    await writeFile(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    execFileSync(process.execPath, [cli, "install", pkg], { cwd: root, env, stdio: "pipe" });
    const settings = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
    expect(settings.packages.map((path: string) => resolve(agent, path))).toContain(pkg);
    await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 2048 }] } } }));
    execFileSync("git", ["init", "-q", root]);
    await writeFile(join(root, "marker.txt"), "synthetic fixture");
    let c = await start();
    const commands = (await c.getCommands()).map(c => c.name);
    expect(commands.filter(c => c === "harness")).toHaveLength(1);
    expect(commands).not.toContain("websearch");
    await c.promptAndWait("fixture git", undefined, 15000);
    expect(names()).toEqual(work);
    expect(JSON.stringify(requests.at(-1))).toContain("Software development");
    expect(results.find(e => e.toolName === "git")?.isError).toBe(false);
    expect(JSON.stringify(results)).toContain("marker.txt");
    await c.prompt("/chat"); await c.promptAndWait("chat one", undefined, 15000);
    expect(names()).toEqual(chat);
    expect(requests.at(-1).messages.some((m: any) => ["system", "developer"].includes(m.role))).toBe(false);
    await c.stop(); c = await start();
    await c.promptAndWait("restored chat", undefined, 15000); expect(names()).toEqual(chat);
    await c.stop();
    // A separate native package registers tools later than Harness, with no private imports.
    const optional = join(root, "optional"); await mkdir(optional);
    await writeFile(join(optional, "package.json"), JSON.stringify({ name: "fixture-optional", version: "1.0.0", type: "module", pi: { extensions: ["./index.js"] } }));
    await writeFile(join(optional, "index.js"), `export default function(pi){for(const name of ['lsp','web_search'])pi.registerTool({name,label:name,description:name,parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'fixture'}],details:{}}}});pi.on('before_agent_start',()=>{const q={};pi.events.emit('pi-coffee:harness-mode:query:v1',q);if(q.mode==='chat')pi.setActiveTools([...new Set([...pi.getActiveTools(),'lsp'])])})}`);
    execFileSync(process.execPath, [cli, "install", optional], { cwd: root, env, stdio: "pipe" });
    c = await start(); await c.promptAndWait("chat optional", undefined, 15000);
    expect(names()).toEqual([...chat, "web_search"].sort());
    expect(requests.at(-1).messages.some((m: any) => ["system", "developer"].includes(m.role))).toBe(false);
    await c.prompt("/work");
    await c.promptAndWait("fixture discover", undefined, 15000);
    expect(results.find(e => e.toolName === "search_tools")?.result.details.hits.map((h: any) => h.id)).toContain("lsp");
    await c.promptAndWait("fixture activate", undefined, 15000);
    expect(results.filter(e => e.toolName === "search_tools").at(-1)?.result.details.ok).toBe(true);
    await c.promptAndWait("work with lsp", undefined, 15000);
    expect(JSON.stringify(requests.at(-1))).toContain("active lsp tool");
    await c.stop(); c = await start(); await c.promptAndWait("restored work", undefined, 15000);
    expect(names()).toContain("lsp");
    expect(JSON.stringify(requests.at(-1))).toContain("Software development");
    expect(JSON.stringify(requests.at(-1))).toContain("active lsp tool");
    expect(errors).toEqual([]);
  } finally {
    await client?.stop(); server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
