import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import harnessExtension, { createHarnessExtension } from "../src/harness/extension.js";
import { MemoryCapabilitySettingsStore } from "../src/capabilities/settings.js";
import { WORK_TOOLS, CHAT_TOOLS } from "../src/harness/mode.js";
import { renderHarnessPrompt } from "../src/harness/prompt.js";
function createWebExtension(_options: unknown) {return (pi: ExtensionAPI)=>pi.registerTool({
 name:'web_search',label:'Official search fixture',description:'search',parameters:{} as never,
 execute:async()=>({content:[],details:{}}),
});}

type Handler = (event: unknown, context: unknown) => unknown;

class FakePi {
  readonly handlers = new Map<string, Handler[]>();
  readonly commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
  readonly tools = new Map<string, ToolDefinition>();
  readonly entries: unknown[] = [];
  readonly notifications: Array<{ message: string; level?: string }> = [];
  readonly cwd: string;
  private active: string[];

  constructor(cwd: string, entries: unknown[] = []) {
    this.cwd = cwd;
    this.entries.push(...entries);
    const builtins = ["read", "bash", "edit", "write", "grep", "find", "ls"];
    this.active = [...builtins];
    for (const name of builtins) {
      this.tools.set(name, {
        name,
        label: name,
        description: `${name} builtin`,
        parameters: {} as never,
        execute: async () => ({ content: [{ type: "text", text: "" }], details: {} }),
      });
    }
  }

  asExtensionApi(): ExtensionAPI {
    return this as unknown as ExtensionAPI;
  }

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerCommand(name: string, options: { handler: (args: string, context: unknown) => Promise<void> }): void {
    this.commands.set(name, options);
  }

  appendEntry(customType: string, data: unknown): void {
    this.entries.push({ type: "custom", customType, data });
  }

  getAllTools(): unknown[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptGuidelines: tool.promptGuidelines,
      sourceInfo: { source: tool.name === "read" ? "builtin" : "extension" },
    }));
  }

  getActiveTools(): string[] {
    return [...this.active];
  }

  setActiveTools(names: string[]): void {
    this.active = [...names];
  }

  exec(command: string, args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<any> {
    return new Promise((resolve) => {
      execFile(command, args, {
        cwd: options.cwd ?? this.cwd,
        signal: options.signal,
        timeout: options.timeout,
        maxBuffer: 2_000_000,
      }, (error, stdout, stderr) => {
        const code = error?.code;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: typeof code === "number" ? code : error ? 1 : 0,
          killed: Boolean(error && typeof error === "object" && "killed" in error && error.killed),
        });
      });
    });
  }

  context(): any {
    return {
      cwd: this.cwd,
      mode: "rpc",
      hasUI: true,
      ui: {
        notify: (message: string, level?: string) => this.notifications.push({ message, level }),
        confirm: async () => true,
      },
      sessionManager: { getEntries: () => [...this.entries] },
      isIdle: () => true,
      isProjectTrusted: () => true,
      signal: undefined,
    };
  }

  async emit(event: string, payload: unknown): Promise<unknown> {
    let result: unknown;
    for (const handler of this.handlers.get(event) ?? []) {
      result = await handler(payload, this.context());
    }
    return result;
  }

  async runCommand(name: string, args: string): Promise<void> {
    const command = this.commands.get(name);
    if (!command) throw new Error(`missing command ${name}`);
    await command.handler(args, this.context());
  }

  async runTool(name: string, params: Record<string, unknown>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute("test-call", params as never, undefined, undefined, this.context() as never);
  }
}

const sessions: string[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Chat/Work migration", () => {
  it('starts a new Chat workspace in Chat and retains an explicitly selected Work mode on resume',async()=>{
    const previous=process.env.PI_COFFEE_INITIAL_MODE;process.env.PI_COFFEE_INITIAL_MODE='chat';
    try{
      const make=(entries:unknown[]=[])=>{const pi=new FakePi('/workspace',entries);createWebExtension({delegateByDefault:false})(pi.asExtensionApi());createHarnessExtension({settings:new MemoryCapabilitySettingsStore()})(pi.asExtensionApi());return pi;};
      const pi=make();await pi.emit('session_start',{});expect(pi.getActiveTools()).toEqual([...CHAT_TOOLS]);
      await pi.runCommand('work','');const resumed=make(pi.entries);await resumed.emit('session_start',{});expect(resumed.getActiveTools()).toEqual([...WORK_TOOLS]);
    }finally{if(previous===undefined)delete process.env.PI_COFFEE_INITIAL_MODE;else process.env.PI_COFFEE_INITIAL_MODE=previous;}
  });

  it("defaults to Work and switches to zero-system Chat with exactly five tools", async () => {
    const pi = new FakePi("/workspace");
    createWebExtension({ delegateByDefault: false })(pi.asExtensionApi());
    createHarnessExtension({ settings: new MemoryCapabilitySettingsStore() })(pi.asExtensionApi());
    await pi.emit("session_start", {});
    expect(pi.getActiveTools()).toEqual(["read", "edit", "write", "bash", "git", "search_tools"]);
    await pi.runCommand("chat", "");
    expect(pi.getActiveTools()).toEqual(["read", "edit", "write", "bash", "web_search"]);
    expect(await pi.emit("before_agent_start", { systemPrompt: "BASE + PROJECT + SKILLS" })).toEqual({ systemPrompt: "" });
    await pi.runCommand("work", "");
    expect(pi.getActiveTools()).toEqual(["read", "edit", "write", "bash", "git", "search_tools"]);
  });
});

