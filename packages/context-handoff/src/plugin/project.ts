import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { bytes, digest, type Source } from "./task-state.js";

// Budgets: inline observation text is bounded; workspace size never blocks Handoff.
const INVENTORY_PATHS = 1024; // full per-file fingerprint up to this many paths
const HASH_BYTES = 8 * 1024 * 1024; // content hashing budget for the fingerprint
const INLINE_FILE = 8192; // largest file admitted as inline text
const INLINE_TOTAL = 32768; // all project observation sources together
const LIST_BYTES = 2048; // path listings inside the inventory source

const within = (cwd: string, path: string) => {
  const rel = relative(cwd, resolve(cwd, path));
  return !rel.startsWith("..") && !isAbsolute(rel) ? rel : undefined;
};

function walk(cwd: string, limit: number) {
  // Non-Git fallback: bounded breadth-first inventory; never follows symlinks.
  const out: string[] = [];
  const queue = [""];
  while (queue.length && out.length <= limit) {
    const dir = queue.shift()!;
    let names: string[];
    try {
      names = readdirSync(join(cwd, dir)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === ".git" || name === "node_modules") continue;
      const path = dir ? `${dir}/${name}` : name;
      let stat;
      try {
        stat = lstatSync(join(cwd, path));
      } catch {
        continue;
      }
      if (stat.isDirectory()) queue.push(path);
      else out.push(path);
      if (out.length > limit) break;
    }
  }
  return { paths: out.slice(0, limit), complete: out.length <= limit && !queue.length };
}

function listing(title: string, items: string[]) {
  let text = `${title} (${items.length}):`;
  let shown = 0;
  for (const item of items) {
    if (bytes(text) + bytes(item) + 3 > LIST_BYTES) break;
    text += `\n- ${item}`;
    shown++;
  }
  if (shown < items.length) text += `\n- … ${items.length - shown} more not listed`;
  return text;
}

/**
 * Read-only project observation.
 * `hints` are original conversation texts (oldest first); paths mentioned there
 * are preferred for inline text. The fingerprint is independent of hints.
 */
