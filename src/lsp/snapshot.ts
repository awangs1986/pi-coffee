import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { BUILTIN_SERVERS } from "./registry.js";

export interface ProjectSnapshot {
  fingerprint: string;
  configuration: string;
  sources: Map<string, string>;
  /** The walk stopped at MAX_SNAPSHOT_ENTRIES; changes beyond that are invisible. */
  truncated: boolean;
}
export interface FileChange {
  path: string;
  type: 1 | 2 | 3;
}

/** Directory entries visited before change detection degrades instead of failing. */
export const MAX_SNAPSHOT_ENTRIES = 50_000;

/**
 * Directories that never hold project sources: dependencies, build output and
 * tool caches of the web frameworks, package managers and game engines this
 * package targets (Unity `Library/`, Unreal `Intermediate/`, Godot `.godot/`).
 * Plain names from the project root's `.gitignore` are skipped at the root too.
 */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "target",
  "bin",
  "obj",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".angular",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".output",
  ".vercel",
  ".netlify",
  ".expo",
  "storybook-static",
  "coverage",
  ".nyc_output",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
  ".idea",
  ".vs",
  ".vscode",
  ".gradle",
  ".dart_tool",
  ".zig-cache",
  "zig-out",
  "Pods",
  "DerivedData",
  "CMakeFiles",
  "Library",
  "Temp",
  "Logs",
  "Intermediate",
  "Saved",
  "DerivedDataCache",
  "Binaries",
  ".godot",
  ".import",
  ".mono",
]);

/**
 * Files whose change replaces a warm server: the root markers of the built-in
 * registry (tsconfig.json, package.json, Cargo.toml, go.mod, *.csproj,
 * project.godot, …) plus compiler databases. Lock files, data files and other
 * JSON/YAML/TOML are ordinary sources: they are watched, not restarted on.
 */
const CONFIGURATION_NAMES = new Set([
  ...Object.values(BUILTIN_SERVERS).flatMap((definition) =>
    definition.rootMarkers.filter((marker) => !marker.includes("*")),
  ),
  "coffee-lsp.json",
  "compile_commands.json",
  ".clangd",
  "rust-toolchain",
  "rust-toolchain.toml",
  "go.work",
]);
const CONFIGURATION_EXTENSIONS = new Set([
  ...Object.values(BUILTIN_SERVERS).flatMap((definition) =>
    definition.rootMarkers
      .filter((marker) => marker.startsWith("*."))
      .map((marker) => marker.slice(1).toLowerCase()),
  ),
  // MSBuild property sheets shape C# projects like the .csproj itself.
  ".props",
  ".targets",
]);
/** Extensions and exact names served by an enabled built-in server (plus C/C++ headers). */
const SOURCE_EXTENSIONS = new Set([
  ...Object.values(BUILTIN_SERVERS)
    .filter((definition) => !definition.disabled)
    .flatMap((definition) => definition.fileTypes)
    .filter((type) => type.startsWith("."))
    .map((type) => type.toLowerCase()),
  ".h",
  ".hpp",
  ".hh",
  ".hxx",
]);
const SOURCE_NAMES = new Set(
  Object.values(BUILTIN_SERVERS)
    .filter((definition) => !definition.disabled)
    .flatMap((definition) => definition.fileTypes)
    .filter((type) => !type.startsWith(".")),
);

export function projectFingerprint(root: string): string {
  return projectSnapshot(root).fingerprint;
}

function isConfiguration(name: string): boolean {
  return (
    CONFIGURATION_NAMES.has(name) ||
    CONFIGURATION_EXTENSIONS.has(extname(name).toLowerCase()) ||
    /^tsconfig\..+\.json$/i.test(name)
  );
}

function isSource(name: string): boolean {
  return (
    SOURCE_EXTENSIONS.has(extname(name).toLowerCase()) || SOURCE_NAMES.has(name)
  );
}

/** Plain directory or file names ignored by the project's own `.gitignore` (root patterns only). */
function gitignoredNames(root: string): Set<string> {
  const names = new Set<string>();
  let text: string;
  try {
    text = readFileSync(join(root, ".gitignore"), "utf8");
  } catch {
    return names;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const name = line.replace(/^\//, "").replace(/\/$/, "");
    // Only literal names; glob patterns and nested paths are left to git.
    if (name && !/[*?[\]\\/]/.test(name)) names.add(name);
  }
  return names;
}

// Bound disk traversal; source changes are incremental, configuration changes restart.
export function projectSnapshot(
  root: string,
  maxEntries = MAX_SNAPSHOT_ENTRIES,
): ProjectSnapshot {
  const hash = createHash("sha256"),
    configuration = createHash("sha256");
  const sources = new Map<string, string>();
  const rootIgnored = gitignoredNames(root);
  let count = 0;
  let truncated = false;
  const walk = (directory: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      // A removed directory contributes no current source files. In particular,
      // startup locks can disappear between listing a parent and walking it.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return;
      if (++count > maxEntries) {
        // Degrade instead of failing: queries still work, but changes past this
        // point are not detected. The CLI reports snapshot_truncated.
        truncated = true;
        return;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !IGNORED_DIRECTORIES.has(entry.name) &&
          !(depth === 0 && rootIgnored.has(entry.name))
        )
          walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const configurationFile = isConfiguration(entry.name);
      if (!configurationFile && !isSource(entry.name)) continue;
      let stat;
      try {
        stat = statSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const stamp = JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs]);
      hash.update(path + stamp);
      if (configurationFile) configuration.update(path + stamp);
      else sources.set(path, stamp);
    }
  };
  walk(root, 0);
  // clangd commonly keeps its compilation database in an otherwise ignored build tree.
  try {
    const stat = statSync(join(root, "build/compile_commands.json"));
    const stamp = JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs]);
    hash.update(stamp);
    configuration.update(stamp);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    fingerprint: hash.digest("hex"),
    configuration: configuration.digest("hex"),
    sources,
    truncated,
  };
}

export function sourceChanges(
  before: ProjectSnapshot,
  after: ProjectSnapshot,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, stamp] of after.sources) {
    if (!before.sources.has(path)) changes.push({ path, type: 1 });
    else if (before.sources.get(path) !== stamp)
      changes.push({ path, type: 2 });
  }
  for (const path of before.sources.keys())
    if (!after.sources.has(path)) changes.push({ path, type: 3 });
  return changes;
}
