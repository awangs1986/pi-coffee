import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LspServerSpec } from "./client.js";
import {
  BUILTIN_SERVERS,
  configDirectories,
  findTypeScriptInstallation,
  findTypeScriptSdk,
  hasRootMarkers,
  isNativeTsc,
  loadServerRegistry,
  managedNpmPrefix,
  matchesFileType,
  overrideVariable,
  resolveExecutable,
  type ServerDefinition,
  type ServerRegistry,
} from "./registry.js";

const requireFromHere = createRequire(import.meta.url);

export type ServerSource =
  "override" | "bundled" | "project" | "managed" | "path" | "tcp" | "missing";

export interface LspProfileResolution {
  id: string;
  available: boolean;
  command?: string;
  args?: string[];
  /** Connect instead of spawn (Godot's editor server). */
  tcp?: { host: string; port: number };
  allowVersionlessDiagnostics?: boolean;
  reason?: string;
  /** Where the executable came from. */
  source?: ServerSource;
  /** Linters report diagnostics only; navigation is not expected to work. */
  role?: "language" | "linter";
  definition?: ServerDefinition;
}

/** Registry visible from a project: built-ins plus every applicable `coffee-lsp.json`. */
export function registryFor(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  workspace = projectRoot,
): ServerRegistry {
  return loadServerRegistry({
    configDirectories: configDirectories(projectRoot, workspace, env),
  });
}

/**
 * Which TypeScript entry serves a project: the project's own TypeScript decides
 * (5.x → typescript-language-server, 7+ → native `tsc --lsp`); without one,
 * typescript-language-server is used when it can reach a TypeScript 5 (bundled
 * next to it or installed with `coffee-lsp install typescript`), otherwise a
 * managed or PATH-provided native `tsc`.
 */
export function typeScriptFlavour(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): "typescript" | "typescript-native" {
  const installation = findTypeScriptInstallation(projectRoot);
  if (installation)
    return installation.native ? "typescript-native" : "typescript";
  if (tsserverReachable(env)) return "typescript";
  const tsc = resolveExecutable("tsc", projectRoot, env);
  return tsc && isNativeTsc(tsc.command) ? "typescript-native" : "typescript";
}

function tsserverReachable(env: NodeJS.ProcessEnv): boolean {
  if (managedTypeScriptSdk(env)) return true;
  try {
    requireFromHere.resolve("typescript/lib/tsserver.js");
    return true;
  } catch {
    return false;
  }
}

/** Enabled servers that list this file, in registry order, with the TypeScript flavour resolved. */
export function candidateServers(
  path: string,
  registry: ServerRegistry,
  projectRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): Array<[string, ServerDefinition]> {
  const candidates = Object.entries(registry).filter(
    ([, definition]) =>
      !definition.disabled && matchesFileType(definition, path),
  );
  const flavours = candidates.filter(
    ([id]) => id === "typescript" || id === "typescript-native",
  );
  if (flavours.length < 2 || !projectRoot) return candidates;
  const chosen = typeScriptFlavour(projectRoot, env);
  return candidates.filter(
    ([id]) =>
      (id !== "typescript" && id !== "typescript-native") || id === chosen,
  );
}

/**
 * Root markers that may define this file's project: markers of primary servers
 * first; linters only when nothing else covers the file.
 */
export function projectMarkersFor(
  path: string,
  registry: ServerRegistry,
): string[] {
  const candidates = candidateServers(path, registry);
  const primary = candidates.filter(([, definition]) => !definition.isLinter);
  const pool = primary.length ? primary : candidates;
  return [...new Set(pool.flatMap(([, definition]) => definition.rootMarkers))];
}

export function resolveProfile(
  path: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  workspace = cwd,
): LspProfileResolution {
  const registry = registryFor(cwd, env, workspace);
  const candidates = candidateServers(path, registry, cwd, env);
  if (candidates.length === 0)
    return {
      id: "unknown",
      available: false,
      reason: `unsupported language: ${path.includes(".") ? path.slice(path.lastIndexOf(".")) : "no extension"}. Run coffee-lsp servers for the registry, or add a servers entry to coffee-lsp.json.`,
    };
  const ranked = candidates
    .map(([id, definition], order) => ({
      id,
      definition,
      order,
      marked: hasRootMarkers(cwd, definition.rootMarkers) ? 0 : 1,
      linter: definition.isLinter ? 1 : 0,
    }))
    // One server per file: language servers first (they carry navigation),
    // then whichever has its markers at the project root, then registry order.
    // Linters are only used when no language server covers the file type.
    .sort(
      (a, b) => a.linter - b.linter || a.marked - b.marked || a.order - b.order,
    );
  let first: LspProfileResolution | undefined;
  for (const candidate of ranked) {
    const profile = resolveServer(candidate.id, candidate.definition, cwd, env);
    if (profile.available) return profile;
    first ??= profile;
  }
  return first!;
}