describe("Chat/Work session and capability boundaries", () => {
  function setup(entries: unknown[] = [], web = true) {
    const pi = new FakePi("/workspace", entries);
    if (web) createWebExtension({ delegateByDefault: false })(pi.asExtensionApi());
    for (const name of ["recall_folded", "unfold"]) pi.registerTool({
      name, label: name, description: name, parameters: {} as never,
      execute: async () => ({ content: [], details: {} }),
    });
    createHarnessExtension({ settings: new MemoryCapabilitySettingsStore(), conformedCapabilities: new Set(["subagent"]), ownerAuthority: true })(pi.asExtensionApi());
    return pi;
  }
  it("persists both modes, revokes capabilities and excludes recovery from Chat", async () => {
    const pi = setup(); await pi.emit("session_start", {});
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
    expect(pi.tools.has("verify")).toBe(false);
    await pi.runTool("search_tools", { action: "activate", capability_id: "web" });
    expect(pi.getActiveTools()).toContain("web_search");
    const restoredWork = setup(pi.entries); await restoredWork.emit("session_start", {});
    expect(restoredWork.getActiveTools()).toContain("web_search");
    await pi.runCommand("chat", "");
    expect(pi.getActiveTools()).toEqual([...CHAT_TOOLS]);
    await pi.emit("model_select", {});
    expect(pi.getActiveTools()).toEqual([...CHAT_TOOLS]);
    expect((await pi.runTool("search_tools", { action: "activate", capability_id: "web" })).details.code).toBe("mode-disabled");
    const restored = setup(pi.entries); await restored.emit("session_start", {});
    expect(restored.getActiveTools()).toEqual([...CHAT_TOOLS]);
    await restored.runCommand("work", "");
    expect(restored.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
  });
  it.each(["simple", "lean", "full", "standard", "tdd"])("migrates stored %s to Work without retaining a command alias", async oldMode => {
    const oldEntry = { type: "custom", customType: "pi-coffee-harness-state", data: { version: 1, mode: oldMode } };
    const pi = setup([oldEntry]); await pi.emit("session_start", {});
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
    expect(pi.entries).toContain(oldEntry);
    expect(pi.entries.at(-1)).toMatchObject({ data: { version: 2, mode: "work", source: "migration" } });
    expect(pi.notifications.some(n => n.message.includes("migrated to Work"))).toBe(true);
    await pi.runCommand("harness", oldMode);
    expect(pi.notifications.at(-1)?.message).toContain("Unknown mode");
    expect(pi.commands.has(oldMode)).toBe(false);
  });
  it("refuses unavailable modes without silently changing the current mode", async () => {
    const pi = setup([], false); await pi.emit("session_start", {});
    await pi.runCommand("chat", "");
    expect(pi.notifications.at(-1)?.message).toContain("missing tools [web_search]");
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
  });
  it("blocks switching during a turn and restores the selected session branch", async () => {
    const pi = setup(); await pi.emit("session_start", {});
    const context = pi.context();
    context.isIdle = () => false;
    await pi.commands.get("chat")!.handler("", context);
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
    context.sessionManager.getBranch = () => [{ type: "custom", customType: "pi-coffee-harness-state", data: { version: 2, mode: "chat" } }];
    for (const handler of pi.handlers.get("session_tree")!) await handler({}, context);
    expect(pi.getActiveTools()).toEqual([...CHAT_TOOLS]);
  });
  it("preserves unknown future state and aborts requests until a mode is explicitly selected", async () => {
    const saved = { type: "custom", customType: "pi-coffee-harness-state", data: { version: 99, mode: "future" } };
    const pi = setup([saved]); await pi.emit("session_start", {});
    expect(pi.getActiveTools()).toEqual([]);
    expect(pi.entries).toEqual([saved]);
    let aborted = false;
    for (const handler of pi.handlers.get("before_provider_request")!) await handler({ payload: {} }, { ...pi.context(), abort: () => { aborted = true; } });
    expect(aborted).toBe(true);
    await pi.runCommand("work", "");
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
  });
  it("keeps Pi Base, project context, Skills and Work body once; clears them all in Chat", async () => {
    const pi = setup(); await pi.emit("session_start", {});
    const base = "BASE SYSTEM\n<project_context>PROJECT</project_context>\nSKILLS";
    const work = await pi.emit("before_agent_start", { systemPrompt: base }) as { systemPrompt: string };
    expect(work.systemPrompt.startsWith(base)).toBe(true);
    expect(work.systemPrompt).toContain(renderHarnessPrompt("work"));
    expect(work.systemPrompt).toContain("passwordless sudo");
    expect(work.systemPrompt).toContain("normal commit and push to the current Conversation branch are already authorized");
    expect(work.systemPrompt).toContain("Shared/default branch merge, force-push");
    expect(await pi.emit("before_agent_start", work)).toEqual(work);
    await pi.runCommand("chat", "");
    expect(await pi.emit("before_agent_start", work)).toEqual({ systemPrompt: "" });
  });
  it("discovers Web without activating it until requested, then resets on model change", async () => {
    const pi = setup(); await pi.emit("session_start", {});
    const examples = [...renderHarnessPrompt("work").matchAll(/search_tools\((\{[^\n]*?\})\)/g)].map(m => JSON.parse(m[1]));
    for (const input of examples) expect(Check(pi.tools.get("search_tools")!.parameters, input)).toBe(true);
    expect((await pi.runTool("search_tools", examples[0])).details.hits.some((h: any) => h.id === "web")).toBe(true);
    expect(pi.getActiveTools()).not.toContain("web_search");
    expect((await pi.runTool("search_tools", examples[1])).details.ok).toBe(true);
    expect(pi.getActiveTools()).toContain("web_search");
    await pi.emit("model_select", {});
    expect(pi.getActiveTools()).toEqual([...WORK_TOOLS, "recall_folded"]);
  });
});
