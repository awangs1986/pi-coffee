import { projectFingerprint } from "./snapshot.js";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
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
  resolveProfile,
  toServerSpec,
  type LspProfileResolution,
} from "./profiles.js";
import { requestLspDaemon } from "./transport.js";

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
] as const;
type Operation = (typeof OPERATIONS)[number];

export async function runCoffeeLsp(
  args: string[],
  io: CoffeeLspIo,
): Promise<number> {
  if (args.includes("--version") || args.includes("-v")) {
    io.stdout("coffee-lsp 0.1.0\n");
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
  const profile = resolveProfile(primary, parsed.projectRoot, io.env);
  try {
    for (const file of parsed.files) {
      const root = findProjectRoot(
        file,
        parsed.workspace,
        parsed.workspaceExplicit,
      );
      if (
        root !== parsed.projectRoot ||
        resolveProfile(file, root, io.env).id !== profile.id
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
  const requiredMarkers: Record<string, string[]> = {
    cpp: ["compile_commands.json", "build/compile_commands.json", ".clangd"],
    rust: ["Cargo.toml", "rust-project.json"],
    go: ["go.mod", "go.work"],
  };
  const markers = requiredMarkers[profile.id];
  if (
    markers &&
    !markers.some((name) => existsSync(resolve(parsed.projectRoot, name)))
  )
    return emitError(
      io,
      parsed.operation,
      "project_configuration_missing",
      `Provide ${markers.join(" or ")} for semantic project coverage.`,
      3,
      parsed.projectRoot,
      profile.id,
    );
  if (
    profile.id === "csharp" &&
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
  if (profile.id === "csharp") {
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
    const initialSnapshot = projectFingerprint(parsed.projectRoot);
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
    const result = await execute(parsed, client, profile.id);
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
    return emitError(
      io,
      parsed.operation,
      timeout ? "request_timeout" : "server_failed",
      detail,
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
  return args[0] !== "status";
}

async function execute(
  parsed: ParsedArgs,
  client: LspClient,
  profileId: string,
): Promise<{ envelope: any; code: number }> {
  const base = {
    schemaVersion: 1,
    operation: parsed.operation,
    status: "ok",
    workspace: parsed.workspace,
    projectRoot: parsed.projectRoot,
    server: { id: profileId, state: "ready" },
  };
  if (
    parsed.operation !== "diagnostics" &&
    parsed.operation !== "status" &&
    !client.supports(parsed.operation)
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
  return {
    envelope: {
      ...base,
      status: ok ? "ok" : "partial",
      diagnosticState,
      snapshot: client.snapshots(parsed.files),
      items: all.slice(0, parsed.limit),
      coverage: coverage(
        parsed.files.length,
        confirmed,
        all.length > parsed.limit,
      ),
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
  includeDeclaration: boolean;
  expectSha256?: string;
  noDaemon: boolean;
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
  let workspace = cwd;
  let workspaceExplicit = false;
  let timeoutMs = 10_000;
  let limit = 50;
  let line: number | undefined;
  let column: number | undefined;
  let includeDeclaration = false;
  let noDaemon = false;
  let expectSha256: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--file")
      files.push(resolve(cwd, requireValue(args, ++i, value)));
    else if (value === "--workspace") {
      workspace = resolve(cwd, requireValue(args, ++i, value));
      workspaceExplicit = true;
    } else if (value === "--line")
      line = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--column")
      column = positiveInt(requireValue(args, ++i, value), value);
    else if (value === "--timeout-ms") {
      timeoutMs = positiveInt(requireValue(args, ++i, value), value);
      if (timeoutMs > 60000) throw new Error("--timeout-ms may not exceed 60000");
    }
    else if (value === "--limit")
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
  if (files.length === 0) throw new Error(`${operation} requires --file`);
  if (operation !== "diagnostics" && files.length !== 1)
    throw new Error(`${operation} accepts exactly one --file`);
  if (
    ["definition", "references", "hover", "implementation"].includes(
      operation,
    ) &&
    (!line || !column)
  )
    throw new Error(`${operation} requires --line and --column`);
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
    includeDeclaration,
    noDaemon,
    expectSha256,
    help: false,
  };
}

export function findProjectRoot(
  file: string,
  workspace: string,
  explicit: boolean,
): string {
  const canonicalFile = realpathSync(file);
  const canonicalWorkspace = existsSync(workspace)
    ? realpathSync(workspace)
    : resolve(workspace);
  if (explicit && !isWithin(canonicalWorkspace, canonicalFile))
    throw new Error("--file must be inside --workspace");
  const extension = extname(canonicalFile).toLowerCase();
  const markers =
    extension === ".py"
      ? ["pyrightconfig.json", "pyproject.toml", "setup.cfg"]
      : extension === ".cs"
        ? ["*.sln", "*.slnx", "*.csproj"]
        : extension === ".rs"
          ? ["Cargo.toml", "rust-project.json"]
          : extension === ".go"
            ? ["go.work", "go.mod"]
            : /\.(c|h|cc|cpp|cxx|hpp|hh|hxx)$/.test(extension)
              ? ["compile_commands.json", "build/compile_commands.json", ".clangd", "CMakeLists.txt"]
              : ["tsconfig.json", "jsconfig.json"];
  let directory = dirname(canonicalFile);
  const boundary = explicit ? canonicalWorkspace : undefined;
  while (true) {
    if (
      markers.some((marker) =>
        marker.startsWith("*")
          ? readdirSync(directory).some((name) =>
              name.endsWith(marker.slice(1)),
            )
          : existsSync(resolve(directory, marker)),
      )
    )
      return directory;
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
  while (
    Buffer.byteLength(serialized) > 16 * 1024 &&
    Array.isArray(value.items) &&
    value.items.length > 0
  ) {
    value.items.pop();
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
    while (
      Buffer.byteLength(serialized) > 16 * 1024 &&
      value.items.length > 0
    ) {
      value.items.pop();
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

function helpText(): string {
  return `coffee-lsp <status|symbols|definition|references|hover|implementation|diagnostics> --file <path> [options]\n\nOptions:\n  --workspace <path>       workspace root\n  --line <n> --column <n>  1-based Unicode code point position\n  --include-declaration    include a symbol declaration in references\n  --timeout-ms <n>         request timeout\n  --limit <n>              maximum returned items\n  --expect-sha256 <hash>   reject a stale navigation position\n  --no-daemon              use one language-server process for this call\n`;
}