/** Resolve one registry entry to a launchable command without choosing between servers. */
export function resolveServer(
  id: string,
  definition: ServerDefinition,
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): LspProfileResolution {
  const base: LspProfileResolution = {
    id,
    available: false,
    definition,
    role: definition.isLinter ? "linter" : "language",
    allowVersionlessDiagnostics: definition.allowVersionlessDiagnostics,
  };
  const override = env[overrideVariable(id)];
  if (override) {
    const [command, ...args] = parseOverride(override);
    return existsSync(command)
      ? {
          ...base,
          available: true,
          command,
          args,
          source: "override",
          // Fixture servers for the TypeScript profile publish versionless
          // diagnostics in some scenarios; keep the historical allowance.
          allowVersionlessDiagnostics:
            definition.allowVersionlessDiagnostics || id === "typescript",
        }
      : { ...base, reason: `configured server does not exist: ${command}` };
  }
  if (definition.transport === "tcp") {
    // Nothing to install or resolve; the connection is attempted on first use
    // and `status` probes the port.
    const host = definition.host ?? "127.0.0.1";
    const port = definition.port ?? 0;
    return {
      ...base,
      available: true,
      command: `tcp://${host}:${port}`,
      args: [],
      tcp: { host, port },
      source: "tcp",
      allowVersionlessDiagnostics: true,
    };
  }
  if (definition.command.startsWith("node:")) {
    try {
      const entry = requireFromHere.resolve(
        definition.command.slice("node:".length),
      );
      return {
        ...base,
        available: true,
        command: process.execPath,
        args: [entry, ...(definition.args ?? [])],
        source: "bundled",
      };
    } catch {
      return {
        ...base,
        reason: `${id} language server is not installed (${definition.install ?? "reinstall pi-coffee-lsp"})`,
      };
    }
  }
  const resolved = resolveExecutable(definition.command, projectRoot, env);
  if (!resolved)
    return {
      ...base,
      reason: [
        `${definition.command} is not installed for ${definition.language}.`,
        definition.install ? `Install: ${definition.install}.` : "",
        `Or set ${overrideVariable(id)} to a JSON argv array.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  return {
    ...base,
    available: true,
    command: resolved.command,
    args: [...(definition.args ?? [])],
    source: resolved.source,
  };
}

function parseOverride(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string")
    )
      return parsed;
  } catch {
    /* fall through to the NUL-separated form used by in-process tests */
  }
  return raw.split("\0");
}

export interface ServerListing {
  id: string;
  language: string;
  fileTypes: string[];
  status: "available" | "missing" | "disabled";
  /** Resolved executable when available, otherwise the registry command name. */
  command: string;
  source?: ServerSource;
  role?: "linter";
  install?: string;
  /** Present for entries that come from a coffee-lsp.json rather than the built-in registry. */
  configured?: true;
  /** Why an installed server is still not used (for example a TypeScript flavour mismatch). */
  note?: string;
}

/** Every registry entry with its resolution from `projectRoot`, for `coffee-lsp servers`. */
export function listServers(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  workspace = projectRoot,
): ServerListing[] {
  const registry = registryFor(projectRoot, env, workspace);
  const flavour = typeScriptFlavour(projectRoot, env);
  return Object.entries(registry).map(([id, definition]) => {
    const profile = definition.disabled
      ? undefined
      : resolveServer(id, definition, projectRoot, env);
    // Only one TypeScript flavour serves a project; the other is listed with a note.
    const nativeMismatch =
      profile?.available &&
      (id === "typescript" || id === "typescript-native") &&
      id !== flavour;
    const available = Boolean(profile?.available) && !nativeMismatch;
    return {
      id,
      language: definition.language,
      fileTypes: definition.fileTypes,
      status: definition.disabled
        ? "disabled"
        : available
          ? "available"
          : "missing",
      command: available
        ? profile!.command!
        : definition.command.startsWith("node:")
          ? `bundled ${definition.command.slice("node:".length)}`
          : definition.command,
      ...(available ? { source: profile!.source } : {}),
      ...(definition.isLinter ? { role: "linter" as const } : {}),
      ...(!available && !definition.disabled && definition.install
        ? { install: definition.install }
        : {}),
      ...(id in BUILTIN_SERVERS ? {} : { configured: true as const }),
      ...(nativeMismatch
        ? {
            note:
              flavour === "typescript"
                ? "not selected: this project uses typescript-language-server (TypeScript 5 tsserver)"
                : "not selected: this project uses the native TypeScript 7 tsc --lsp",
          }
        : available && profile!.source === "tcp"
          ? { note: "connects to a running server; not probed here" }
          : {}),
    };
  });
}

export function toServerSpec(
  profile: LspProfileResolution,
  cwd: string,
  env: NodeJS.ProcessEnv,
): LspServerSpec {
  if (!profile.available || !profile.command)
    throw new Error(profile.reason ?? "language server unavailable");
  // Command overrides configure this adapter and may use an in-process NUL
  // separator in tests. They are not language-server configuration and must
  // never be forwarded to spawn(), whose environment rejects NUL bytes.
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv))
    if (/^PI_COFFEE_.*_LSP_COMMAND$/.test(key)) delete childEnv[key];
  let settings: Record<string, unknown> = {
    ...(profile.definition?.settings ?? {}),
  };
  let initializationOptions: Record<string, unknown> = {
    ...(profile.definition?.initializationOptions ?? {}),
  };
  // Legacy per-profile section (`{"typescript": {"settings": ...}}`) in the
  // project root keeps working and takes precedence over registry defaults.
  const configuration = resolve(cwd, "coffee-lsp.json");
  if (existsSync(configuration)) {
    if (statSync(configuration).size > 65536)
      throw new Error("coffee-lsp.json exceeds 64 KiB");
    const configured =
      JSON.parse(readFileSync(configuration, "utf8"))[profile.id] ?? {};
    for (const key of ["settings", "initializationOptions"])
      if (
        configured[key] !== undefined &&
        (!configured[key] ||
          typeof configured[key] !== "object" ||
          Array.isArray(configured[key]))
      )
        throw new Error(`Invalid ${key} in coffee-lsp.json`);
    if (configured.settings) settings = { ...settings, ...configured.settings };
    if (configured.initializationOptions)
      initializationOptions = {
        ...initializationOptions,
        ...configured.initializationOptions,
      };
  }
  const substitutions: Record<string, string | undefined> = {
    "${pid}": String(process.pid),
    "${tsdk}": findTypeScriptSdk(cwd),
    "${root}": resolve(cwd),
    "${rootUri}": pathToFileURL(resolve(cwd)).href,
    "${rootName}": basename(resolve(cwd)) || "workspace",
    "${managedTsdk}": managedTypeScriptSdk(env),
  };
  return {
    settings: substitute(settings, substitutions) as Record<string, unknown>,
    initializationOptions: substitute(
      initializationOptions,
      substitutions,
    ) as Record<string, unknown>,
    id: profile.id,
    command: profile.command,
    args: (profile.args ?? []).map(
      (arg) => substituteString(arg, substitutions) ?? arg,
    ),
    cwd: resolve(cwd),
    env: childEnv,
    allowVersionlessDiagnostics: profile.allowVersionlessDiagnostics,
    languageId: profile.definition?.languageId,
    ...(profile.tcp ? { tcp: profile.tcp } : {}),
  };
}

/** `lib` directory of a TypeScript installed into the managed prefix, if any. */
function managedTypeScriptSdk(env: NodeJS.ProcessEnv): string | undefined {
  const lib = resolve(
    managedNpmPrefix(env),
    "node_modules",
    "typescript",
    "lib",
  );
  return existsSync(resolve(lib, "tsserver.js")) ? lib : undefined;
}

function substituteString(
  value: string,
  substitutions: Record<string, string | undefined>,
): string | undefined {
  let result = value;
  for (const [token, replacement] of Object.entries(substitutions)) {
    if (!result.includes(token)) continue;
    if (replacement === undefined) return undefined;
    result = result.split(token).join(replacement);
  }
  return result;
}

/** Replace `${...}` tokens; entries whose replacement is unknown are dropped. */
function substitute(
  value: unknown,
  substitutions: Record<string, string | undefined>,
): unknown {
  if (typeof value === "string") return substituteString(value, substitutions);
  if (Array.isArray(value))
    return value
      .map((entry) => substitute(entry, substitutions))
      .filter((entry) => entry !== undefined);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const replaced = substitute(entry, substitutions);
      if (replaced !== undefined) result[key] = replaced;
    }
    return result;
  }
  return value;
}
