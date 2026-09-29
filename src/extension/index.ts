import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { Type, type Static } from "typebox";
import { MAX_DOCUMENT_BYTES, findProjectRoot } from "../lsp/cli.js";
import { resolveProfile, type LspProfileResolution } from "../lsp/profiles.js";
import { lspDaemonSocket, stopLspDaemon } from "../lsp/transport.js";
import { withCoffeeLspPath } from "../pi-skills.js";
import { PACKAGE_VERSION } from "../version.js";
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
  "servers",
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
      "status: is a server available for this file. symbols: document outline with 1-based positions. definition / references / implementation / hover: semantic navigation at line/column. diagnostics: type errors for one or more saved files. servers: the language-server registry and which servers are installed (file optional).",
  }),
  file: Type.Optional(
    Type.String({
      description:
        "File to query; absolute or relative to the working directory. Required for every operation except servers.",
    }),
  ),
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
  symbol: Type.Optional(
    Type.String({
      description:
        "Instead of column: the identifier to look up, positioned at its first whole-word occurrence in the file (or on line when given). Use name#2 for the second occurrence.",
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
/** Files a session opens through reads; edits always open their file. */
const MAX_PREWARMED_FILES = 40;

interface ExtensionState {
  /** PI_COFFEE_ROOT_SESSION used for every query from this Pi process. */
  session: string;
  cwd: string;
  config: CoffeeLspExtensionConfig;
  autoEnabled: boolean;
  /** Files opened in their project's server by a read, with the warm-up they started or joined. */
  prewarmed: Map<string, { project: string; done: Promise<void> }>;
  lastAuto?: { file: string; summary: string; at: number };
  /** Server ids whose missing-installation hint was already shown this session. */
  hinted: Set<string>;
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
    hinted: new Set(),
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
    if (!file) return;
    const coverage = supported(file, ctx.cwd, environment());
    const appended = coverage.key
      ? await automaticDiagnostics(file, ctx)
      : missingServerHint(coverage.profile, file, ctx);
    if (!appended) return;
    return { content: [...event.content, { type: "text", text: appended }] };
  });

  pi.registerTool<typeof lspParameters, LspEnvelope | undefined>({
    name: "lsp",
    label: "LSP",
    description:
      "Query the project's language server: diagnostics, symbols, definition, references, implementation and hover. Results describe saved files; positions are 1-based lines and Unicode code-point columns, or give symbol: \"name\" instead of a column.",
    promptSnippet:
      "Language-server semantics: diagnostics, symbols, definition, references, implementation, hover",
    promptGuidelines: [
      "Use lsp (definition, references, implementation, hover, symbols) instead of grep when you need to know what a symbol is or who uses it; use grep for plain text patterns.",
      "Language-server diagnostics for a file are appended automatically to successful edit and write results, followed by any new errors the change caused in other files open in this session ('related'); fix both before moving on. Use lsp diagnostics to re-check a file or its dependents explicitly.",
      "For lsp navigation pass symbol: \"name\" (or name#2 for the second occurrence) instead of counting columns; take exact positions from lsp symbols when a name is ambiguous. A diagnostics result is clean only when it says clean; inconclusive means run the project's own compiler or tests.",
    ],
    parameters: lspParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      bind(ctx);
      if (params.operation !== "servers" && !params.file)
        throw new Error(`lsp ${params.operation} requires file`);
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
      "LSP extension: /lsp [version|status|check <file>|servers|install <id>|auto on|off|stop|restart]",
    handler: async (rawArgs, ctx) => {
      bind(ctx);
      const [command = "status", ...rest] = rawArgs.trim().split(/\s+/).filter(Boolean);
      const notify = (message: string, type: "info" | "warning" | "error" = "info") =>
        ctx.ui.notify(message, type);
      switch (command) {
        case "version":
          notify(`pi-coffee-lsp ${PACKAGE_VERSION}`);
          return;
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
        case "servers": {
          const outcome = await runQuery(["servers"], {
            cwd: ctx.cwd,
            env: environment(),
            signal: ctx.signal,
          });
          notify(
            outcome.envelope
              ? formatEnvelope(outcome.envelope, ctx.cwd)
              : outcome.stderr.trim() || "coffee-lsp produced no result",
            outcome.code === 0 ? "info" : "warning",
          );
          return;
        }
        case "install": {
          const id = rest[0];
          if (!id) {
            notify("Usage: /lsp install <server id> (see /lsp servers)", "warning");
            return;
          }
          notify(`installing ${id} into the managed prefix; this runs npm and may take a minute`);
          const outcome = await runQuery(["install", id], {
            cwd: ctx.cwd,
            env: environment(),
            signal: ctx.signal,
          });
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
          notify(
            "Usage: /lsp [status|check <file>|servers|install <id>|auto on|off|stop|restart]",
            "warning",
          );
      }
    },
  });

  return state;

  function prewarm(event: ToolResultEvent, ctx: ExtensionContext): void {
    const file = inputPath(event, ctx.cwd);
    if (!file) return;
    const env = environment();
    const project = supported(file, ctx.cwd, env).key;
    if (!project || state.prewarmed.has(file)) return;
    // Every file read joins the server's open set, so later edits elsewhere
    // report their fallout in it (related diagnostics). Bounded so a long
    // session does not keep hundreds of documents open.
    if (state.prewarmed.size >= MAX_PREWARMED_FILES) return;
    // symbols opens the document and initialises the project without waiting
    // for diagnostics, so the first edit usually meets a warm server.
    const done = runQuery(
      ["symbols", "--file", file, "--timeout-ms", "30000", "--limit", "1"],
      { cwd: ctx.cwd, env },
    )
      .then(() => undefined)
      .catch(() => undefined);
    state.prewarmed.set(file, { project, done });
  }

  /**
   * One line, once per server and session, when an edited file type has a
   * registry entry but no installed server: the only case where silence would
   * hide an actionable fix. Unsupported file types stay silent.
   */
  function missingServerHint(
    profile: LspProfileResolution | undefined,
    file: string,
    ctx: ExtensionContext,
  ): string | undefined {
    if (!profile || profile.id === "unknown" || state.hinted.has(profile.id)) return undefined;
    state.hinted.add(profile.id);
    const language = profile.definition?.language ?? profile.id;
    const install = profile.definition?.npm
      ? `/lsp install ${profile.id} (or coffee-lsp install ${profile.id})`
      : profile.definition?.install ?? "see /lsp servers";
    return `LSP: no ${language} language server is installed, so ${displayPath(file, ctx.cwd)} is not checked after edits. Install: ${install}. Verify with the project's own build or tests meanwhile.`;
  }

  async function automaticDiagnostics(
    file: string,
    ctx: ExtensionContext,
  ): Promise<string | undefined> {
    const env = environment();
    const key = supported(file, ctx.cwd, env).key;
    if (!key) return undefined;
    // Wait for this project's warm-ups so a cold start does not eat the budget.
    await Promise.all(
      [...state.prewarmed.values()].filter((entry) => entry.project === key).map((entry) => entry.done),
    );
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
    if (envelope.diagnosticState !== "clean" && envelope.diagnosticState !== "findings") {
      // Missing servers, cold projects and stale snapshots are not evidence;
      // stay silent instead of teaching the model to ignore this section. A
      // server that cannot run at all is explained once, so the fix (install,
      // start the editor, add a project file) is not hidden.
      const issue = envelope.issues?.[0];
      state.lastAuto = { file, summary: `${issue?.code ?? envelope.status}`, at: Date.now() };
      const serverId = envelope.server?.id ?? "unknown";
      if (
        issue &&
        ["server_failed", "missing_server", "project_configuration_missing"].includes(issue.code) &&
        !state.hinted.has(serverId)
      ) {
        state.hinted.add(serverId);
        return `LSP: ${serverId} language server unavailable for ${displayPath(file, ctx.cwd)} (${issue.code}: ${issue.message}). Diagnostics are off for this language until that is fixed; rely on the project's build or tests meanwhile.`;
      }
      return undefined;
    }
    const relevant = (item: any) =>
      item.severity === 1 ||
      (state.config.includeWarnings && item.severity === 2) ||
      item.severity === undefined;
    const bySeverity = (a: any, b: any) => (a.severity ?? 9) - (b.severity ?? 9);
    const items = (envelope.items ?? []).filter(relevant).sort(bySeverity);
    const related = (envelope.related ?? []).filter(relevant).sort(bySeverity);
    const lines: string[] = [];
    if (items.length === 0) {
      state.lastAuto = {
        file,
        summary: envelope.diagnosticState === "clean" ? "clean" : "only info/hint diagnostics",
        at: Date.now(),
      };
      if (state.config.reportClean || related.length > 0)
        lines.push(
          `LSP diagnostics (${envelope.server?.id}): ${displayPath(file, ctx.cwd)} has no errors.`,
        );
    } else {
      const shown = items.slice(0, state.config.maxItems);
      const summary = summarizeSeverities(items);
      state.lastAuto = { file, summary, at: Date.now() };
      lines.push(
        `LSP diagnostics (${envelope.server?.id}): ${summary} in ${displayPath(file, ctx.cwd)}`,
        ...shown.map((item) => `  ${formatDiagnostic(item, ctx.cwd)}`),
      );
      if (items.length > shown.length)
        lines.push(`  … ${items.length - shown.length} more; run lsp diagnostics for the full list`);
    }
    // Fallout in other files open in this session: what a compiler run would
    // reveal later, surfaced now while the change is still in context.
    if (related.length > 0) {
      const files = new Set(related.map((item) => item.path));
      const shown = related.slice(0, state.config.maxItems);
      state.lastAuto.summary += `; related: ${summarizeSeverities(related)}`;
      lines.push(
        `LSP related diagnostics: this change newly caused ${summarizeSeverities(related)} in ${files.size} other open file${files.size === 1 ? "" : "s"}`,
        ...shown.map((item) => `  ${formatDiagnostic(item, ctx.cwd)}`),
      );
      if (related.length > shown.length)
        lines.push(`  … ${related.length - shown.length} more; run lsp diagnostics on those files`);
    }
    return lines.length ? lines.join("\n") : undefined;
  }
}

function inputPath(event: ToolResultEvent, cwd: string): string | undefined {
  const raw = (event.input as Record<string, unknown> | undefined)?.path;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const file = resolve(cwd, raw);
  return existsSync(file) ? file : undefined;
}

/**
 * Returns a warm-up cache key when an enabled, installed language server
 * covers this file, plus the resolution itself so callers can explain a
 * missing server. Files without extension (Dockerfile, CMakeLists.txt) are
 * matched by name through the registry; oversized files are never synchronized.
 */
function supported(
  file: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): { key?: string; profile?: LspProfileResolution } {
  let root: string;
  try {
    if (statSync(file).size > MAX_DOCUMENT_BYTES) return {};
    root = findProjectRoot(file, cwd, false, env);
  } catch {
    return {};
  }
  const profile = resolveProfile(file, root, env, cwd);
  return { profile, ...(profile.available ? { key: `${profile.id}:${root}` } : {}) };
}

function buildArgs(params: LspParameters, cwd: string): string[] {
  const args: string[] = [params.operation];
  if (params.file) args.push("--file", resolve(cwd, params.file));
  if (params.operation === "diagnostics")
    for (const extra of params.files ?? []) args.push("--file", resolve(cwd, extra));
  if (POSITIONAL.includes(params.operation)) {
    if (params.line !== undefined) args.push("--line", String(params.line));
    if (params.symbol) args.push("--symbol", params.symbol);
    else if (params.column !== undefined) args.push("--column", String(params.column));
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
