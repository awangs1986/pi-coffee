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
 * `PI_COFFEE_EXTENSIONS` replaces optional capabilities; the context guard
 * remains mandatory, including when the value is `off`. With no override,
 * PI Coffee loads its local Web adapter, Harness, the pinned upstream
 * pi-subagents entry, the Web compatibility entry, its resource Adapter, and
 * context-fold's read-only legacy recall adapter. Native Pi compaction owns
 * Chat and Work; the default-off candidate requests rollover through the Host adapter.
 *
 * pi-lens is an optional, user-managed, non-visible integration. It is not added
 * to the default list and therefore does not initialize LSP/diagnostic work or
 * expose any tools unless `PI_COFFEE_PI_LENS=on` is explicitly set.
 * rpiv-todo is likewise opt-in: its todo tool, `/todos` command, and overlay
 * are not initialized unless `PI_COFFEE_RPIV_TODO=on` is explicitly set.
 * pi-mcp-adapter is also opt-in: its MCP proxy tool and server runtime stay
 * unloaded unless `PI_COFFEE_PI_MCP_ADAPTER=on` is explicitly set.
 */
export function resolvePiExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.PI_COFFEE_EXTENSIONS?.trim();
  if (configured === "off") return [resolveContextGuardExtension()];
  if (configured !== undefined && configured.length > 0) {
    return [...new Set([...configured.split(delimiter).map((value) => value.trim()).filter((value) => value.length > 0 && value !== resolveContextGuardExtension()), resolveContextGuardExtension()])];
  }

  const harness = resolveHarnessExtension();
  const extensions = isDisabled(env.PI_COFFEE_WEB)
    ? []
    : [resolveWebExtension()];
  if (!isDisabled(env.PI_COFFEE_SUBAGENTS)) {
    extensions.push(resolvePiSubagentsExtension());
  }
  if (!isDisabled(env.PI_COFFEE_WEB_ACCESS)) extensions.push(resolvePiWebAccessExtension());
  if (!isDisabled(env.PI_COFFEE_SUBAGENTS)) extensions.push(resolvePiSubagentsResourceExtension());
  if (isEnabled(env.PI_COFFEE_PI_LENS)) extensions.push(resolvePiLensExtension(env));
  if (isEnabled(env.PI_COFFEE_RPIV_TODO)) extensions.push(resolveRpivTodoExtension(env));
  if (isEnabled(env.PI_COFFEE_PI_MCP_ADAPTER)) extensions.push(resolvePiMcpAdapterExtension(env));
  if (!isDisabled(env.PI_COFFEE_CONTEXT_FOLD)) extensions.push(resolveContextFoldExtension(env));
  if (env.PI_COFFEE_HANDOFF_CANDIDATE === "on") extensions.push(join(moduleDirectory, "context", "handoff-extension.js"));
  extensions.push(harness);
  extensions.push(resolveContextGuardExtension());
  // Observe the final payload after the Harness has removed Chat system fields.
  extensions.push(resolveContextUsageExtension());
  return extensions;
}

export function resolveHarnessExtension(): string {
  return join(moduleDirectory, "harness", "extension.js");
}

export function resolveWebExtension(): string {
  return join(moduleDirectory, "extensions", "web-access", "extension.js");
}

/** Resolve the official package entry; Pi's loader handles its TypeScript source. */
export function resolvePiSubagentsExtension(): string {
  return join(moduleDirectory, "subagents", "native-adapter.js");
}

/** Resolve the compatibility entry; source extraction is owned by the local Web extension. */
export function resolvePiWebAccessExtension(): string {
  return join(moduleDirectory, "extensions", "web-access", "pi-web-access-adapter.js");
}

export function resolvePiWebAccessPackage(): string {
  return resolvePackage("pi-web-access/index.ts");
}

export function resolvePiSubagentsResourceExtension(): string {
  return join(moduleDirectory, "subagents", "extension.js");
}

/** Resolve context-fold's native Pi package entry; Pi loads its TypeScript source through jiti. */
export function resolveContextFoldExtension(_env: NodeJS.ProcessEnv = process.env): string {
  return join(moduleDirectory, "context", "extension.js");
}

export function resolveContextFoldPackage(env: NodeJS.ProcessEnv = process.env): string {
  // Use the tested lockfile version; user-managed copies must not silently replace recovery semantics.
  return resolvePackage("context-fold/index.ts");
}

/** Resolve the optional pi-lens native extension without loading it by default. */
export function resolvePiLensExtension(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "pi-lens", "dist", "index.js");
  if (existsSync(managedEntry)) return managedEntry;
  try {
    return resolvePackage("pi-lens");
  } catch {
    throw new Error("PI_COFFEE_PI_LENS=on requires a separately installed, Pi-compatible pi-lens package");
  }
}

/** Resolve the optional rpiv-todo native Pi extension without loading it by default. */
export function resolveRpivTodoExtension(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "@juicesharp", "rpiv-todo", "index.ts");
  if (existsSync(managedEntry)) return managedEntry;
  return resolvePackage("@juicesharp/rpiv-todo/index.ts");
}

/** Resolve the optional pi-mcp-adapter native Pi extension without loading it by default. */
export function resolvePiMcpAdapterExtension(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_COFFEE_AGENT_DIR ?? env.PI_CODING_AGENT_DIR ?? getAgentDir();
  const managedEntry = join(agentDir, "npm", "node_modules", "pi-mcp-adapter", "index.ts");
  if (existsSync(managedEntry)) return managedEntry;
  return resolvePackage("pi-mcp-adapter");
}

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Read-only observer, after all payload-changing extensions. */
export function resolveContextUsageExtension(): string { return join(moduleDirectory,"context","usage-extension.js"); }

/** Mandatory Pi request/output limits, independent of context-fold. */
export function resolveContextGuardExtension(): string { return join(moduleDirectory, "context", "guard-extension.js"); }
