import {
  MAX_SNAPSHOT_ENTRIES,
  projectFingerprint,
  projectSnapshot,
} from "./snapshot.js";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { connect as connectTcp } from "node:net";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LspClient,
  externalPosition,
  hoverText,
  normalizeDiagnostic,
  normalizeDocumentSymbols,
  normalizeLocation,
} from "./client.js";
import {
  listServers,
  projectMarkersFor,
  registryFor,
  resolveProfile,
  toServerSpec,
  type LspProfileResolution,
} from "./profiles.js";
import { hasRootMarkers, managedNpmPrefix } from "./registry.js";
import { requestLspDaemon } from "./transport.js";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

export interface CoffeeLspIo {
  cwd: string;
  signal?: AbortSignal;
  env: NodeJS.ProcessEnv;
  stdout(text: string): void;
  stderr(text: string): void;
  clientPool?: CoffeeLspClientPool;
}

export interface CoffeeLspClientPool {
  acquire(
    profile: LspProfileResolution,
    workspace: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LspClient>;
  invalidate(client: LspClient): Promise<void>;
}

const OPERATIONS = [
  "status",
  "symbols",
  "definition",
  "references",
  "hover",
  "implementation",
  "diagnostics",
  "servers",
  "install",
] as const;
type Operation = (typeof OPERATIONS)[number];
/** Operations that describe the registry rather than one file; they never use the daemon. */
const REGISTRY_OPERATIONS: readonly Operation[] = ["servers", "install"];
const POSITIONAL_OPERATIONS: readonly Operation[] = [
  "definition",
  "references",
  "hover",
  "implementation",
];
/**
 * Documents above this size are not synchronized: bundles and generated files
 * stall language servers and are never what an agent is editing by hand.
 */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const VERSION: string = (() => {
  try {
    return JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ).version;
  } catch {
    return "unknown";
  }
})();

