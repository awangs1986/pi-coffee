import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Extension behaviour that is not language-server configuration. It lives under
 * the top-level `pi` key of `coffee-lsp.json`, so it never collides with the
 * per-profile `settings` / `initializationOptions` sections read by the CLI.
 *
 * Precedence, lowest to highest: defaults → `<agent-dir>/coffee-lsp.json` →
 * `<workspace>/coffee-lsp.json` → environment variables.
 */
export interface CoffeeLspExtensionConfig {
  /** Append language-server diagnostics to successful edit/write results. */
  autoDiagnostics: boolean;
  /** Budget for one automatic diagnostics query; inconclusive results are dropped silently. */
  autoDiagnosticsTimeoutMs: number;
  /** Maximum diagnostics appended per edit. Errors are listed before warnings. */
  maxItems: number;
  /** Also append a one-line confirmation when a file has no diagnostics. */
  reportClean: boolean;
  /** Include warnings (severity 2) in automatic diagnostics; errors are always included. */
  includeWarnings: boolean;
  /** Start the project's language server when a supported file is first read. */
  prewarm: boolean;
  /** Idle shutdown for the session-owned daemon. */
  daemonIdleMs: number;
}

export const DEFAULT_EXTENSION_CONFIG: CoffeeLspExtensionConfig = {
  autoDiagnostics: true,
  autoDiagnosticsTimeoutMs: 8000,
  maxItems: 10,
  reportClean: true,
  includeWarnings: true,
  prewarm: true,
  daemonIdleMs: 30 * 60 * 1000,
};

export function agentDirectory(env: NodeJS.ProcessEnv): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function loadExtensionConfig(
  workspace: string,
  env: NodeJS.ProcessEnv,
): CoffeeLspExtensionConfig {
  let config: CoffeeLspExtensionConfig = { ...DEFAULT_EXTENSION_CONFIG };
  for (const directory of [agentDirectory(env), workspace]) {
    const section = readSection(join(directory, "coffee-lsp.json"));
    if (section) config = applySection(config, section);
  }
  return applyEnvironment(config, env);
}

function readSection(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const section = parsed?.pi;
    return section && typeof section === "object" && !Array.isArray(section)
      ? (section as Record<string, unknown>)
      : undefined;
  } catch {
    // The CLI reports malformed project configuration when a server starts;
    // extension defaults must not depend on that file parsing.
    return undefined;
  }
}

function applySection(
  config: CoffeeLspExtensionConfig,
  section: Record<string, unknown>,
): CoffeeLspExtensionConfig {
  const next = { ...config };
  for (const key of [
    "autoDiagnostics",
    "reportClean",
    "includeWarnings",
    "prewarm",
  ] as const)
    if (typeof section[key] === "boolean") next[key] = section[key];
  for (const key of [
    "autoDiagnosticsTimeoutMs",
    "maxItems",
    "daemonIdleMs",
  ] as const) {
    const value = section[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
      next[key] = value;
  }
  return next;
}

function applyEnvironment(
  config: CoffeeLspExtensionConfig,
  env: NodeJS.ProcessEnv,
): CoffeeLspExtensionConfig {
  const next = { ...config };
  const auto = flag(env.PI_COFFEE_LSP_AUTO_DIAGNOSTICS);
  if (auto !== undefined) next.autoDiagnostics = auto;
  const prewarm = flag(env.PI_COFFEE_LSP_PREWARM);
  if (prewarm !== undefined) next.prewarm = prewarm;
  const clean = flag(env.PI_COFFEE_LSP_REPORT_CLEAN);
  if (clean !== undefined) next.reportClean = clean;
  const timeout = positive(env.PI_COFFEE_LSP_AUTO_TIMEOUT_MS);
  if (timeout !== undefined) next.autoDiagnosticsTimeoutMs = timeout;
  const idle = positive(env.PI_COFFEE_LSP_IDLE_MS);
  if (idle !== undefined) next.daemonIdleMs = idle;
  return next;
}

function flag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(value)) return true;
  if (["0", "false", "off", "no"].includes(value)) return false;
  return undefined;
}

function positive(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
