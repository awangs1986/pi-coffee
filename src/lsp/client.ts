import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

type JsonObject = Record<string, any>;

export interface LspServerSpec {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  allowVersionlessDiagnostics?: boolean;
}

export interface NormalizedLocation {
  path: string;
  location: { line: number; column: number; endLine: number; endColumn: number };
  sha256?: string;
  snippet?: string;
}

export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly openVersions = new Map<string, number>();
  private readonly openHashes = new Map<string, string>();
  private readonly diagnosticListeners = new Map<string, Set<(items: any[], version?: number) => void>>();
  private capabilities: JsonObject = {};
  private generation = 0;
  private closed = false;
  private stderr = "";

  private constructor(private readonly spec: LspServerSpec, private readonly timeoutMs: number) {
    this.child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.consume(); });
    this.child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8_000); });
    this.child.on("error", (error) => this.failAll(new Error(`language server failed to start: ${error.message}`)));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) this.failAll(new Error(`language server exited (${code ?? signal ?? "unknown"})${this.stderr ? `: ${this.stderr.trim()}` : ""}`));
    });
  }

  static async start(spec: LspServerSpec, timeoutMs: number): Promise<LspClient> {
    const client = new LspClient(spec, timeoutMs);
    const rootUri = pathToFileURL(spec.cwd).href;
    const initialized = await client.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: spec.cwd.split(/[\\/]/).at(-1) || "workspace" }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: true },
          publishDiagnostics: { relatedInformation: true, versionSupport: true, tagSupport: { valueSet: [1, 2] } },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          definition: { linkSupport: true },
          references: {}, hover: { contentFormat: ["plaintext", "markdown"] }, diagnostic: {},
        },
      },
    });
    client.capabilities = initialized?.capabilities ?? {};
    client.notify("initialized", {});
    client.notify("workspace/didChangeConfiguration", { settings: {} });
    // Servers such as Pyright request workspace configuration immediately
    // after `initialized` and do not answer document requests until that
    // round trip has completed. Give server-initiated setup messages a short,
    // bounded turn through the transport before the first query.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return client;
  }

  serverCapabilities(): JsonObject { return this.capabilities; }

  supports(operation: "symbols" | "definition" | "references" | "hover"): boolean {
    const key = operation === "symbols" ? "documentSymbolProvider" : `${operation}Provider`;
    return Boolean(this.capabilities[key]);
  }

  snapshots(paths: readonly string[]): { generation: number; documents: Array<{ path: string; version: number; sha256: string }> } {
    return {
      generation: this.generation,
      documents: paths.map((path) => {
        const uri = pathToFileURL(path).href;
        const source = readFileSync(path);
        return { path, version: this.openVersions.get(uri) ?? 0, sha256: sha256(source) };
      }),
    };
  }

  async symbols(path: string): Promise<any[]> {
    await this.sync(path);
    return await this.request("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(path).href } }) ?? [];
  }

  async definition(path: string, line: number, column: number): Promise<any[]> {
    await this.sync(path);
    return asArray(await this.request("textDocument/definition", { textDocument: { uri: pathToFileURL(path).href }, position: externalPosition(path, line, column) }));
  }

  async references(path: string, line: number, column: number, includeDeclaration: boolean): Promise<any[]> {
    await this.sync(path);
    return asArray(await this.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(path).href }, position: externalPosition(path, line, column), context: { includeDeclaration },
    }));
  }

  async hover(path: string, line: number, column: number): Promise<any | null> {
    await this.sync(path);
    return await this.request("textDocument/hover", { textDocument: { uri: pathToFileURL(path).href }, position: externalPosition(path, line, column) }) ?? null;
  }

  async diagnostics(path: string): Promise<{ confirmed: boolean; items: any[] }> {
    const uri = pathToFileURL(path).href;
    const beforeHash = sha256(readFileSync(path));
    if (this.capabilities.diagnosticProvider) {
      await this.sync(path);
      const report = await this.request("textDocument/diagnostic", { textDocument: { uri } });
      return { confirmed: report?.kind === "full" && beforeHash === sha256(readFileSync(path)), items: report?.items ?? [] };
    }
    const currentVersion = this.openVersions.get(uri);
    const expectedVersion = (currentVersion ?? 0) + 1;
    const result = this.waitForDiagnostics(uri, expectedVersion);
    await this.sync(path, true);
    const resolved = await result;
    return { ...resolved, confirmed: resolved.confirmed && beforeHash === sha256(readFileSync(path)) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try { await this.request("shutdown", null, Math.min(this.timeoutMs, 2_000)); } catch { /* best effort */ }
    this.notify("exit", null);
    this.closed = true;
    this.child.kill();
  }

  private async sync(path: string, force = false): Promise<number> {
    const uri = pathToFileURL(path).href;
    const text = readFileSync(path, "utf8");
    const digest = sha256(text);
    const current = this.openVersions.get(uri);
    if (!force && current !== undefined && this.openHashes.get(uri) === digest) return current;
    const next = (this.openVersions.get(uri) ?? 0) + 1;
    if (next === 1) {
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId: languageId(path), version: next, text } });
    } else {
      this.notify("textDocument/didChange", { textDocument: { uri, version: next }, contentChanges: [{ text }] });
    }
    this.openVersions.set(uri, next);
    this.openHashes.set(uri, digest);
    this.generation += 1;
    return next;
  }

  private waitForDiagnostics(uri: string, expectedVersion: number): Promise<{ confirmed: boolean; items: any[] }> {
    return new Promise((resolve) => {
      let latest: any[] | undefined;
      let quiet: NodeJS.Timeout | undefined;
      const finish = (confirmed: boolean) => {
        clearTimeout(timeout);
        if (quiet) clearTimeout(quiet);
        listeners.delete(onDiagnostics);
        resolve({ confirmed, items: latest ?? [] });
      };
      const onDiagnostics = (items: any[], version?: number) => {
        if (version !== expectedVersion && !(version === undefined && this.spec.allowVersionlessDiagnostics)) return;
        latest = items;
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => finish(true), 120);
      };
      const listeners = this.diagnosticListeners.get(uri) ?? new Set();
      listeners.add(onDiagnostics);
      this.diagnosticListeners.set(uri, listeners);
      const timeout = setTimeout(() => finish(false), this.timeoutMs);
    });
  }

  private request(method: string, params: any, timeoutMs = this.timeoutMs): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out${this.stderr ? `: ${this.stderr.trim()}` : ""}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: any): void { this.send({ jsonrpc: "2.0", method, params }); }

  private send(message: JsonObject): void {
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private consume(): void {
    while (true) {
      const marker = this.buffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const header = this.buffer.subarray(0, marker).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { this.failAll(new Error("invalid language server frame")); return; }
      const length = Number(match[1]);
      const end = marker + 4 + length;
      if (this.buffer.length < end) return;
      const message = JSON.parse(this.buffer.subarray(marker + 4, end).toString("utf8"));
      this.buffer = this.buffer.subarray(end);
      this.handle(message);
    }
  }

  private handle(message: JsonObject): void {
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id)); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "language server request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      for (const listener of this.diagnosticListeners.get(message.params?.uri) ?? []) listener(message.params?.diagnostics ?? [], message.params?.version);
      return;
    }
    if (message.id !== undefined) {
      const result = message.method === "workspace/configuration"
        ? (message.params?.items ?? []).map(() => ({}))
        : message.method === "workspace/workspaceFolders"
          ? [{ uri: pathToFileURL(this.spec.cwd).href, name: this.spec.cwd.split(/[\\/]/).at(-1) || "workspace" }]
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}

