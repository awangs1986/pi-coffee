import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { LspClient, hoverText, normalizeDiagnostic, normalizeDocumentSymbols, normalizeLocation } from "./client.js";
import { resolveProfile, toServerSpec, type LspProfileResolution } from "./profiles.js";
import { requestLspDaemon } from "./transport.js";

export interface CoffeeLspIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout(text: string): void;
  stderr(text: string): void;
  clientPool?: CoffeeLspClientPool;
}

export interface CoffeeLspClientPool {
  acquire(profile: LspProfileResolution, workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<LspClient>;
  invalidate(client: LspClient): Promise<void>;
}

const OPERATIONS = ["status", "symbols", "definition", "references", "hover", "diagnostics"] as const;
type Operation = typeof OPERATIONS[number];

export async function runCoffeeLsp(args: string[], io: CoffeeLspIo): Promise<number> {
  if (args.includes("--version") || args.includes("-v")) { io.stdout("coffee-lsp 0.1.0\n"); return 0; }
  if (shouldUseDaemon(args)) {
    try { return await requestLspDaemon(args, io); }
    catch (error) { return emitError(io, args[0] ?? "unknown", "daemon_failed", message(error), 5); }
  }
  let parsed: ReturnType<typeof parseArgs>;
  try { parsed = parseArgs(args, io.cwd); }
  catch (error) { return emitError(io, "unknown", "invalid_arguments", message(error), 2); }
  if (parsed.help) { io.stdout(helpText()); return 0; }
  const primary = parsed.files[0];
  if (!primary || !existsSync(primary)) return emitError(io, parsed.operation, "invalid_arguments", "--file must name an existing file", 2);
  try { parsed.projectRoot = findProjectRoot(primary, parsed.workspace, parsed.workspaceExplicit); }
  catch (error) { return emitError(io, parsed.operation, "invalid_arguments", message(error), 2, parsed.workspace); }
  if (parsed.expectSha256 && fileSha256(primary) !== parsed.expectSha256) {
    return emitError(io, parsed.operation, "stale_position", "The file changed since this position was obtained; rerun symbols or read the current file.", 4, parsed.projectRoot);
  }
  const profile = resolveProfile(primary, parsed.projectRoot, io.env);
  if (parsed.operation === "status") {
    return emit(io, {
      schemaVersion: 1, operation: "status", status: profile.available ? "ok" : "unavailable",
      workspace: parsed.workspace, projectRoot: parsed.projectRoot,
      server: { id: profile.id, state: profile.available ? "available" : "unavailable", ...(profile.command ? { command: profile.command } : {}) },
      capabilities: ["symbols", "definition", "references", "hover", "diagnostics"],
      issues: profile.available ? [] : [{ code: "missing_server", message: profile.reason }],
    }, profile.available ? 0 : 3);
  }
  if (!profile.available) return emitError(io, parsed.operation, "missing_server", profile.reason ?? "language server unavailable", 3, parsed.workspace, profile.id);
  let client: LspClient | undefined;
  try {
    client = io.clientPool
      ? await io.clientPool.acquire(profile, parsed.projectRoot, io.env, parsed.timeoutMs)
      : await LspClient.start(toServerSpec(profile, parsed.projectRoot, io.env), parsed.timeoutMs);
    const result = await execute(parsed, client, profile.id);
    return emit(io, result.envelope, result.code);
  } catch (error) {
    if (client && io.clientPool) await io.clientPool.invalidate(client);
    const detail = message(error);
    const timeout = /timed out/i.test(detail);
    return emitError(io, parsed.operation, timeout ? "request_timeout" : "server_failed", detail, timeout ? 4 : 5, parsed.projectRoot, profile.id);
  } finally {
    if (!io.clientPool) await client?.close();
  }
}

function shouldUseDaemon(args: readonly string[]): boolean {
  if (args.includes("--no-daemon") || args.length === 0 || args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-v")) return false;
  return args[0] !== "status";
}

async function execute(parsed: ParsedArgs, client: LspClient, profileId: string): Promise<{ envelope: any; code: number }> {
  const base = { schemaVersion: 1, operation: parsed.operation, status: "ok", workspace: parsed.workspace, projectRoot: parsed.projectRoot, server: { id: profileId, state: "ready" } };
  if (parsed.operation !== "diagnostics" && parsed.operation !== "status" && !client.supports(parsed.operation)) {
    return {
      envelope: { ...base, status: "unavailable", items: [], issues: [{ code: "unsupported_operation", message: `${profileId} did not advertise ${parsed.operation} support` }] },
      code: 3,
    };
  }
  if (parsed.operation === "symbols") {
    const raw = normalizeDocumentSymbols(await client.symbols(parsed.files[0]), parsed.files[0]);
    const items = raw.slice(0, parsed.limit);
    return { envelope: { ...base, snapshot: client.snapshots(parsed.files), items, coverage: coverage(parsed.files.length, parsed.files.length, raw.length > parsed.limit) }, code: 0 };
  }
  if (parsed.operation === "definition" || parsed.operation === "references") {
    const raw = parsed.operation === "definition"
      ? await client.definition(parsed.files[0], parsed.line!, parsed.column!)
      : await client.references(parsed.files[0], parsed.line!, parsed.column!, parsed.includeDeclaration);
    const items = raw.slice(0, parsed.limit).map(normalizeLocation);
    return { envelope: { ...base, snapshot: client.snapshots(parsed.files), items, ...(items.length === 0 ? { emptyReason: "no_match" } : {}), coverage: coverage(1, 1, raw.length > parsed.limit) }, code: 0 };
  }
  if (parsed.operation === "hover") {
    const raw = await client.hover(parsed.files[0], parsed.line!, parsed.column!);
    const snapshot = client.snapshots(parsed.files);
    const document = snapshot.documents[0];
    const items = raw ? [{ text: hoverText(raw).slice(0, 4_000), path: parsed.files[0], sha256: document.sha256, ...(raw.range ? { location: normalizeLocation({ uri: pathToFileURL(parsed.files[0]).href, range: raw.range }).location } : {}) }] : [];
    return { envelope: { ...base, snapshot, items, ...(items.length === 0 ? { emptyReason: "no_match" } : {}), coverage: coverage(1, 1, false) }, code: 0 };
  }
  const all: any[] = [];
  let confirmed = 0;
  for (const file of parsed.files) {
    const result = await client.diagnostics(file);
    if (result.confirmed) confirmed += 1;
    all.push(...result.items.map((item) => normalizeDiagnostic(item, file)));
  }
  const diagnosticState = confirmed !== parsed.files.length ? "inconclusive" : all.length > 0 ? "findings" : "clean";
  const ok = diagnosticState !== "inconclusive";
  return {
    envelope: {
      ...base, status: ok ? "ok" : "partial", diagnosticState, snapshot: client.snapshots(parsed.files), items: all.slice(0, parsed.limit),
      coverage: coverage(parsed.files.length, confirmed, all.length > parsed.limit),
      issues: ok ? [] : [{ code: "diagnostics_unconfirmed", message: "No diagnostic report could be attributed to the current document snapshot." }],
      ...(ok ? {} : { nextAction: "Run project checks and do not report this result as LSP clean." }),
    },
    code: ok ? 0 : 4,
  };
}

interface ParsedArgs {
  operation: Operation;
  files: string[];
  workspace: string;
  workspaceExplicit: boolean;
  projectRoot: string;
  timeoutMs: number;
  limit: number;
  line?: number;
  column?: number;
  includeDeclaration: boolean;
  expectSha256?: string;
  noDaemon: boolean;
  help: boolean;
}

function parseArgs(args: string[], cwd: string): ParsedArgs {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { operation: "status", files: [], workspace: cwd, workspaceExplicit: false, projectRoot: cwd, timeoutMs: 10_000, limit: 50, includeDeclaration: false, noDaemon: false, help: true };
  const operation = args[0] as Operation;
  if (!OPERATIONS.includes(operation)) throw new Error(`unknown operation '${args[0]}'`);
  const files: string[] = [];
  let workspace = cwd; let workspaceExplicit = false; let timeoutMs = 10_000; let limit = 50; let line: number | undefined; let column: number | undefined; let includeDeclaration = false; let noDaemon = false; let expectSha256: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--file") files.push(resolve(cwd, requireValue(args, ++i, value)));
    else if (value === "--workspace") { workspace = resolve(cwd, requireValue(args, ++i, value)); workspaceExplicit = true; }
    else if (value === "--line") line = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--column") column = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--timeout-ms") timeoutMs = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--limit") limit = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--expect-sha256") expectSha256 = requireValue(args, ++i, value);
    else if (value === "--include-declaration") includeDeclaration = true;
    else if (value === "--no-daemon") noDaemon = true;
    else throw new Error(`unknown argument '${value}'`);
  }
  if (files.length === 0) throw new Error(`${operation} requires --file`);
  if (operation !== "diagnostics" && files.length !== 1) throw new Error(`${operation} accepts exactly one --file`);
  if (["definition", "references", "hover"].includes(operation) && (!line || !column)) throw new Error(`${operation} requires --line and --column`);
  if (expectSha256 && !/^[a-f0-9]{64}$/i.test(expectSha256)) throw new Error("--expect-sha256 requires a 64-character hexadecimal SHA-256");
  return { operation, files, workspace, workspaceExplicit, projectRoot: workspace, timeoutMs, limit, line, column, includeDeclaration, noDaemon, expectSha256, help: false };
}

