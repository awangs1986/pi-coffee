import { readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface ProjectSnapshot {
  fingerprint: string;
  configuration: string;
  sources: Map<string, string>;
}
export interface FileChange {
  path: string;
  type: 1 | 2 | 3;
}

export function projectFingerprint(root: string): string {
  return projectSnapshot(root).fingerprint;
}

// Bound disk traversal; source changes are incremental, configuration changes restart.
export function projectSnapshot(root: string): ProjectSnapshot {
  const hash = createHash("sha256"),
    configuration = createHash("sha256");
  const sources = new Map<string, string>();
  let count = 0;
  const ignored = new Set([
    ".git",
    "node_modules",
    "target",
    "bin",
    "obj",
    ".venv",
    "__pycache__",
    "dist",
    "build",
  ]);
  const walk = (directory: string) => {
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
      if (++count > 20000)
        throw new Error(
          "Project snapshot exceeds 20000 entries; select a narrower --workspace/project root.",
        );
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) walk(path);
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(ts|tsx|js|jsx|mjs|cjs|py|cs|csproj|sln|slnx|json|toml|rs|go|mod|sum|work|c|h|cc|cpp|cxx|hpp|hh|hxx|yaml|yml|props|targets)$|(^|\/)(\.clangd|CMakeLists.txt|rust-toolchain)$/i.test(
          path,
        )
      )
        continue;
      let stat;
      try {
        stat = statSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const stamp = JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs]);
      hash.update(path + stamp);
      if (
        /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|rs|go|c|h|cc|cpp|cxx|hpp|hh|hxx)$/i.test(
          path,
        )
      )
        sources.set(path, stamp);
      else configuration.update(path + stamp);
    }
  };
  walk(root);
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
