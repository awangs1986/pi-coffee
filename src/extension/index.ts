import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { delimiter, extname, join, resolve } from "node:path";
import { Type, type Static } from "typebox";
import { findProjectRoot } from "../lsp/cli.js";
import { resolveProfile } from "../lsp/profiles.js";
import { lspDaemonSocket, stopLspDaemon } from "../lsp/transport.js";
import { withCoffeeLspPath } from "../pi-skills.js";
import {
  loadExtensionConfig,
  type CoffeeLspExtensionConfig,
} from "./config.js";
import {
  displayPath,
  formatDiagnostic,
  formatEnvelope,
  summarizeSeverities,
} from "./format.js";
import { runQuery, type LspEnvelope } from "./query.js";

const OPERATIONS = [
  "status",
  "symbols",
  "definition",
  "references",
  "hover",
  "implementation",
  "diagnostics",
] as const;
type Operation = (typeof OPERATIONS)[number];
const POSITIONAL: readonly Operation[] = [
  "definition",
  "references",
  "hover",
  "implementation",
];

const lspParameters = Type.Object({
  operation: Type.Unsafe<Operation>({
    type: "string",
    enum: [...OPERATIONS],
    description:
      "status: is a server available for this file. symbols: document outline with 1-based positions. definition / references / implementation / hover: semantic navigation at line/column. diagnostics: type errors for one or more saved files.",
  }),
  file: Type.String({
    description: "File to query; absolute or relative to the working directory.",
  }),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Additional files for one diagnostics batch (same language project, at most 20 in total).",
    }),
  ),
  line: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "1-based line for definition, references, hover and implementation.",
    }),
  ),
  column: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "1-based column counted in Unicode code points. Take it from symbols or the current file contents.",
    }),
  ),
  includeDeclaration: Type.Optional(
    Type.Boolean({
      description: "references: also list the declaration itself.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 60000,
      description:
        "Operation budget in milliseconds (default 10000). Use 30000 for the first query on a cold project.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Maximum number of returned items for symbols, references and implementation.",
    }),
  ),
  workspace: Type.Optional(
    Type.String({
      description: "Bound project discovery to this directory (defaults to the working directory).",
    }),
  ),
});
type LspParameters = Static<typeof lspParameters>;

export interface ExtensionOptions {
  /** Base environment for daemon and language-server processes (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Override the PI_COFFEE_ROOT_SESSION value that names this process's daemon. */
  sessionId?: string;
}

/** Marks a PI_COFFEE_ROOT_SESSION value that this extension exported into the host process. */
const OWNED_SESSION_MARKER = "PI_COFFEE_LSP_OWNED_SESSION";

interface ExtensionState {
  /** PI_COFFEE_ROOT_SESSION used for every query from this Pi process. */
  session: string;
  cwd: string;
  config: CoffeeLspExtensionConfig;
  autoEnabled: boolean;
  prewarmed: Map<string, Promise<void>>;
  lastAuto?: { file: string; summary: string; at: number };
}

/**
 * Pi extension entry point: an `lsp` tool, automatic diagnostics after
 * edit/write, background warm-up on read, a `/lsp` command and daemon cleanup.
 */
export default function coffeeLspExtension(pi: ExtensionAPI): void {
  createCoffeeLspExtension(pi, {});
}