function findProjectRoot(file: string, workspace: string, explicit: boolean): string {
  const canonicalFile = realpathSync(file);
  const canonicalWorkspace = existsSync(workspace) ? realpathSync(workspace) : resolve(workspace);
  if (explicit && !isWithin(canonicalWorkspace, canonicalFile)) throw new Error("--file must be inside --workspace");
  const extension = extname(canonicalFile).toLowerCase();
  const markers = extension === ".py"
    ? ["pyrightconfig.json", "pyproject.toml", "setup.cfg"]
    : ["tsconfig.json", "jsconfig.json"];
  let directory = dirname(canonicalFile);
  const boundary = explicit ? canonicalWorkspace : undefined;
  while (true) {
    if (markers.some((marker) => existsSync(resolve(directory, marker)))) return directory;
    if (boundary && directory === boundary) break;
    const parent = dirname(directory);
    if (parent === directory || (boundary && !isWithin(boundary, parent))) break;
    directory = parent;
  }
  return explicit ? canonicalWorkspace : isWithin(canonicalWorkspace, canonicalFile) ? canonicalWorkspace : dirname(canonicalFile);
}

function isWithin(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function emit(io: CoffeeLspIo, value: any, code: number): number {
  let serialized = JSON.stringify(value);
  let truncated = false;
  while (Buffer.byteLength(serialized) > 16 * 1024 && Array.isArray(value.items) && value.items.length > 0) {
    value.items.pop();
    truncated = true;
    serialized = JSON.stringify(value);
  }
  if (truncated) {
    value.coverage = { ...(value.coverage ?? {}), truncated: true };
    value.issues = [...(value.issues ?? []), { code: "output_truncated", message: "Result items were removed to keep stdout within 16 KiB." }];
    serialized = JSON.stringify(value);
    while (Buffer.byteLength(serialized) > 16 * 1024 && value.items.length > 0) {
      value.items.pop();
      serialized = JSON.stringify(value);
    }
  }
  io.stdout(serialized + "\n");
  return code;
}

function emitError(io: CoffeeLspIo, operation: string, code: string, detail: string, exitCode: number, workspace = io.cwd, serverId = "unknown"): number {
  return emit(io, { schemaVersion: 1, operation, status: exitCode === 4 ? "partial" : exitCode === 3 ? "unavailable" : "error", workspace, projectRoot: workspace, server: { id: serverId, state: "unavailable" }, items: [], issues: [{ code, message: detail }] }, exitCode);
}

function coverage(requestedFiles: number, confirmedFiles: number, truncated: boolean): any { return { requestedFiles, confirmedFiles, truncated }; }
function positiveInt(raw: string, option: string): number { const value = Number(raw); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${option} requires a positive integer`); return value; }
function requireValue(args: string[], index: number, option: string): string { const value = args[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`); return value; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function fileSha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function helpText(): string {
  return `coffee-lsp <status|symbols|definition|references|hover|diagnostics> --file <path> [options]\n\nOptions:\n  --workspace <path>       workspace root\n  --line <n> --column <n>  1-based Unicode code point position\n  --include-declaration    include a symbol declaration in references\n  --timeout-ms <n>         request timeout\n  --limit <n>              maximum returned items\n  --expect-sha256 <hash>   reject a stale navigation position\n  --no-daemon              use one language-server process for this call\n`;
}