export function projectSnapshot(cwd: string, hints: readonly string[] = []) {
  const git = (args: string[], maxBuffer = 16 * 1024 * 1024) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
  let revision = "unversioned",
    paths: string[],
    versioned = true,
    inventoryComplete = true;
  try {
    paths = git(["ls-files", "-co", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);
    try {
      revision = git(["rev-parse", "HEAD"]).trim();
    } catch {
      revision = "unborn";
    }
  } catch {
    versioned = false;
    const walked = walk(cwd, INVENTORY_PATHS * 4);
    paths = walked.paths;
    inventoryComplete = walked.complete;
  }
  paths = [...new Set(paths)].filter((p) => within(cwd, p) !== undefined).sort();
  const large = paths.length > INVENTORY_PATHS;

  // Fingerprint: detects checkout changes during preparation.
  const records: string[] = [`revision:${revision}`];
  let hashed = 0;
  const fileRecord = (path: string) => {
    let stat;
    try {
      stat = lstatSync(resolve(cwd, path));
    } catch {
      return `${path}:missing`;
    }
    if (stat.isSymbolicLink()) return `${path}:symlink:unverified`;
    if (!stat.isFile()) return `${path}:other`;
    if (hashed + stat.size <= HASH_BYTES) {
      hashed += stat.size;
      return `${path}:${digest(readFileSync(resolve(cwd, path)).toString("base64"))}`;
    }
    // Beyond the hashing budget, fall back to cheaper metadata.
    return `${path}:stat:${stat.size}:${stat.mtimeMs}`;
  };
  let dirty: string[] = [];
  let fingerprintScope: string;
  if (!large) {
    for (const path of paths) records.push(fileRecord(path));
    fingerprintScope = "All inventory files (content hash within 8 MiB, size/mtime beyond).";
  } else if (versioned) {
    // Large repository: unchanged tracked files are identified by HEAD; only
    // modified and untracked paths are hashed individually.
    let status = "";
    try {
      status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    } catch {
      status = "unavailable";
    }
    records.push(`status:${digest(status)}`);
    dirty = status === "unavailable" ? [] : status
      .split("\0")
      .filter(Boolean)
      .map((line) => line.slice(3))
      .filter((p) => p && within(cwd, p) !== undefined);
    for (const path of dirty.slice(0, INVENTORY_PATHS)) records.push(fileRecord(path));
    fingerprintScope = status === "unavailable"
      ? "Git HEAD only; working-tree status unavailable (unverified)."
      : `Git HEAD + working-tree status; ${Math.min(dirty.length, INVENTORY_PATHS)} changed/untracked files hashed.`;
  } else {
    for (const path of paths) {
      try {
        const stat = lstatSync(resolve(cwd, path));
        records.push(`${path}:stat:${stat.size}:${stat.mtimeMs}`);
      } catch {
        records.push(`${path}:missing`);
      }
    }
    fingerprintScope = "File metadata only (unversioned large workspace).";
  }
  if (!inventoryComplete) fingerprintScope += " Inventory is partial; unlisted files are unverified.";

  // Inline selection: most recently mentioned paths first, then recently
  // modified files (changed/untracked only in large repositories).
  const known = new Set(paths);
  const mentioned = new Map<string, number>();
  hints.forEach((text, index) => {
    for (const token of text.match(/[\w./@+-]+/g) ?? []) {
      const candidate = token.replace(/^\.\//, "").replace(/[.,:;]+$/, "");
      const rel = isAbsolute(candidate) ? within(cwd, candidate) : candidate;
      if (rel && known.has(rel)) mentioned.set(rel, index);
    }
  });
  const byMention = [...mentioned].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  // Large repositories: only changed/untracked files compete after mentions.
  const rest = (large ? dirty.filter((p) => known.has(p)) : paths)
        .filter((p) => !mentioned.has(p))
        .map((p) => {
          try {
            const stat = lstatSync(resolve(cwd, p));
            return { p, mtime: stat.isFile() ? stat.mtimeMs : -1 };
          } catch {
            return { p, mtime: -1 };
          }
        })
        .filter((x) => x.mtime >= 0)
        .sort((a, b) => b.mtime - a.mtime || a.p.localeCompare(b.p))
        .map((x) => x.p);

  const inline: Source[] = [];
  const observedAt = new Date().toISOString();
  const reserve = LIST_BYTES * 2 + 1024; // inventory source
  for (const path of [...byMention, ...rest]) {
    const absolute = resolve(cwd, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    let data: Buffer | undefined;
    if (stat.size <= INLINE_FILE) {
      try {
        data = readFileSync(absolute);
      } catch {
        data = undefined;
      }
    }
    const textual = data && !data.includes(0);
    const hash = data ? digest(data.toString("base64")) : "not hashed (large file)";
    const text =
      `Path: ${path}\nRevision: ${revision}\nSHA256(base64): ${hash}\n` +
      (textual
        ? data!.toString("utf8")
        : "[Content omitted; read original before relying on it]");
    const source: Source = {
      id: `project:${path}`,
      role: "project-observation",
      text,
      hash: digest(text),
      timestamp: new Date(stat.mtimeMs).toISOString(),
    };
    if (bytes(inline) + bytes(source) + reserve > INLINE_TOTAL) continue;
    inline.push(source);
  }
  const inlined = new Set(inline.map((s) => s.id.slice("project:".length)));
  const notInlined = large
    ? byMention.filter((p) => !inlined.has(p))
    : paths.filter((p) => !inlined.has(p));
  const inventoryText = [
    `Project inventory. Revision: ${revision}`,
    `Files: ${paths.length}${inventoryComplete ? "" : "+ (partial inventory)"}; inline: ${inline.length}.`,
    `Fingerprint scope: ${fingerprintScope}`,
    "Files without inline text are unverified here; read them from the current workspace before relying on them.",
    dirty.length ? listing("Changed/untracked (git status)", dirty) : "",
    notInlined.length ? listing(large ? "Mentioned but not inline" : "Not inline", notInlined) : "",
  ].filter(Boolean).join("\n");
  const inventory: Source = {
    id: "project:inventory",
    role: "project-observation",
    text: inventoryText,
    hash: digest(inventoryText),
    timestamp: observedAt,
  };
  const sources = [inventory, ...inline];
  return {
    revision,
    fingerprint: digest(JSON.stringify(records)),
    sources,
    inventory: {
      files: paths.length,
      complete: inventoryComplete,
      inline: inline.length,
      notInline: notInlined.length,
      scope: fingerprintScope,
    },
    observedAt,
    verification:
      "Read-only snapshot; historical test passes are not verification of the current checkout. No tests or side effects executed.",
  };
}