export async function runCoffeeLsp(
  args: string[],
  io: CoffeeLspIo,
): Promise<number> {
  if (args.includes("--version") || args.includes("-v")) {
    io.stdout(`coffee-lsp ${VERSION}\n`);
    return 0;
  }
  if (shouldUseDaemon(args)) {
    try {
      return await requestLspDaemon(args, io);
    } catch (error) {
      const cancelled = io.signal?.aborted;
      const timedOut = /timed out/i.test(message(error));
      return emitError(
        io,
        args[0] ?? "unknown",
        cancelled
          ? "request_cancelled"
          : timedOut
            ? "request_timeout"
            : "daemon_failed",
        message(error),
        cancelled || timedOut ? 4 : 5,
      );
    }
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args, io.cwd);
  } catch (error) {
    return emitError(io, "unknown", "invalid_arguments", message(error), 2);
  }
  if (parsed.help) {
    io.stdout(helpText());
    return 0;
  }
  if (parsed.operation === "servers") return emitServers(io, parsed);
  if (parsed.operation === "install") return installServer(io, parsed);
  const primary = parsed.files[0];
  if (!primary || !existsSync(primary))
    return emitError(
      io,
      parsed.operation,
      "invalid_arguments",
      "--file must name an existing file",
      2,
    );
  try {
    parsed.projectRoot = findProjectRoot(
      primary,
      parsed.workspace,
      parsed.workspaceExplicit,
      io.env,
    );
  } catch (error) {
    return emitError(
      io,
      parsed.operation,
      "invalid_arguments",
      message(error),
      2,
      parsed.workspace,
    );
  }
  if (parsed.expectSha256 && fileSha256(primary) !== parsed.expectSha256) {
    return emitError(
      io,
      parsed.operation,
      "stale_position",
      "The file changed since this position was obtained; rerun symbols or read the current file.",
      4,
      parsed.projectRoot,
    );
  }
  const oversized = parsed.files.find(
    (file) => existsSync(file) && statSync(file).size > MAX_DOCUMENT_BYTES,
  );
  if (oversized)
    return emitError(
      io,
      parsed.operation,
      "file_too_large",
      `${oversized} exceeds ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB; generated or bundled files are not synchronized with language servers.`,
      3,
      parsed.projectRoot,
    );
  if (parsed.symbol) {
    const found = locateSymbol(primary, parsed.symbol, parsed.line);
    if (!found)
      return emitError(
        io,
        parsed.operation,
        "symbol_not_found",
        `'${parsed.symbol}' does not occur ${parsed.line ? `on line ${parsed.line}` : "as a whole word in the file"}; check the spelling or pass --line/--column.`,
        2,
        parsed.projectRoot,
      );
    parsed.line = found.line;
    parsed.column = found.column;
  }
  try {
    if (parsed.line && parsed.column)
      externalPosition(primary, parsed.line, parsed.column);
  } catch (error) {
    return emitError(
      io,
      parsed.operation,
      "invalid_arguments",
      message(error),
      2,
      parsed.projectRoot,
    );
  }
  const profile = resolveProfile(
    primary,
    parsed.projectRoot,
    io.env,
    parsed.workspace,
  );
  try {
    for (const file of parsed.files) {
      const root = findProjectRoot(
        file,
        parsed.workspace,
        parsed.workspaceExplicit,
        io.env,
      );
      if (
        root !== parsed.projectRoot ||
        resolveProfile(file, root, io.env, parsed.workspace).id !== profile.id
      )
        throw new Error(
          "Diagnostic batches must use one language project; query mixed projects separately.",
        );
    }
  } catch (error) {
    return emitError(
      io,
      parsed.operation,
      "invalid_arguments",
      message(error),
      2,
      parsed.workspace,
    );
  }
  if (parsed.operation === "status") {
    if (profile.available && profile.tcp) {
      const reachable = await tcpReachable(profile.tcp.host, profile.tcp.port);
      if (!reachable) {
        profile.available = false;
        profile.reason =
          `${profile.id} language server is not listening on ${profile.tcp.host}:${profile.tcp.port}. ${profile.definition?.install ?? ""}`.trim();
      }
    }
    return emit(
      io,
      {
        schemaVersion: 1,
        operation: "status",
        status: profile.available ? "ok" : "unavailable",
        workspace: parsed.workspace,
        projectRoot: parsed.projectRoot,
        server: {
          id: profile.id,
          state: profile.available ? "available" : "unavailable",
          ...(profile.command ? { command: profile.command } : {}),
          ...(profile.role ? { role: profile.role } : {}),
          ...(profile.source ? { source: profile.source } : {}),
          ...(profile.definition
            ? { language: profile.definition.language }
            : {}),
        },
        capabilityState: "not_negotiated",
        capabilities: [
          "symbols",
          "definition",
          "references",
          "hover",
          "implementation",
          "diagnostics",
        ],
        issues: profile.available
          ? []
          : [{ code: "missing_server", message: profile.reason }],
      },
      profile.available ? 0 : 3,
    );
  }
  if (!profile.available)
    return emitError(
      io,
      parsed.operation,
      "missing_server",
      profile.reason ?? "language server unavailable",
      3,
      parsed.workspace,
      profile.id,
    );
  const markers = profile.definition?.requiredMarkers;
  if (markers && !hasRootMarkers(parsed.projectRoot, markers))
    return emitError(
      io,
      parsed.operation,
      "project_configuration_missing",
      `Provide ${markers.join(" or ")} for semantic project coverage.`,
      3,
      parsed.projectRoot,
      profile.id,
    );
  const csharp = profile.definition?.languageId === "csharp";
  if (
    csharp &&
    !readdirSync(parsed.projectRoot).some((name) =>
      /\.(csproj|sln|slnx)$/.test(name),
    )
  )
    return emitError(
      io,
      parsed.operation,
      "project_configuration_missing",
      "C# requires a .csproj/.sln/.slnx and the matching .NET SDK.",
      3,
      parsed.projectRoot,
      profile.id,
    );
  if (csharp) {
    const names = readdirSync(parsed.projectRoot);
    const solutions = names.filter((name) => /\.slnx?$/.test(name));
    const projects = names.filter((name) => name.endsWith(".csproj"));
    const selected = (profile.args ?? []).some(
      (arg) =>
        arg === "--solution" || arg === "-s" || arg.startsWith("--solution="),
    );
    if (
      !selected &&
      (solutions.length > 1 || (solutions.length === 0 && projects.length > 1))
    )
      return emitError(
        io,
        parsed.operation,
        "ambiguous_project",
        "Select a project directory or an explicit csharp-ls --solution command override.",
        3,
        parsed.projectRoot,
        profile.id,
      );
  }
  let client: LspClient | undefined;
  let unbind: (() => void) | undefined;
  try {
    const deadline = Date.now() + parsed.timeoutMs;
    const initial = projectSnapshot(parsed.projectRoot);
    const initialSnapshot = initial.fingerprint;
    client = io.clientPool
      ? await io.clientPool.acquire(
          profile,
          parsed.projectRoot,
          io.env,
          parsed.timeoutMs,
          io.signal,
        )
      : await LspClient.start(
          toServerSpec(profile, parsed.projectRoot, io.env),
          parsed.timeoutMs,
          io.signal,
        );
    unbind = client.bindSignal(io.signal, Math.max(0, deadline - Date.now()));
    const result = await execute(parsed, client, profile);
    if (initialSnapshot !== projectFingerprint(parsed.projectRoot))
      return emitError(
        io,
        parsed.operation,
        "stale_snapshot",
        "Project files changed during this query; rerun against the saved current state.",
        4,
        parsed.projectRoot,
        profile.id,
      );
    if (initial.truncated)
      result.envelope.issues = [
        ...(result.envelope.issues ?? []),
        {
          code: "snapshot_truncated",
          message: `The project has more than ${MAX_SNAPSHOT_ENTRIES} entries; changes outside the first ${MAX_SNAPSHOT_ENTRIES} are not detected. Add generated directories to .gitignore or narrow --workspace.`,
        },
      ];
    return emit(io, result.envelope, result.code);
  } catch (error) {
    if (client && io.clientPool && !client.isAlive())
      await io.clientPool.invalidate(client);
    const detail = message(error);
    if (io.signal?.aborted)
      return emitError(
        io,
        parsed.operation,
        "request_cancelled",
        "LSP request cancelled",
        4,
        parsed.projectRoot,
        profile.id,
      );
    const timeout = /timed out/i.test(detail);
    const hint =
      profile.id === "typescript" && /TypeScript installation/i.test(detail)
        ? " Add typescript to the project, or run coffee-lsp install typescript for a managed fallback."
        : profile.tcp && /not reachable/i.test(detail)
          ? ` ${profile.definition?.install ?? ""}`.trimEnd()
          : "";
    return emitError(
      io,
      parsed.operation,
      timeout ? "request_timeout" : "server_failed",
      detail + hint,
      timeout ? 4 : 5,
      parsed.projectRoot,
      profile.id,
    );
  } finally {
    unbind?.();
    if (!io.clientPool) await client?.close();
  }
}