export function createCoffeeLspExtension(
  pi: ExtensionAPI,
  options: ExtensionOptions,
): ExtensionState {
  const baseEnv = options.env ?? process.env;
  // One daemon per Pi process: it stays warm across /new, /resume, /fork and
  // /reload and is stopped on quit. A PI_COFFEE_ROOT_SESSION that was already
  // present and not exported by an earlier instance of this extension (before
  // /reload) belongs to the caller: reuse it and never stop that daemon.
  const inherited = baseEnv.PI_COFFEE_ROOT_SESSION?.trim() || undefined;
  const ownedInherited =
    inherited && baseEnv[OWNED_SESSION_MARKER] === inherited ? inherited : undefined;
  const userSession = inherited && !ownedInherited ? inherited : undefined;
  const state: ExtensionState = {
    session:
      userSession ??
      options.sessionId ??
      ownedInherited ??
      `pi-${process.pid}-${Date.now().toString(36)}`,
    cwd: process.cwd(),
    config: loadExtensionConfig(process.cwd(), baseEnv),
    autoEnabled: true,
    prewarmed: new Map(),
  };
  state.autoEnabled = state.config.autoDiagnostics;

  const environment = (): NodeJS.ProcessEnv => ({
    ...baseEnv,
    PI_COFFEE_ROOT_SESSION: state.session,
    PI_COFFEE_LSP_IDLE_MS:
      baseEnv.PI_COFFEE_LSP_IDLE_MS?.trim() || String(state.config.daemonIdleMs),
  });

  // Bash inherits the host process environment. Exporting the session id and
  // the launcher directory lets `coffee-lsp` calls from the Skill share this
  // process's warm servers instead of starting a second daemon.
  const exportHostEnvironment = (): void => {
    if (baseEnv !== process.env) return;
    if (!userSession) {
      process.env.PI_COFFEE_ROOT_SESSION = state.session;
      process.env[OWNED_SESSION_MARKER] = state.session;
    }
    if (!process.env.PI_COFFEE_LSP_IDLE_MS?.trim())
      process.env.PI_COFFEE_LSP_IDLE_MS = String(state.config.daemonIdleMs);
    if (process.platform === "win32") return;
    const binDirectory = withCoffeeLspPath(process.env).PATH.split(delimiter)[0];
    const current = (process.env.PATH ?? "").split(delimiter);
    if (existsSync(join(binDirectory, "coffee-lsp")) && !current.includes(binDirectory))
      process.env.PATH = [binDirectory, ...current].filter(Boolean).join(delimiter);
  };

  const bind = (ctx: ExtensionContext) => {
    if (ctx.cwd !== state.cwd) {
      state.cwd = ctx.cwd;
      state.config = loadExtensionConfig(ctx.cwd, baseEnv);
      state.autoEnabled = state.config.autoDiagnostics;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    state.config = loadExtensionConfig(ctx.cwd, baseEnv);
    state.autoEnabled = state.config.autoDiagnostics;
    state.prewarmed.clear();
    bind(ctx);
    exportHostEnvironment();
  });

  pi.on("session_shutdown", async (event) => {
    // Session switches and reloads keep the process daemon warm; quitting Pi
    // retires it. A caller-provided session id is the caller's to stop.
    if (event.reason !== "quit" || userSession) return;
    await stopOwnedDaemon(environment());
  });

  pi.on("tool_result", async (event, ctx) => {
    bind(ctx);
    if (event.isError) return;
    if (event.toolName === "read") {
      if (state.config.prewarm) prewarm(event, ctx);
      return;
    }
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (!state.autoEnabled) return;
    const file = inputPath(event, ctx.cwd);
    if (!file || !supported(file, ctx.cwd, environment())) return;
    const appended = await automaticDiagnostics(file, ctx);
    if (!appended) return;
    return { content: [...event.content, { type: "text", text: appended }] };
  });

  pi.registerTool<typeof lspParameters, LspEnvelope | undefined>({
    name: "lsp",
    label: "LSP",
    description:
      "Query the project's language server: diagnostics, symbols, definition, references, implementation and hover. Results describe saved files; positions are 1-based lines and Unicode code-point columns.",
    promptSnippet:
      "Language-server semantics: diagnostics, symbols, definition, references, implementation, hover",
    promptGuidelines: [
      "Use lsp (definition, references, implementation, hover, symbols) instead of grep when you need to know what a symbol is or who uses it; use grep for plain text patterns.",
      "Language-server diagnostics for a file are appended automatically to successful edit and write results; fix reported errors before moving on. Use lsp diagnostics to re-check a file or its dependents explicitly.",
      "Take lsp positions from lsp symbols or from the current file contents. A diagnostics result is clean only when it says clean; inconclusive means run the project's own compiler or tests.",
    ],
    parameters: lspParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      bind(ctx);
      const args = buildArgs(params, ctx.cwd);
      const outcome = await runQuery(args, {
        cwd: ctx.cwd,
        env: environment(),
        signal,
      });
      const envelope = outcome.envelope;
      if (!envelope) {
        throw new Error(
          outcome.stderr.trim() ||
            `coffee-lsp ${params.operation} produced no result (exit ${outcome.code})`,
        );
      }
      const text = formatEnvelope(envelope, ctx.cwd);
      const failure = envelope.issues?.find((issue) =>
        ["invalid_arguments", "server_failed", "daemon_failed"].includes(issue.code),
      );
      if (failure) throw new Error(text);
      return { content: [{ type: "text", text }], details: envelope };
    },
  });

  pi.registerCommand("lsp", {
    description:
      "LSP extension: /lsp [status|check <file>|auto on|off|stop|restart]",
    handler: async (rawArgs, ctx) => {
      bind(ctx);
      const [command = "status", ...rest] = rawArgs.trim().split(/\s+/).filter(Boolean);
      const notify = (message: string, type: "info" | "warning" | "error" = "info") =>
        ctx.ui.notify(message, type);
      switch (command) {
        case "status": {
          const env = environment();
          const socket = lspDaemonSocket(env);
          notify(
            [
              `coffee-lsp session ${env.PI_COFFEE_ROOT_SESSION}${userSession ? " (provided by the caller)" : ""}`,
              `daemon socket ${socket} (${existsSync(socket) ? "present" : "not started"})`,
              `auto diagnostics ${state.autoEnabled ? "on" : "off"} (budget ${state.config.autoDiagnosticsTimeoutMs} ms, max ${state.config.maxItems} items, warnings ${state.config.includeWarnings ? "on" : "off"}, clean reports ${state.config.reportClean ? "on" : "off"})`,
              `prewarm ${state.config.prewarm ? "on" : "off"}, daemon idle ${Math.round(state.config.daemonIdleMs / 60000)} min`,
              state.lastAuto
                ? `last automatic check: ${displayPath(state.lastAuto.file, ctx.cwd)} → ${state.lastAuto.summary}`
                : "last automatic check: none yet",
            ].join("\n"),
          );
          return;
        }
        case "check": {
          const target = rest[0];
          if (!target) {
            notify("Usage: /lsp check <file>", "warning");
            return;
          }
          const outcome = await runQuery(
            [
              "diagnostics",
              "--file",
              resolve(ctx.cwd, target),
              "--timeout-ms",
              "30000",
            ],
            { cwd: ctx.cwd, env: environment(), signal: ctx.signal },
          );
          notify(
            outcome.envelope
              ? formatEnvelope(outcome.envelope, ctx.cwd)
              : outcome.stderr.trim() || "coffee-lsp produced no result",
            outcome.code === 0 ? "info" : "warning",
          );
          return;
        }
        case "auto": {
          const value = rest[0];
          if (value === "on" || value === "off") {
            state.autoEnabled = value === "on";
            notify(`automatic diagnostics ${state.autoEnabled ? "enabled" : "disabled"} for this session`);
          } else notify("Usage: /lsp auto on|off", "warning");
          return;
        }
        case "stop":
        case "restart": {
          const stopped = await stopOwnedDaemon(environment());
          if (command === "restart") state.prewarmed.clear();
          notify(
            stopped
              ? command === "restart"
                ? "language servers stopped; the next query starts them again"
                : "language servers stopped"
              : "no session daemon was running",
          );
          return;
        }
        default:
          notify("Usage: /lsp [status|check <file>|auto on|off|stop|restart]", "warning");
      }
    },
  });

  return state;

  function prewarm(event: ToolResultEvent, ctx: ExtensionContext): void {
    const file = inputPath(event, ctx.cwd);
    if (!file) return;
    const env = environment();
    const key = supported(file, ctx.cwd, env);
    if (!key || state.prewarmed.has(key)) return;
    // symbols opens the document and initialises the project without waiting
    // for diagnostics, so the first edit usually meets a warm server.
    const warm = runQuery(
      ["symbols", "--file", file, "--timeout-ms", "30000", "--limit", "1"],
      { cwd: ctx.cwd, env },
    )
      .then(() => undefined)
      .catch(() => undefined);
    state.prewarmed.set(key, warm);
  }

  async function automaticDiagnostics(
    file: string,
    ctx: ExtensionContext,
  ): Promise<string | undefined> {
    const env = environment();
    const key = supported(file, ctx.cwd, env);
    if (!key) return undefined;
    const warm = state.prewarmed.get(key);
    if (warm) await warm;
    const outcome = await runQuery(
      [
        "diagnostics",
        "--file",
        file,
        "--timeout-ms",
        String(state.config.autoDiagnosticsTimeoutMs),
      ],
      { cwd: ctx.cwd, env, signal: ctx.signal },
    );
    const envelope = outcome.envelope;
    if (!envelope || envelope.operation !== "diagnostics") return undefined;
    if (envelope.diagnosticState === "clean") {
      state.lastAuto = { file, summary: "clean", at: Date.now() };
      return state.config.reportClean
        ? `LSP diagnostics (${envelope.server?.id}): ${displayPath(file, ctx.cwd)} has no errors.`
        : undefined;
    }
    if (envelope.diagnosticState !== "findings") {
      // Missing servers, cold projects and stale snapshots are not evidence;
      // stay silent instead of teaching the model to ignore this section.
      state.lastAuto = {
        file,
        summary: `${envelope.issues?.[0]?.code ?? envelope.status}`,
        at: Date.now(),
      };
      return undefined;
    }
    const items = (envelope.items ?? [])
      .filter(
        (item) =>
          item.severity === 1 ||
          (state.config.includeWarnings && item.severity === 2) ||
          item.severity === undefined,
      )
      .sort((a, b) => (a.severity ?? 9) - (b.severity ?? 9));
    if (items.length === 0) {
      state.lastAuto = { file, summary: "only info/hint diagnostics", at: Date.now() };
      return state.config.reportClean
        ? `LSP diagnostics (${envelope.server?.id}): ${displayPath(file, ctx.cwd)} has no errors.`
        : undefined;
    }
    const shown = items.slice(0, state.config.maxItems);
    const summary = summarizeSeverities(items);
    state.lastAuto = { file, summary, at: Date.now() };
    const lines = [
      `LSP diagnostics (${envelope.server?.id}): ${summary} in ${displayPath(file, ctx.cwd)}`,
      ...shown.map((item) => `  ${formatDiagnostic(item, ctx.cwd)}`),
    ];
    if (items.length > shown.length)
      lines.push(`  … ${items.length - shown.length} more; run lsp diagnostics for the full list`);
    return lines.join("\n");
  }
}