export function normalizeLocation(value: any): NormalizedLocation {
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.targetRange ?? value.range;
  const path = fileURLToPath(uri);
  const source = readFileSync(path, "utf8");
  const lines = source.split(/\r?\n/);
  const start = externalRangePosition(lines, range.start);
  const end = externalRangePosition(lines, range.end);
  return {
    path,
    sha256: sha256(source),
    location: { line: start.line, column: start.column, endLine: end.line, endColumn: end.column },
    snippet: lines[range.start.line]?.slice(0, 300) ?? "",
  };
}

export function normalizeDocumentSymbols(values: any[], path: string): any[] {
  const source = readFileSync(path, "utf8");
  const digest = sha256(source);
  const lines = source.split(/\r?\n/);
  const output: any[] = [];
  const visit = (item: any, container?: string) => {
    const range = item.selectionRange ?? item.location?.range ?? item.range;
    const start = externalRangePosition(lines, range.start);
    const end = externalRangePosition(lines, range.end);
    output.push({ name: item.name, kind: item.kind, path, sha256: digest, ...(container ? { container } : {}), location: { line: start.line, column: start.column, endLine: end.line, endColumn: end.column } });
    for (const child of item.children ?? []) visit(child, item.name);
  };
  for (const item of values) visit(item);
  return output;
}

export function normalizeDiagnostic(value: any, path: string): any {
  const source = readFileSync(path, "utf8");
  const lines = source.split(/\r?\n/);
  const start = externalRangePosition(lines, value.range.start);
  const end = externalRangePosition(lines, value.range.end);
  return { path, sha256: sha256(source), location: { line: start.line, column: start.column, endLine: end.line, endColumn: end.column }, severity: value.severity, code: value.code, source: value.source, message: String(value.message ?? "").slice(0, 1_000) };
}

export function hoverText(value: any): string {
  const contents = value?.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n");
  return contents?.value ?? value?.value ?? "";
}

function asArray(value: any): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }

function externalPosition(path: string, line: number, column: number): { line: number; character: number } {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  if (line < 1 || line > lines.length || column < 1) throw new Error("position is outside the file");
  const codePoints = Array.from(lines[line - 1]);
  if (column > codePoints.length + 1) throw new Error("position is outside the file");
  const prefix = codePoints.slice(0, column - 1).join("");
  return { line: line - 1, character: prefix.length };
}

function externalRangePosition(lines: string[], position: { line: number; character: number }): { line: number; column: number } {
  const prefix = (lines[position.line] ?? "").slice(0, position.character);
  return { line: position.line + 1, column: Array.from(prefix).length + 1 };
}

function languageId(path: string): string {
  if (/\.tsx$/i.test(path)) return "typescriptreact";
  if (/\.ts$/i.test(path)) return "typescript";
  if (/\.jsx$/i.test(path)) return "javascriptreact";
  if (/\.js$/i.test(path)) return "javascript";
  if (/\.py$/i.test(path)) return "python";
  return "plaintext";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
