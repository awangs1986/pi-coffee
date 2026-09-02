import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import harnessExtension from "../src/harness/extension.js";
import { FULL_TOOLS, SIMPLE_TOOLS } from "../src/harness/mode.js";

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

describe("PI Coffee V5 harness extension", () => {
  it("uses the frozen 8/10 tool tables and restores the mode from the session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    const first = new FakePi(cwd);
    harnessExtension(first.asExtensionApi());
    await first.emit("session_start", { type: "session_start", reason: "startup" });
    expect(first.getActiveTools()).toEqual([...SIMPLE_TOOLS]);

    await first.runCommand("harness", "full");
    expect(first.getActiveTools()).toEqual([...FULL_TOOLS]);
    expect(first.getActiveTools()).toHaveLength(10);

    const second = new FakePi(cwd, first.entries);
    harnessExtension(second.asExtensionApi());
    await second.emit("session_start", { type: "session_start", reason: "resume" });
    expect(second.getActiveTools()).toEqual([...FULL_TOOLS]);
  });

  it("maps V3 aliases without creating a third tool table", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    const pi = new FakePi(cwd);
    harnessExtension(pi.asExtensionApi());
    await pi.emit("session_start", { type: "session_start", reason: "startup" });

    await pi.runCommand("harness", "standard");
    expect(pi.getActiveTools()).toEqual([...FULL_TOOLS]);
    await pi.runCommand("harness", "tdd");
    expect(pi.getActiveTools()).toEqual([...FULL_TOOLS]);
    expect(pi.notifications.at(-1)?.message).toContain("full");
    await pi.runCommand("harness", "simple");
    expect(pi.getActiveTools()).toEqual([...SIMPLE_TOOLS]);
    const verifyState = pi.entries.filter((entry: any) => entry.customType === "pi-coffee-verify-state").at(-1) as any;
    expect(verifyState?.data.state.profile).toBe("none");
  });

  it("injects the selected V3-derived prompt exactly once per turn", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    const pi = new FakePi(cwd);
    harnessExtension(pi.asExtensionApi());
    await pi.emit("session_start", { type: "session_start", reason: "startup" });

    const lean = (await pi.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "hello",
      systemPrompt: "BASE SYSTEM",
      systemPromptOptions: {},
    })) as { systemPrompt: string };
    expect(lean.systemPrompt).toContain("# PI Coffee Harness Prompt (Lean)");
    expect(lean.systemPrompt.match(/# PI Coffee Harness Prompt \(Lean\)/g)).toHaveLength(1);

    await pi.runCommand("harness", "full");
    const full = (await pi.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "hello",
      systemPrompt: lean.systemPrompt,
      systemPromptOptions: {},
    })) as { systemPrompt: string };
    expect(full.systemPrompt).toContain("# PI Coffee Harness Prompt (Full)");
    expect(full.systemPrompt).not.toContain("# PI Coffee Harness Prompt (Lean)");
    expect(full.systemPrompt.match(/# PI Coffee Harness Prompt \(Full\)/g)).toHaveLength(1);
  });

  it("keeps git and verify resident but requires full mode for activation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    const pi = new FakePi(cwd);
    harnessExtension(pi.asExtensionApi());
    await pi.emit("session_start", { type: "session_start", reason: "startup" });

    expect(pi.tools.has("git")).toBe(true);
    expect(pi.tools.has("verify")).toBe(true);
    expect(pi.getActiveTools()).not.toContain("git");
    const search = await pi.runTool("search_tools", { action: "search", query: "git" });
    expect(search.content[0].text).toContain("git");
    const activation = await pi.runTool("search_tools", { action: "activate", capability_id: "git" });
    expect(activation.content[0].text).toContain("/harness full");
    expect(pi.getActiveTools()).toEqual([...SIMPLE_TOOLS]);
  });

  it("discovers and deliberately activates optional extension tools without changing V5 counts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    const pi = new FakePi(cwd);
    for (const name of ["subagent", "bg_wait"]) {
      pi.tools.set(name, {
        name,
        label: name,
        description: `${name} optional extension tool`,
        parameters: {} as never,
        execute: async () => ({ content: [{ type: "text", text: "" }], details: {} }),
      });
    }
    harnessExtension(pi.asExtensionApi());
    await pi.emit("session_start", { type: "session_start", reason: "startup" });

    const search = await pi.runTool("search_tools", { action: "search", query: "subagent" });
    expect(search.content[0].text).toContain("subagent");
    expect(search.content[0].text).toContain("available for activation");
    expect(pi.getActiveTools()).toHaveLength(SIMPLE_TOOLS.length);

    const activation = await pi.runTool("search_tools", { action: "activate", capability_id: "subagent" });
    expect(activation.details).toMatchObject({ ok: true, name: "subagent" });
    expect(pi.getActiveTools()).toEqual([...SIMPLE_TOOLS, "subagent"]);

    await pi.runCommand("harness", "full");
    expect(pi.getActiveTools()).toEqual([...FULL_TOOLS]);
    expect(pi.getActiveTools()).toHaveLength(FULL_TOOLS.length);
  });

  it("reports native VM verification results without V5 gate claims", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-coffee-harness-"));
    sessions.push(cwd);
    await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
    await mkdir(join(cwd, ".picode"), { recursive: true });
    await writeFile(
      join(cwd, ".picode", "verify.json"),
      JSON.stringify({ quick: [{ name: "smoke", command: "node -e \"console.log('ok')\"" }] }),
    );
    const pi = new FakePi(cwd);
    harnessExtension(pi.asExtensionApi());
    await pi.emit("session_start", { type: "session_start", reason: "startup" });
    await pi.runCommand("harness", "full");
    await pi.runCommand("verify", "profile quick");
    const result = await pi.runTool("verify", { action: "run" });
    expect(result.content[0].text).toContain("overall: passed");
    expect(result.content[0].text).not.toContain("Completion Label");
  });
});