function inputPath(event: ToolResultEvent, cwd: string): string | undefined {
  const raw = (event.input as Record<string, unknown> | undefined)?.path;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const file = resolve(cwd, raw);
  return existsSync(file) ? file : undefined;
}

/** Returns a warm-up cache key when a language server profile covers this file. */
function supported(
  file: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!extname(file)) return undefined;
  let root: string;
  try {
    root = findProjectRoot(file, cwd, false);
  } catch {
    return undefined;
  }
  const profile = resolveProfile(file, root, env);
  return profile.available ? `${profile.id}:${root}` : undefined;
}

function buildArgs(params: LspParameters, cwd: string): string[] {
  const args: string[] = [params.operation, "--file", resolve(cwd, params.file)];
  if (params.operation === "diagnostics")
    for (const extra of params.files ?? []) args.push("--file", resolve(cwd, extra));
  if (POSITIONAL.includes(params.operation)) {
    if (params.line !== undefined) args.push("--line", String(params.line));
    if (params.column !== undefined) args.push("--column", String(params.column));
  }
  if (params.operation === "references" && params.includeDeclaration)
    args.push("--include-declaration");
  if (params.timeoutMs !== undefined) args.push("--timeout-ms", String(params.timeoutMs));
  if (params.limit !== undefined) args.push("--limit", String(params.limit));
  if (params.workspace) args.push("--workspace", resolve(cwd, params.workspace));
  return args;
}

async function stopOwnedDaemon(env: NodeJS.ProcessEnv): Promise<boolean> {
  const socket = lspDaemonSocket(env);
  if (!existsSync(socket)) return false;
  try {
    await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION!, env);
    return true;
  } catch {
    return false;
  }
}
