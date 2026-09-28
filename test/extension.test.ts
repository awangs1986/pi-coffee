import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { loadExtensionConfig } from "../src/extension/config.js";
import {
  formatDiagnostic,
  formatEnvelope,
  summarizeSeverities,
} from "../src/extension/format.js";
import { lspDaemonSocket, stopLspDaemon } from "../src/lsp/transport.js";

describe("extension formatting", () => {
  it("renders compact diagnostics, symbols and issues", () => {
    const cwd = "/work/project";
    const diagnostics = formatEnvelope(
      {
        schemaVersion: 1,
        operation: "diagnostics",
        status: "ok",
        server: { id: "typescript", state: "running" },
        diagnosticState: "findings",
        coverage: { requestedFiles: 1, confirmedFiles: 1 },
        items: [
          {
            path: "/work/project/src/app.ts",
            location: { line: 2, column: 7 },
            severity: 1,
            code: 2322,
            source: "ts",
            message: "Type 'string' is not\n  assignable to type 'number'.",
          },
          {
            path: "/work/project/src/app.ts",
            location: { line: 9, column: 1 },
            severity: 2,
            message: "unused",
          },
        ],
      },
      cwd,
    );
    expect(diagnostics).toBe(
      [
        "diagnostics: 1 error, 1 warning (typescript)",
        "  src/app.ts:2:7 error ts(2322): Type 'string' is not assignable to type 'number'.",
        "  src/app.ts:9:1 warning: unused",
      ].join("\n"),
    );

    const symbols = formatEnvelope(
      {
        schemaVersion: 1,
        operation: "symbols",
        status: "ok",
        server: { id: "python", state: "running" },
        items: [
          { name: "Game", kind: 5, location: { line: 3, column: 7 } },
          {
            name: "update",
            kind: 6,
            container: "Game",
            location: { line: 8, column: 9 },
          },
        ],
        coverage: { truncated: true },
      },
      cwd,
    );
    expect(symbols).toContain("2 symbols (python)");
    expect(symbols).toContain("  3:7  class Game");
    expect(symbols).toContain("  8:9  method update (in Game)");
    expect(symbols).toContain("truncated");

    const unavailable = formatEnvelope(
      {
        schemaVersion: 1,
        operation: "diagnostics",
        status: "unavailable",
        server: { id: "typescript", state: "inconclusive" },
        diagnosticState: "inconclusive",
        coverage: { requestedFiles: 2, confirmedFiles: 0 },
        issues: [{ code: "request_timeout", message: "Server did not confirm in time." }],
        nextAction: "Retry with a larger --timeout-ms.",
      },
      cwd,
    );
    expect(unavailable).toContain("inconclusive");
    expect(unavailable).toContain("! request_timeout: Server did not confirm in time.");
    expect(unavailable).toContain("next: Retry with a larger --timeout-ms.");

    expect(
      formatDiagnostic(
        { path: "/elsewhere/x.py", location: { line: 1, column: 1 }, severity: 4, message: "m" },
        cwd,
      ),
    ).toBe("/elsewhere/x.py:1:1 hint: m");
    expect(summarizeSeverities([])).toBe("no diagnostics");
  });

  it("layers extension configuration from agent dir, workspace and environment", () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-ext-config-"));
    try {
      const agent = join(root, "agent");
      const workspace = join(root, "workspace");
      mkdirSync(agent);
      mkdirSync(workspace);
      expect(loadExtensionConfig(workspace, { PI_CODING_AGENT_DIR: agent })).toMatchObject({
        autoDiagnostics: true,
        autoDiagnosticsTimeoutMs: 8000,
        maxItems: 10,
      });
      writeFileSync(
        join(agent, "coffee-lsp.json"),
        JSON.stringify({ pi: { autoDiagnosticsTimeoutMs: 4000, maxItems: 3, prewarm: false } }),
      );
      writeFileSync(
        join(workspace, "coffee-lsp.json"),
        JSON.stringify({
          typescript: { settings: {} },
          pi: { maxItems: 5, includeWarnings: false, daemonIdleMs: -1 },
        }),
      );
      expect(
        loadExtensionConfig(workspace, {
          PI_CODING_AGENT_DIR: agent,
          PI_COFFEE_LSP_AUTO_DIAGNOSTICS: "off",
        }),
      ).toEqual({
        autoDiagnostics: false,
        autoDiagnosticsTimeoutMs: 4000,
        maxItems: 5,
        reportClean: true,
        includeWarnings: false,
        prewarm: false,
        daemonIdleMs: 30 * 60 * 1000,
      });
      writeFileSync(join(workspace, "coffee-lsp.json"), "{ not json");
      expect(loadExtensionConfig(workspace, { PI_CODING_AGENT_DIR: agent }).maxItems).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Pi extension", () => {
  it(
    "appends diagnostics to edits, exposes the lsp tool and command, and retires its daemon",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "coffee-lsp-ext-"));
      const project = join(root, "project");
      const source = join(project, "src/app.ts");
      mkdirSync(join(project, "src"), { recursive: true });
      mkdirSync(join(root, "agent"));
      writeFileSync(join(project, "tsconfig.json"), "{}\n");
      writeFileSync(source, "export const target = 1;\n");
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_RUNTIME_DIR: root,
        PI_CODING_AGENT_DIR: join(root, "agent"),
        PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
          process.execPath,
          resolve("test/fixtures/fake-lsp-server.mjs"),
        ]),
      };
      delete env.PI_COFFEE_ROOT_SESSION;
      delete env.PI_COFFEE_LSP_IDLE_MS;
      delete env.PI_COFFEE_LSP_AUTO_DIAGNOSTICS;
      const sessionEnv = { ...env, PI_COFFEE_ROOT_SESSION: "pi-session-42" };
      const socket = lspDaemonSocket(sessionEnv);

      // The built artifact is what Pi loads; its daemon spawns dist/src/lsp/bin.js.
      const module = await import(
        pathToFileURL(resolve("dist/src/extension/index.js")).href
      );
      const harness = createHarness(project, "session-42");
      try {
        module.createCoffeeLspExtension(harness.pi, { env, sessionId: "pi-session-42" });
        expect(harness.tools.has("lsp")).toBe(true);
        expect(harness.commands.has("lsp")).toBe(true);
        await harness.emit("session_start", { type: "session_start", reason: "startup" });

        // Reading a supported file warms the project without blocking.
        await harness.emit("tool_result", toolResult("read", { path: "src/app.ts" }));

        // A write that introduces an error gets the error appended.
        writeFileSync(source, "export const target = 1;\nconst value = BAD;\n");
        const failing = await harness.emit(
          "tool_result",
          toolResult("write", { path: "src/app.ts", content: "..." }),
        );
        expect(failing?.content).toHaveLength(2);
        const appended = failing!.content![1] as { type: "text"; text: string };
        expect(appended.text).toContain("LSP diagnostics (typescript): 1 error in src/app.ts");
        expect(appended.text).toContain("src/app.ts:2:7 error fixture-lsp(fixture-error): BAD is not assignable");
        expect(existsSync(socket)).toBe(true);

        // A clean edit gets a one-line confirmation.
        writeFileSync(source, "export const target = 1;\nconst value = 2;\n");
        const clean = await harness.emit(
          "tool_result",
          toolResult("edit", { path: source, edits: [{ oldText: "BAD", newText: "2" }] }),
        );
        expect((clean!.content![1] as { text: string }).text).toBe(
          "LSP diagnostics (typescript): src/app.ts has no errors.",
        );

        // Unsupported files and failed tool calls are left untouched.
        writeFileSync(join(project, "notes.md"), "# notes\n");
        expect(
          await harness.emit("tool_result", toolResult("write", { path: "notes.md", content: "" })),
        ).toBeUndefined();
        expect(
          await harness.emit("tool_result", {
            ...toolResult("edit", { path: source, edits: [] }),
            isError: true,
          }),
        ).toBeUndefined();

        // The lsp tool renders compact text and keeps the envelope in details.
        const tool = harness.tools.get("lsp")!;
        const symbols = await tool.execute(
          "call-1",
          { operation: "symbols", file: "src/app.ts" },
          new AbortController().signal,
          () => {},
          harness.ctx,
        );
        expect(symbols.content[0].text).toContain("1 symbol (typescript)");
        expect(symbols.content[0].text).toContain("1:17  function target");
        expect(symbols.details).toMatchObject({ operation: "symbols", status: "ok" });
        await expect(
          tool.execute(
            "call-2",
            { operation: "definition", file: "src/app.ts" },
            new AbortController().signal,
            () => {},
            harness.ctx,
          ),
        ).rejects.toThrow(/invalid_arguments/);

        // The registry is reachable without a file, from the tool and the command.
        const servers = await tool.execute(
          "call-3",
          { operation: "servers" },
          new AbortController().signal,
          () => {},
          harness.ctx,
        );
        expect(servers.content[0].text).toMatch(/^language servers: \d+ available, \d+ not installed/);
        expect(servers.content[0].text).toContain("+ typescript: TypeScript / JavaScript");
        expect(servers.content[0].text).toContain("vue: Vue [.vue]");
        expect(servers.details).toMatchObject({ operation: "servers", status: "ok" });
        await expect(
          tool.execute(
            "call-4",
            { operation: "status" },
            new AbortController().signal,
            () => {},
            harness.ctx,
          ),
        ).rejects.toThrow(/requires file/);

        // /lsp status, auto toggling and explicit checks.
        const command = harness.commands.get("lsp")!;
        await command.handler("servers", harness.ctx);
        expect(harness.notifications.at(-1)).toContain("language servers:");
        await command.handler("install", harness.ctx);
        expect(harness.notifications.at(-1)).toContain("Usage: /lsp install");
        await command.handler("install rust", harness.ctx);
        expect(harness.notifications.at(-1)).toContain("manual_install_required");
        await command.handler("status", harness.ctx);
        expect(harness.notifications.at(-1)).toContain("auto diagnostics on");
        expect(harness.notifications.at(-1)).toContain("last automatic check: src/app.ts");
        await command.handler("auto off", harness.ctx);
        writeFileSync(source, "export const target = 1;\nconst value = BAD;\n");
        expect(
          await harness.emit(
            "tool_result",
            toolResult("write", { path: "src/app.ts", content: "..." }),
          ),
        ).toBeUndefined();
        await command.handler("auto on", harness.ctx);
        await command.handler("check src/app.ts", harness.ctx);
        expect(harness.notifications.at(-1)).toContain("diagnostics: 1 error (typescript)");
        expect(harness.notifications.at(-1)).toContain("fixture-error");

        // Session switches keep the process daemon; quitting Pi stops it.
        expect(existsSync(socket)).toBe(true);
        await harness.emit("session_shutdown", { type: "session_shutdown", reason: "new" });
        expect(existsSync(socket)).toBe(true);
        await harness.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
        expect(existsSync(socket)).toBe(false);
      } finally {
        await stopLspDaemon("pi-session-42", env).catch(() => {});
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

function toolResult(
  toolName: "read" | "edit" | "write",
  input: Record<string, unknown>,
): ToolResultEvent {
  return {
    type: "tool_result",
    toolName,
    toolCallId: `${toolName}-${Math.random().toString(36).slice(2)}`,
    input,
    content: [{ type: "text", text: `${toolName} ok` }],
    isError: false,
    details: undefined,
  } as unknown as ToolResultEvent;
}

function createHarness(cwd: string, sessionId: string) {
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  const ctx = {
    cwd,
    hasUI: false,
    mode: "rpc",
    signal: undefined,
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      notify: (message: string) => {
        notifications.push(message);
      },
      setStatus: () => {},
    },
    isProjectTrusted: () => true,
  } as unknown as ExtensionContext;
  const pi = {
    on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(definition: any) {
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: any) {
      commands.set(name, definition);
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    ctx,
    tools,
    commands,
    notifications,
    async emit(event: string, payload: any): Promise<any> {
      let result: unknown;
      for (const handler of handlers.get(event) ?? []) {
        const value = await handler(payload, ctx);
        if (value !== undefined) result = value;
      }
      return result;
    },
  };
}