function shouldUseDaemon(args: readonly string[]): boolean {
  if (
    args.includes("--no-daemon") ||
    args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-v")
  )
    return false;
  return (
    args[0] !== "status" && !REGISTRY_OPERATIONS.includes(args[0] as Operation)
  );
}

async function execute(
  parsed: ParsedArgs,
  client: LspClient,
  profile: LspProfileResolution,
): Promise<{ envelope: any; code: number }> {
  const profileId = profile.id;
  const base = {
    schemaVersion: 1,
    operation: parsed.operation,
    status: "ok",
    workspace: parsed.workspace,
    projectRoot: parsed.projectRoot,
    server: {
      id: profileId,
      state: "ready",
      ...(profile.role ? { role: profile.role } : {}),
    },
  };
  if (
    parsed.operation !== "diagnostics" &&
    parsed.operation !== "status" &&
    !REGISTRY_OPERATIONS.includes(parsed.operation) &&
    !client.supports(
      parsed.operation as Exclude<
        Operation,
        "diagnostics" | "status" | "servers" | "install"
      >,
    )
  ) {
    return {
      envelope: {
        ...base,
        status: "unavailable",
        items: [],
        issues: [
          {
            code: "unsupported_operation",
            message: `${profileId} did not advertise ${parsed.operation} support`,
          },
        ],
      },
      code: 3,
    };
  }
  if (parsed.operation === "symbols") {
    const raw = normalizeDocumentSymbols(
      await client.symbols(parsed.files[0]),
      parsed.files[0],
    );
    const items = raw.slice(0, parsed.limit);
    return {
      envelope: {
        ...base,
        snapshot: client.snapshots(parsed.files),
        items,
        coverage: coverage(
          parsed.files.length,
          parsed.files.length,
          raw.length > parsed.limit,
        ),
      },
      code: 0,
    };
  }
  if (
    parsed.operation === "definition" ||
    parsed.operation === "references" ||
    parsed.operation === "implementation"
  ) {
    const raw =
      parsed.operation === "definition"
        ? await client.definition(parsed.files[0], parsed.line!, parsed.column!)
        : parsed.operation === "implementation"
          ? await client.implementation(
              parsed.files[0],
              parsed.line!,
              parsed.column!,
            )
          : await client.references(
              parsed.files[0],
              parsed.line!,
              parsed.column!,
              parsed.includeDeclaration,
            );
    const items = raw.slice(0, parsed.limit).map(normalizeLocation);
    return {
      envelope: {
        ...base,
        position: { line: parsed.line, column: parsed.column },
        snapshot: client.snapshots(parsed.files),
        items,
        ...(items.length === 0 ? { emptyReason: "no_match" } : {}),
        coverage: coverage(1, 1, raw.length > parsed.limit),
      },
      code: 0,
    };
  }
  if (parsed.operation === "hover") {
    const raw = await client.hover(
      parsed.files[0],
      parsed.line!,
      parsed.column!,
    );
    const snapshot = client.snapshots(parsed.files);
    const document = snapshot.documents[0];
    const items = raw
      ? [
          {
            text: hoverText(raw).slice(0, 4_000),
            path: parsed.files[0],
            sha256: document.sha256,
            ...(raw.range
              ? {
                  location: normalizeLocation({
                    uri: pathToFileURL(parsed.files[0]).href,
                    range: raw.range,
                  }).location,
                }
              : {}),
          },
        ]
      : [];
    return {
      envelope: {
        ...base,
        position: { line: parsed.line, column: parsed.column },
        snapshot,
        items,
        ...(items.length === 0 ? { emptyReason: "no_match" } : {}),
        coverage: coverage(1, 1, false),
      },
      code: 0,
    };
  }
  const all: any[] = [];
  let confirmed = 0;
  for (const file of parsed.files) {
    try {
      const result = await client.diagnosticsForFile(file);
      if (result.confirmed) confirmed += 1;
      all.push(...result.items.map((item) => normalizeDiagnostic(item, file)));
    } catch (error) {
      // A shared deadline can expire between batch members. Keep confirmed evidence.
      if (/timed out/i.test(message(error))) break;
      throw error;
    }
  }
  const diagnosticState =
    confirmed !== parsed.files.length
      ? "inconclusive"
      : all.length > 0
        ? "findings"
        : "clean";
  const ok = diagnosticState !== "inconclusive";
  // Fallout in the other documents this server has open (the files touched in
  // this session): errors and warnings that were not there before this change.
  let related: any[] = [];
  let relatedFiles = 0;
  if (ok) {
    try {
      const outcome = await client.relatedDiagnostics(parsed.files);
      relatedFiles = outcome.examined;
      related = outcome.items
        .filter(({ diagnostic }) => (diagnostic.severity ?? 1) <= 2)
        .map(({ path, diagnostic }) => normalizeDiagnostic(diagnostic, path))
        .slice(0, parsed.limit);
    } catch {
      // Best effort: neighbour evidence never invalidates the confirmed result.
    }
  }
  return {
    envelope: {
      ...base,
      status: ok ? "ok" : "partial",
      diagnosticState,
      snapshot: client.snapshots(parsed.files),
      items: all.slice(0, parsed.limit),
      related,
      coverage: {
        ...coverage(parsed.files.length, confirmed, all.length > parsed.limit),
        relatedFiles,
      },
      issues: ok
        ? []
        : [
            {
              code: "diagnostics_unconfirmed",
              message:
                "No diagnostic report could be attributed to the current document snapshot.",
            },
          ],
      ...(ok
        ? {}
        : {
            nextAction:
              "Run project checks and do not report this result as LSP clean.",
          }),
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
  /** `name` or `name#n`: locate the n-th whole-word occurrence instead of a column. */
  symbol?: string;
  includeDeclaration: boolean;
  expectSha256?: string;
  noDaemon: boolean;
  /** Server id for `install`. */
  target?: string;
  help: boolean;
}

function parseArgs(args: string[], cwd: string): ParsedArgs {
  if (args.length === 0 || args.includes("--help") || args.includes("-h"))
    return {
      operation: "status",
      files: [],
      workspace: cwd,
      workspaceExplicit: false,
      projectRoot: cwd,
      timeoutMs: 10_000,
      limit: 50,
      includeDeclaration: false,
      noDaemon: false,
      help: true,
    };
  const operation = args[0] as Operation;
  if (!OPERATIONS.includes(operation))
    throw new Error(`unknown operation '${args[0]}'`);
  const files: string[] = [];
  let target: string | undefined;
  let workspace = cwd;
  let workspaceExplicit = false;
  let timeoutMs = 10_000;
  let limit = 50;
  let line: number | undefined;
  let column: number | undefined;
  let symbol: string | undefined;
  let includeDeclaration = false;
  let noDaemon = false;
  let expectSha256: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const value = args[i];
    if (operation === "install" && i === 1 && !value.startsWith("--"))
      target = value;
    else if (value === "--file")
      files.push(resolve(cwd, requireValue(args, ++i, value)));
    else if (value === "--workspace") {
      workspace = resolve(cwd, requireValue(args, ++i, value));
      workspaceExplicit = true;
    } else if (value === "--line")
      line = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--column")
      column = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--symbol") symbol = requireValue(args, ++i, value);
    else if (value === "--timeout-ms") {
      timeoutMs = positiveInt(requireValue(args, ++i, value), value);
      if (timeoutMs > 60000)
        throw new Error("--timeout-ms may not exceed 60000");
    } else if (value === "--limit")
      limit = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--expect-sha256")
      expectSha256 = requireValue(args, ++i, value);
    else if (value === "--include-declaration") includeDeclaration = true;
    else if (value === "--no-daemon") noDaemon = true;
    else throw new Error(`unknown argument '${value}'`);
  }
  if (files.length > 20)
    throw new Error("Query at most 20 files per diagnostic batch");
  if (timeoutMs > 60000) throw new Error("--timeout-ms may not exceed 60000");
  if (operation === "install" && !target)
    throw new Error("install requires a server id: coffee-lsp install <id>");
  if (REGISTRY_OPERATIONS.includes(operation))
    return {
      operation,
      files,
      workspace,
      workspaceExplicit,
      projectRoot: workspace,
      timeoutMs,
      limit,
      includeDeclaration,
      noDaemon: true,
      target,
      help: false,
    };
  if (files.length === 0) throw new Error(`${operation} requires --file`);
  if (operation !== "diagnostics" && files.length !== 1)
    throw new Error(`${operation} accepts exactly one --file`);
  if (
    POSITIONAL_OPERATIONS.includes(operation) &&
    !symbol &&
    (!line || !column)
  )
    throw new Error(
      `${operation} requires --line and --column, or --symbol <name>[#n]`,
    );
  if (symbol && !POSITIONAL_OPERATIONS.includes(operation))
    throw new Error(`--symbol applies to ${POSITIONAL_OPERATIONS.join(", ")}`);
  if (symbol && column)
    throw new Error("--symbol and --column are mutually exclusive");
  if (symbol && !/^[^#\s]+(#[1-9]\d*)?$/.test(symbol))
    throw new Error("--symbol expects <name> or <name>#<occurrence>");
  if (expectSha256 && !/^[a-f0-9]{64}$/i.test(expectSha256))
    throw new Error(
      "--expect-sha256 requires a 64-character hexadecimal SHA-256",
    );
  return {
    operation,
    files,
    workspace,
    workspaceExplicit,
    projectRoot: workspace,
    timeoutMs,
    limit,
    line,
    column,
    symbol,
    includeDeclaration,
    noDaemon,
    expectSha256,
    help: false,
  };
}

/**
 * Position of the n-th whole-word occurrence of `spec` (`name` or `name#n`),
 * on `line` when given or anywhere in the file. Columns are 1-based code points.
 */
export function locateSymbol(
  file: string,
  spec: string,
  line?: number,
): { line: number; column: number } | undefined {
  const match = /^([^#]+)(?:#(\d+))?$/.exec(spec);
  if (!match) return undefined;
  const name = match[1];
  const wanted = Number(match[2] ?? 1);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_$])`,
    "gu",
  );
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (line !== undefined && index + 1 !== line) continue;
    for (const hit of lines[index].matchAll(pattern)) {
      if (++seen !== wanted) continue;
      return {
        line: index + 1,
        column: Array.from(lines[index].slice(0, hit.index)).length + 1,
      };
    }
  }
  return undefined;
}

/** Whether something accepts connections on host:port within `timeoutMs`. */
function tcpReachable(
  host: string,
  port: number,
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((done) => {
    const socket = connectTcp({ host, port });
    const finish = (value: boolean) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function findProjectRoot(
  file: string,
  workspace: string,
  explicit: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const canonicalFile = realpathSync(file);
  const canonicalWorkspace = existsSync(workspace)
    ? realpathSync(workspace)
    : resolve(workspace);
  if (explicit && !isWithin(canonicalWorkspace, canonicalFile))
    throw new Error("--file must be inside --workspace");
  // Markers come from the servers that cover this file type, so a Vue file
  // finds its nuxt.config.ts and a Rust file its Cargo.toml.
  const markers = projectMarkersFor(
    canonicalFile,
    registryFor(canonicalWorkspace, env),
  );
  let directory = dirname(canonicalFile);
  const boundary = explicit ? canonicalWorkspace : undefined;
  while (markers.length > 0) {
    if (hasRootMarkers(directory, markers)) return directory;
    if (boundary && directory === boundary) break;
    const parent = dirname(directory);
    if (parent === directory || (boundary && !isWithin(boundary, parent)))
      break;
    directory = parent;
  }
  return explicit
    ? canonicalWorkspace
    : isWithin(canonicalWorkspace, canonicalFile)
      ? canonicalWorkspace
      : dirname(canonicalFile);
}

function isWithin(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function emit(io: CoffeeLspIo, value: any, code: number): number {
  let serialized = JSON.stringify(value);
  let truncated = false;
  const droppable = () =>
    Array.isArray(value.related) && value.related.length > 0
      ? value.related
      : Array.isArray(value.items) && value.items.length > 0
        ? value.items
        : undefined;
  while (Buffer.byteLength(serialized) > 16 * 1024 && droppable()) {
    droppable()!.pop();
    truncated = true;
    serialized = JSON.stringify(value);
  }
  if (truncated) {
    value.coverage = { ...(value.coverage ?? {}), truncated: true };
    value.issues = [
      ...(value.issues ?? []),
      {
        code: "output_truncated",
        message: "Result items were removed to keep stdout within 16 KiB.",
      },
    ];
    serialized = JSON.stringify(value);
    while (Buffer.byteLength(serialized) > 16 * 1024 && droppable()) {
      droppable()!.pop();
      serialized = JSON.stringify(value);
    }
  }
  if (Buffer.byteLength(serialized) > 16 * 1024) {
    serialized = JSON.stringify({
      schemaVersion: 1,
      operation: value.operation,
      status: "partial",
      items: [],
      coverage: { truncated: true },
      issues: [
        {
          code: "output_truncated",
          message:
            "Result metadata exceeded 16 KiB; query fewer files or a narrower result.",
        },
      ],
    });
    code = 4;
  }
  io.stdout(serialized + "\n");
  return code;
}

function emitError(
  io: CoffeeLspIo,
  operation: string,
  code: string,
  detail: string,
  exitCode: number,
  workspace = io.cwd,
  serverId = "unknown",
): number {
  return emit(
    io,
    {
      schemaVersion: 1,
      operation,
      status:
        exitCode === 4 ? "partial" : exitCode === 3 ? "unavailable" : "error",
      workspace,
      projectRoot: workspace,
      server: { id: serverId, state: "unavailable" },
      items: [],
      issues: [{ code, message: detail }],
    },
    exitCode,
  );
}

function coverage(
  requestedFiles: number,
  confirmedFiles: number,
  truncated: boolean,
): any {
  return { requestedFiles, confirmedFiles, truncated };
}
function positiveInt(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${option} requires a positive integer`);
  return value;
}
function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--"))
    throw new Error(`${option} requires a value`);
  return value;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function emitServers(io: CoffeeLspIo, parsed: ParsedArgs): number {
  const root = parsed.files[0]
    ? findProjectRoot(
        parsed.files[0],
        parsed.workspace,
        parsed.workspaceExplicit,
        io.env,
      )
    : parsed.workspace;
  const file = parsed.files[0];
  const items = listServers(root, io.env, parsed.workspace).map((entry) => ({
    ...entry,
    ...(file
      ? {
          appliesToFile: entry.fileTypes.some((type) =>
            fileMatches(file, type),
          ),
        }
      : {}),
  }));
  return emit(
    io,
    {
      schemaVersion: 1,
      operation: "servers",
      status: "ok",
      workspace: parsed.workspace,
      projectRoot: root,
      managedPrefix: managedNpmPrefix(io.env),
      items,
      issues: [],
    },
    0,
  );
}

function fileMatches(file: string, type: string): boolean {
  const lower = file.toLowerCase(),
    wanted = type.toLowerCase();
  if (wanted.startsWith(".")) return lower.endsWith(wanted);
  return (
    lower === wanted ||
    lower.endsWith(`/${wanted}`) ||
    lower.endsWith(`\\${wanted}`)
  );
}

/**
 * Install an npm-distributed server into the managed prefix. Only registry
 * entries with an `npm` package are installable; everything else prints its
 * install hint. Never touches the project.
 */
async function installServer(
  io: CoffeeLspIo,
  parsed: ParsedArgs,
): Promise<number> {
  const id = parsed.target!;
  const registry = registryFor(parsed.workspace, io.env);
  const definition = registry[id];
  if (!definition)
    return emitError(
      io,
      "install",
      "invalid_arguments",
      `unknown server '${id}'; run coffee-lsp servers`,
      2,
      parsed.workspace,
    );
  if (!definition.npm)
    return emitError(
      io,
      "install",
      "manual_install_required",
      `${id} is not distributed through npm. ${definition.install ?? ""}`.trim(),
      3,
      parsed.workspace,
      id,
    );
  const prefix = managedNpmPrefix(io.env);
  mkdirSync(prefix, { recursive: true });
  const manifest = resolve(prefix, "package.json");
  if (!existsSync(manifest))
    writeFileSync(
      manifest,
      JSON.stringify({ name: "pi-coffee-lsp-servers", private: true }, null, 2),
    );
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // `pkg`, `@scope/pkg` → latest; `pkg@5` keeps its range.
  const spec = /^(@[^/]+\/)?[^@]+@/.test(definition.npm)
    ? definition.npm
    : `${definition.npm}@latest`;
  const args = [
    "install",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--prefix",
    prefix,
    spec,
  ];
  const output = await new Promise<{ code: number | null; text: string }>(
    (done) => {
      const child = spawn(npm, args, {
        cwd: prefix,
        env: io.env,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout?.on("data", (chunk) => (text += chunk));
      child.stderr?.on("data", (chunk) => (text += chunk));
      const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
      child.on("error", (error) => {
        clearTimeout(timer);
        done({ code: null, text: `${text}\n${message(error)}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ code, text });
      });
    },
  );
  const listing = listServers(parsed.workspace, io.env).find(
    (entry) => entry.id === id,
  );
  if (output.code !== 0 || listing?.status !== "available")
    return emitError(
      io,
      "install",
      "install_failed",
      `npm ${args.join(" ")} exited with ${output.code}: ${output.text.trim().slice(-2000)}`,
      5,
      parsed.workspace,
      id,
    );
  return emit(
    io,
    {
      schemaVersion: 1,
      operation: "install",
      status: "ok",
      workspace: parsed.workspace,
      projectRoot: parsed.workspace,
      managedPrefix: prefix,
      server: {
        id,
        state: "available",
        command: listing.command,
        source: listing.source,
      },
      items: [listing],
      issues: [],
    },
    0,
  );
}

function helpText(): string {
  return `coffee-lsp <status|symbols|definition|references|hover|implementation|diagnostics> --file <path> [options]
coffee-lsp servers [--file <path>] [--workspace <path>]
coffee-lsp install <id>

Options:
  --workspace <path>       workspace root
  --line <n> --column <n>  1-based Unicode code point position
  --symbol <name>[#n]      locate the n-th whole-word occurrence of name
                           (on --line when given) instead of --column
  --include-declaration    include a symbol declaration in references
  --timeout-ms <n>         request timeout
  --limit <n>              maximum returned items
  --expect-sha256 <hash>   reject a stale navigation position
  --no-daemon              use one language-server process for this call

diagnostics also returns "related": errors and warnings that appeared in the
other files this session has open since they were last reported (best effort;
an empty list is not proof that dependents are clean).
servers lists the language-server registry (built-ins plus coffee-lsp.json
"servers" entries) and which command each resolves to from the workspace.
install <id> runs npm install for an npm-distributed server into the managed
prefix (PI_COFFEE_LSP_HOME/npm); other servers print their install hint.
`;
}
