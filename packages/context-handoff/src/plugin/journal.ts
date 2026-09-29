import {
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  renameSync,
  readFileSync,
  readSync,
  statSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { dirname, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { digest } from "./task-state.js";
export interface Journal {
  version: 1;
  session: string;
  summaryHash: string;
  phase: "prepared" | "installed";
  continuation: "none" | "claimed" | "settled";
}
function path(ctx: ExtensionContext) {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("Persistent Pi session required");
  const rel = relative(ctx.cwd, file);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    throw new Error("Session storage must be outside the workspace");
  return `${file}.handoff.json`;
}
export function load(ctx: ExtensionContext): Journal | undefined {
  const p = path(ctx);
  if (!existsSync(p)) return;
  const envelope = JSON.parse(readFileSync(p, "utf8")),
    v = envelope.record;
  if (
    !v ||
    envelope.hash !== digest(JSON.stringify(v)) ||
    v.version !== 1 ||
    v.session !== ctx.sessionManager.getSessionId() ||
    !["prepared", "installed"].includes(v.phase) ||
    !["none", "claimed", "settled"].includes(v.continuation)
  )
    throw new Error("Corrupt Handoff journal; recovery required");
  return v;
}
export function save(ctx: ExtensionContext, record: Journal) {
  const p = path(ctx),
    temp = `${p}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(
      fd,
      JSON.stringify({ record, hash: digest(JSON.stringify(record)) }) + "\n",
    );
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, p);
    fd = openSync(dirname(p), "r");
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function confirmCommit(ctx: ExtensionContext, summaryHash: string) {
  const file = ctx.sessionManager.getSessionFile()!;
  if (!hasCommit(ctx, summaryHash))
    throw new Error("Handoff commit is missing or changed; recovery required");
  const fd = openSync(file, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(dirname(file), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function historyFingerprint(ctx: ExtensionContext) {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("Persistent original history required");
  if (statSync(file).size > 8 * 1024 * 1024)
    throw new Error("History exceeds 8 MiB integrity budget");
  const content = readFileSync(file);
  if (content.length > 8 * 1024 * 1024)
    throw new Error("History exceeds 8 MiB integrity budget");
  return digest(content.toString("base64"));
}

// Pi writes each entry as one JSON line; compaction entries start with this key.
const COMPACTION_PREFIX = Buffer.from('{"type":"compaction"');
// A compaction line holds a bounded summary plus Pi's system message snapshot.
const MAX_COMPACTION_LINE = 8 * 1024 * 1024;
const CHUNK = 1024 * 1024;

/**
 * Confirm that a committed Handoff with this summary hash is on disk. The
 * session file itself is unbounded (it keeps growing after Handoff), so it is
 * streamed in fixed chunks: only lines starting with the compaction prefix are
 * buffered and parsed; other lines are skipped without retention. Torn or
 * malformed lines (for example a crash during append) are ignored, so they
 * cannot confirm a commit and cannot block confirmation of an earlier one.
 */
export function hasCommit(ctx: ExtensionContext, summaryHash: string) {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("Persistent original history required");
  const matches = (line: Buffer) => {
    try {
      const e = JSON.parse(line.toString("utf8"));
      return e.type === "compaction" && e.details?.plugin === "pi-handoff" &&
        typeof e.summary === "string" && digest(e.summary) === summaryHash;
    } catch {
      return false;
    }
  };
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(CHUNK);
    // "head": deciding a new line; "keep": buffering a compaction line; "skip": discarding.
    let mode: "head" | "keep" | "skip" = "head";
    let parts: Buffer[] = [];
    let size = 0;
    const take = (piece: Buffer) => {
      if (mode === "skip" || !piece.length) return;
      size += piece.length;
      if (size > MAX_COMPACTION_LINE) { mode = "skip"; parts = []; return; }
      parts.push(piece);
      if (mode === "head" && size >= COMPACTION_PREFIX.length) {
        const head = Buffer.concat(parts);
        parts = [head];
        mode = head.subarray(0, COMPACTION_PREFIX.length).equals(COMPACTION_PREFIX) ? "keep" : "skip";
        if (mode === "skip") parts = [];
      }
    };
    const endLine = () => {
      const found = mode === "keep" && matches(Buffer.concat(parts));
      mode = "head"; parts = []; size = 0;
      return found;
    };
    for (let read; (read = readSync(fd, chunk, 0, CHUNK, null)) > 0; ) {
      let start = 0;
      for (let nl; (nl = chunk.indexOf(10, start)) !== -1 && nl < read; start = nl + 1) {
        take(chunk.subarray(start, nl));
        if (endLine()) return true;
      }
      take(Buffer.from(chunk.subarray(start, read)));
    }
    return endLine();
  } finally {
    closeSync(fd);
  }
}
