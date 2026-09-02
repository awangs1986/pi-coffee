import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const resolvePackage = createRequire(import.meta.url).resolve;

/**
 * Resolve the native extension entries loaded by every Agent Host session.
 *
 * `PI_COFFEE_EXTENSIONS` is an explicit replacement list. With no override,
 * PI Coffee loads its Harness, the pinned upstream pi-subagents entry, its
 * resource Adapter, and context-fold. context-fold is deliberately last:
 * Pi keeps the last non-empty `session_before_compact` result, so its
 * deterministic summary wins over any companion extension. If context-fold
 * cannot produce a result it returns void, which leaves Pi's native
 * compaction path as the fail-open fallback.
 *
 * pi-lens is installed as an opt-in, non-visible integration. It is not added
 * to the default list and therefore does not initialize LSP/diagnostic work or
 * expose any tools unless `PI_COFFEE_PI_LENS=on` is explicitly set.
 * rpiv-todo is likewise opt-in: its todo tool, `/todos` command, and overlay
 * are not initialized unless `PI_COFFEE_RPIV_TODO=on` is explicitly set.
 */
export function resolvePiExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.PI_COFFEE_EXTENSIONS?.trim();
  if (configured === "off") return [];
  if (configured !== undefined && configured.length > 0) {
    return configured.split(delimiter).map((value) => value.trim()).filter((value) => value.length > 0);
  }

  const harness = resolveHarnessExtension();
  const extensions = [harness];
  if (!isDisabled(env.PI_COFFEE_SUBAGENTS)) {
    extensions.push(resolvePiSubagentsExtension(), resolvePiSubagentsResourceExtension());
  }
  if (isEnabled(env.PI_COFFEE_PI_LENS)) extensions.push(resolvePiLensExtension(env));
  if (isEnabled(env.PI_COFFEE_RPIV_TODO)) extensions.push(resolveRpivTodoExtension(env));
  if (!isDisabled(env.PI_COFFEE_CONTEXT_FOLD)) extensions.push(resolveContextFoldExtension(env));
  return extensions;
}

export function resolveHarnessExtension(): string {
  return join(moduleDirectory, "harness", "extension.js");
}

/** Resolve the official package entry; Pi's loader handles its TypeScript source. */
export function resolvePiSubagentsExtension(): string {
  return resolvePackage("pi-subagents");
}

export function resolvePiSubagentsResourceExtension(): string {
  return join(moduleDirectory, "subagents", "extension.js");
}

/** Resolve context-fold's native Pi package entry; Pi loads its TypeScript source through jiti. */
export function resolveContextFoldExtension(env: NodeJS.ProcessEnv = process.env): string {
  // context-fold intentionally ships only a Pi manifest (no Node `main` or
  // `exports` entry), so resolve the manifest's declared TypeScript entry
  // explicitly. Pi's loader then transpiles it through jiti.
  // Prefer the Agent Host's Pi-managed copy when present. Pi auto-discovers
  // that path before explicit `--extension` entries; using the same path lets
  // Pi's canonical-path de-duplicator load it exactly once.
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "context-fold", "index.ts");
  if (existsSync(managedEntry)) return managedEntry;
  return resolvePackage("context-fold/index.ts");
}

/** Resolve the optional pi-lens native extension without loading it by default. */
export function resolvePiLensExtension(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "pi-lens", "dist", "index.js");
  if (existsSync(managedEntry)) return managedEntry;
  return resolvePackage("pi-lens");
}

/** Resolve the optional rpiv-todo native Pi extension without loading it by default. */
export function resolveRpivTodoExtension(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "@juicesharp", "rpiv-todo", "index.ts");
  if (existsSync(managedEntry)) return managedEntry;
  return resolvePackage("@juicesharp/rpiv-todo/index.ts");
}

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
