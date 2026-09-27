// Selected LSP logic adapted from OMP, commit b1a8b875; see third_party/oh-my-pi/LICENSE and README.md.
import { EquivalentUriMap, uriToFile } from "./uri.js";
import {
  waitForDiagnostics,
  type PublishedDiagnostics,
} from "./diagnostics.js";
import { MessageFramer } from "./message-framing.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, any>;

export interface LspServerSpec {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  allowVersionlessDiagnostics?: boolean;
  settings?: JsonObject;
  initializationOptions?: JsonObject;
}

export interface NormalizedLocation {
  path: string;
  location: {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
  sha256?: string;
  snippet?: string;
}

export class LspTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LspTransportError";
  }
}

export class LspServerExitedError extends LspTransportError {
  constructor(message: string) {
    super(message);
    this.name = "LspServerExitedError";
  }
}

export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly framer = new MessageFramer(Buffer.alloc(0));
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
      cleanup: () => void;
    }
  >();
  private readonly openVersions = new EquivalentUriMap<number>();
  readonly openFiles = new EquivalentUriMap<{ version: number }>();
  readonly diagnostics = new EquivalentUriMap<PublishedDiagnostics>();
  private readonly needsCleanRefresh = new EquivalentUriMap<boolean>();
  diagnosticsVersion = 0;
  readonly startedAt = Date.now();
  private readonly dynamicCapabilities = new Map<string, string>();
  private readonly openHashes = new EquivalentUriMap<string>();

  private capabilities: JsonObject = {};
  private generation = 0;
  private readonly progress = new Set<string | number>();
  private lastProgress = Date.now();
  private failure?: Error;
  private closed = false;
  private stderr = "";
  private operationSignal?: AbortSignal;
  private deadline = Infinity;
  private writeChain: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private termination?: NodeJS.Timeout;

  private constructor(
    private readonly spec: LspServerSpec,
    private timeoutMs: number,
  ) {
    this.child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child.stdout.on("data", (chunk) => {
      try {
        this.framer.push(chunk);
        this.consume();
      } catch (error) {
        this.failAll(error as Error);
      }
    });
    this.child.stdin.on("error", (error) =>
      this.failAll(classifyTransportError(error)),
    );
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8_000);
    });
    this.child.on("error", (error) =>
      this.failAll(
        new Error(`language server failed to start: ${error.message}`),
      ),
    );
    this.child.on("exit", (code, signal) => {
      if (!this.closed)
        this.failAll(
          new LspServerExitedError(
            `language server exited (${code ?? signal ?? "unknown"})${this.stderr ? `: ${this.stderr.trim()}` : ""}`,
          ),
        );
    });
  }

  static async start(
    spec: LspServerSpec,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LspClient> {
    const client = new LspClient(spec, timeoutMs);
    const unbind = client.bindSignal(signal);
    const rootUri = pathToFileURL(spec.cwd).href;
    try {
      const initialized = await client.request("initialize", {
        processId: process.pid,
        initializationOptions: spec.initializationOptions ?? {},
        rootUri,
        workspaceFolders: [
          { uri: rootUri, name: spec.cwd.split(/[\\/]/).at(-1) || "workspace" },
        ],
        capabilities: {
          window: { workDoneProgress: true },
          general: { positionEncodings: ["utf-16"] },
          workspace: {
            configuration: true,
            workspaceFolders: true,
            applyEdit: false,
            didChangeWatchedFiles: { dynamicRegistration: true },
          },
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: true },
            publishDiagnostics: {
              relatedInformation: true,
              versionSupport: true,
              tagSupport: { valueSet: [1, 2] },
            },
            documentSymbol: {
              hierarchicalDocumentSymbolSupport: true,
              dynamicRegistration: true,
            },
            definition: { linkSupport: true, dynamicRegistration: true },
            implementation: { linkSupport: true, dynamicRegistration: true },
            references: { dynamicRegistration: true },
            hover: {
              dynamicRegistration: true,
              contentFormat: ["plaintext", "markdown"],
            },
            ...(spec.id === "rust"
              ? {}
              : { diagnostic: { dynamicRegistration: true } }),
          },
        },
      });
      client.capabilities = initialized?.capabilities ?? {};
      if (
        client.capabilities.positionEncoding &&
        client.capabilities.positionEncoding !== "utf-16"
      )
        throw new Error("Unsupported server position encoding");
      await client.notify("initialized", {});
      await client.notify("workspace/didChangeConfiguration", {
        settings: spec.settings ?? {},
      });
      // Servers such as Pyright request workspace configuration immediately
      // after `initialized` and do not answer document requests until that
      // round trip has completed. Give server-initiated setup messages a short,
      // bounded turn through the transport before the first query.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (["rust", "csharp"].includes(spec.id)) await client.waitForProject();
      return client;
    } catch (error) {
      await client.close();
      throw error;
    } finally {
      unbind();
    }
  }

  private async waitForProject(): Promise<void> {
    const started = Date.now();
    while (Date.now() < this.deadline) {
      if (this.failure) throw this.failure;
      this.operationSignal?.throwIfAborted();
      if (
        !this.progress.size &&
        Date.now() - this.lastProgress > 500 &&
        Date.now() - started > 2000
      ) {
        if (this.spec.id !== "rust") return;
        const status = await this.request("rust-analyzer/analyzerStatus", {});
        if (typeof status === "string" && !status.startsWith("No workspaces"))
          return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      "Project loading timed out; check project configuration and toolchain",
    );
  }

  bindSignal(signal?: AbortSignal, timeoutMs = this.timeoutMs): () => void {
    this.operationSignal = signal;
    this.timeoutMs = timeoutMs;
    this.deadline = Date.now() + timeoutMs;
    return () => {
      if (this.operationSignal === signal) this.operationSignal = undefined;
    };
  }

  isAlive(): boolean {
    return (
      !this.closed &&
      !this.failure &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }

  serverCapabilities(): JsonObject {
    return this.capabilities;
  }

  supports(
    operation:
      | "symbols"
      | "definition"
      | "references"
      | "hover"
      | "implementation",
  ): boolean {
    const key =
      operation === "symbols"
        ? "documentSymbolProvider"
        : `${operation}Provider`;
    const method =
      operation === "symbols"
        ? "textDocument/documentSymbol"
        : `textDocument/${operation}`;
    return Boolean(
      this.capabilities[key] ||
      [...this.dynamicCapabilities.values()].includes(method),
    );
  }

  snapshots(paths: readonly string[]): {
    generation: number;
    documents: Array<{ path: string; version: number; sha256: string }>;
  } {
    return {
      generation: this.generation,
      documents: paths.map((path) => {
        const uri = pathToFileURL(path).href;
        const source = readFileSync(path);
        return {
          path,
          version: this.openVersions.get(uri) ?? 0,
          sha256: sha256(source),
        };
      }),
    };
  }

  async symbols(path: string): Promise<any[]> {
    await this.sync(path);
    return (
      (await this.request("textDocument/documentSymbol", {
        textDocument: { uri: pathToFileURL(path).href },
      })) ?? []
    );
  }

  async definition(path: string, line: number, column: number): Promise<any[]> {
    await this.sync(path);
    return asArray(
      await this.request("textDocument/definition", {
        textDocument: { uri: pathToFileURL(path).href },
        position: externalPosition(path, line, column),
      }),
    );
  }

  async implementation(
    path: string,
    line: number,
    column: number,
  ): Promise<any[]> {
    await this.sync(path);
    return asArray(
      await this.request("textDocument/implementation", {
        textDocument: { uri: pathToFileURL(path).href },
        position: externalPosition(path, line, column),
      }),
    );
  }

  async references(
    path: string,
    line: number,
    column: number,
    includeDeclaration: boolean,
  ): Promise<any[]> {
    await this.sync(path);
    // OMP retries empty references while the initial project index catches up.
    const retryUntil = Math.min(this.deadline, this.startedAt + 3000);
    while (true) {
      const result = asArray(
        await this.request("textDocument/references", {
          textDocument: { uri: pathToFileURL(path).href },
          position: externalPosition(path, line, column),
          context: { includeDeclaration },
        }),
      );
      if (result.length || Date.now() + 200 >= retryUntil) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async hover(path: string, line: number, column: number): Promise<any | null> {
    await this.sync(path);
    return (
      (await this.request("textDocument/hover", {
        textDocument: { uri: pathToFileURL(path).href },
        position: externalPosition(path, line, column),
      })) ?? null
    );
  }

  async diagnosticsForFile(
    path: string,
  ): Promise<{ confirmed: boolean; items: any[] }> {
    const uri = pathToFileURL(path).href;
    const beforeHash = sha256(readFileSync(path));
    const canReopen = this.supports("symbols");
    const reopen = canReopen && this.needsCleanRefresh.has(uri);
    const version = await this.sync(path, false, reopen);
    if (reopen) this.needsCleanRefresh.delete(uri);
    const result = await waitForDiagnostics(this, uri, {
      timeoutMs: this.remainingMs(),
      signal: this.operationSignal,
      expectedDocumentVersion: version,
    });
    if (this.failure) throw this.failure;
    if (result.confirmed) this.needsCleanRefresh.delete(uri);
    return {
      ...result,
      confirmed: result.confirmed && beforeHash === sha256(readFileSync(path)),
    };
  }

  supportsDiagnosticPull(): boolean {
    return (
      this.spec.id !== "rust" &&
      Boolean(
        this.capabilities.diagnosticProvider ||
        [...this.dynamicCapabilities.values()].includes(
          "textDocument/diagnostic",
        ),
      )
    );
  }

  pullDiagnostics(
    uri: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<any> {
    return this.request(
      "textDocument/diagnostic",
      { textDocument: { uri } },
      timeoutMs,
      signal,
    );
  }

  close(): Promise<void> {
    return (this.closing ??= this.closeOnce());
  }

  private async closeOnce(): Promise<void> {
    this.operationSignal = undefined;
    this.deadline = Infinity;
    if (this.termination) clearTimeout(this.termination);
    const alive = () =>
      this.child.exitCode === null && this.child.signalCode === null;
    if (alive() && !this.failure) {
      try {
        await this.request("shutdown", null, 500, undefined);
      } catch {
        /* bounded best effort */
      }
      try {
        await this.send(
          { jsonrpc: "2.0", method: "exit", params: null },
          undefined,
          200,
        );
      } catch {
        /* exit may close stdin */
      }
    }
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.cleanup();
      p.reject(new Error("LSP server stopped"));
    }
    this.pending.clear();
    if (alive()) this.killOwned("SIGTERM");
    const end = Date.now() + 500;
    while (alive() && Date.now() < end)
      await new Promise((r) => setTimeout(r, 10));
    // A wrapper may have exited with descendants still holding its pipes.
    this.killOwned("SIGKILL");
    const killEnd = Date.now() + 500;
    while (alive() && Date.now() < killEnd)
      await new Promise((r) => setTimeout(r, 10));
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
    if (alive())
      throw new Error("LSP process termination could not be confirmed");
  }

  private killOwned(signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && this.child.pid)
        process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private remainingMs(): number {
    this.operationSignal?.throwIfAborted();
    const remaining = Math.min(this.timeoutMs, this.deadline - Date.now());
    if (remaining <= 0) throw new Error("LSP request timed out");
    return remaining;
  }

  // OMP disk reconciliation and watched-file refresh, without editor write hooks.
  async reconcileWorkspace(
    changes: readonly import("./snapshot.js").FileChange[],
  ): Promise<void> {
    if (!changes.length) return;
    const contentChanges = changes.filter((change) => {
      if (change.type !== 2) return true;
      const uri = pathToFileURL(change.path).href;
      return (
        !this.openHashes.has(uri) ||
        this.openHashes.get(uri) !== sha256(readFileSync(change.path))
      );
    });
    if (!contentChanges.length) return;
    // typescript-language-server suppresses empty-to-empty diagnostic updates.
    // Reopen a changed document whose last report was empty to make the next
    // empty report attributable to the saved contents.
    if (this.spec.id === "typescript") {
      for (const [uri, report] of this.diagnostics)
        if (report.diagnostics.length === 0)
          this.needsCleanRefresh.set(uri, true);
    }
    this.diagnostics.clear();
    for (const change of contentChanges) {
      const uri = pathToFileURL(change.path).href;
      if (change.type === 3 && this.openVersions.has(uri)) {
        await this.notify("textDocument/didClose", { textDocument: { uri } });
        this.openVersions.delete(uri);
        this.openFiles.delete(uri);
        this.openHashes.delete(uri);
        this.needsCleanRefresh.delete(uri);
      } else if (this.openVersions.has(uri)) {
        const reopen = this.supports("symbols") && this.needsCleanRefresh.has(uri);
        await this.sync(change.path, false, reopen);
        if (reopen) this.needsCleanRefresh.delete(uri);
      }
    }
    await this.notify("workspace/didChangeWatchedFiles", {
      changes: contentChanges.map((change) => ({
        uri: pathToFileURL(change.path).href,
        type: change.type,
      })),
    });
    // OMP refreshes open overlays for module creation/deletion only. Re-saving
    // every open file on an ordinary edit repeatedly cancels rust-analyzer flycheck.
    if (contentChanges.every((change) => change.type === 2)) return;
    for (const uri of this.openFiles.keys()) {
      const path = uriToFile(uri);
      if (existsSync(path) && !contentChanges.some((change) => change.path === path))
        await this.sync(path, true);
    }
  }

  private async sync(
    path: string,
    force = false,
    reopenForDiagnostics = false,
  ): Promise<number> {
    const uri = pathToFileURL(path).href;
    const text = readFileSync(path, "utf8");
    const digest = sha256(text);
    const current = this.openVersions.get(uri);
    if (
      !force &&
      !reopenForDiagnostics &&
      current !== undefined &&
      this.openHashes.get(uri) === digest
    )
      return current;
    this.diagnostics.delete(uri);
    const next = (this.openVersions.get(uri) ?? 0) + 1;
    try {
      if (reopenForDiagnostics && current !== undefined) {
        await this.notify("textDocument/didClose", { textDocument: { uri } });
        // TypeScript publishes an empty report on close. A following request is
        // a transport barrier: its reply comes after didClose has been handled,
        // including that old report. Discard it before opening the new content.
        await this.request("textDocument/documentSymbol", {
          textDocument: { uri },
        });
        this.diagnostics.delete(uri);
      }
      if (next === 1 || reopenForDiagnostics) {
        await this.notify("textDocument/didOpen", {
          textDocument: {
            uri,
            languageId: languageId(path),
            version: next,
            text,
          },
        });
      } else {
        await this.notify("textDocument/didChange", {
          textDocument: { uri, version: next },
          contentChanges: [{ text }],
        });
      }
      await this.notify("textDocument/didSave", { textDocument: { uri }, text });
    } catch (error) {
      // A partial notification sequence can leave the server's open documents
      // out of sync with our versions. Retire it instead of reusing that state.
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    this.openVersions.set(uri, next);
    this.openFiles.set(uri, { version: next });
    this.openHashes.set(uri, digest);
    this.generation += 1;
    return next;
  }

  // OMP sendRequest/queueWriteMessage adapted to Node streams and caller-owned deadlines.
  private request(
    method: string,
    params: any,
    timeoutMs = this.timeoutMs,
    signal = this.operationSignal,
  ): Promise<any> {
    if (this.failure && method !== "shutdown")
      return Promise.reject(this.failure);
    if (method !== "shutdown") {
      try {
        timeoutMs = Math.min(timeoutMs, this.remainingMs());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    if (signal?.aborted)
      return Promise.reject(
        signal.reason ?? new Error("LSP request cancelled"),
      );
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const finish = (error: Error) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        cleanup();
        void this.send(
          { jsonrpc: "2.0", method: "$/cancelRequest", params: { id } },
          undefined,
          200,
        ).catch(() => {});
        reject(error);
      };
      const abort = () =>
        finish(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error("LSP request cancelled"),
        );
      const timer = setTimeout(
        () => finish(new Error(`${method} timed out`)),
        timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      void this.send(
        { jsonrpc: "2.0", id, method, params },
        signal,
        timeoutMs,
      ).catch(finish);
    });
  }

  private notify(method: string, params: any): Promise<void> {
    return this.send(
      { jsonrpc: "2.0", method, params },
      this.operationSignal,
      this.remainingMs(),
    );
  }

  private send(
    message: JsonObject,
    signal?: AbortSignal,
    timeoutMs = 2000,
  ): Promise<void> {
    const write = async () => {
      signal?.throwIfAborted();
      const body = JSON.stringify(message);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(classifyTransportError(error));
          else resolve();
        };
        const abort = () =>
          finish(
            signal?.reason instanceof Error
              ? signal.reason
              : new Error("LSP write cancelled"),
          );
        const timer = setTimeout(
          () => {
            const error = new Error("LSP write timed out");
            this.failAll(error);
            finish(error);
          },
          Math.max(1, timeoutMs),
        );
        signal?.addEventListener("abort", abort, { once: true });
        this.child.stdin.write(
          `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          (error) => finish(error),
        );
      });
    };
    const result = this.writeChain.then(write);
    this.writeChain = result.catch(() => {});
    return result;
  }

  private consume(): void {
    try {
      for (const body of this.framer.drain(() => undefined)) {
        try {
          this.handle(JSON.parse(body));
        } catch (error) {
          this.failAll(
            new Error(
              `invalid language server message: ${error instanceof Error ? error.message : "unknown"}`,
            ),
          );
        }
      }
    } catch (error) {
      this.failAll(
        error instanceof Error ? error : new Error("invalid server frame"),
      );
    }
  }

  private handle(message: JsonObject): void {
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      pending.cleanup();
      if (message.error)
        pending.reject(
          new Error(message.error.message ?? "language server request failed"),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "$/progress") {
      this.lastProgress = Date.now();
      if (message.params?.value?.kind === "begin")
        this.progress.add(message.params.token);
      if (message.params?.value?.kind === "end")
        this.progress.delete(message.params.token);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      this.diagnostics.set(message.params.uri, {
        diagnostics: message.params.diagnostics ?? [],
        version: message.params.version ?? null,
      });
      this.diagnosticsVersion++;
      return;
    }
    if (message.id !== undefined) {
      if (message.method === "workspace/diagnostic/refresh")
        this.diagnostics.clear();
      if (message.method === "client/registerCapability") {
        for (const r of message.params?.registrations ?? [])
          if (typeof r.id === "string" && typeof r.method === "string")
            this.dynamicCapabilities.set(r.id, r.method);
      } else if (message.method === "client/unregisterCapability") {
        for (const r of message.params?.unregisterations ??
          message.params?.unregistrations ??
          []) {
          this.dynamicCapabilities.delete(r.id);
          if (r.method === "textDocument/diagnostic") this.diagnostics.clear();
        }
      }
      const result =
        message.method === "workspace/applyEdit"
          ? {
              applied: false,
              failureReason:
                "Coffee LSP queries are read-only; use the task file tools.",
            }
          : message.method === "workspace/configuration"
            ? (message.params?.items ?? []).map(
                (item: any) =>
                  String(item.section ?? "")
                    .split(".")
                    .filter(Boolean)
                    .reduce(
                      (value: any, key: string) => value?.[key],
                      this.spec.settings ?? {},
                    ) ?? null,
              )
            : message.method === "workspace/workspaceFolders"
              ? [
                  {
                    uri: pathToFileURL(this.spec.cwd).href,
                    name: this.spec.cwd.split(/[\\/]/).at(-1) || "workspace",
                  },
                ]
              : null;
      const known = [
        "workspace/applyEdit",
        "workspace/configuration",
        "workspace/workspaceFolders",
        "window/workDoneProgress/create",
        "client/registerCapability",
        "client/unregisterCapability",
        "window/showMessageRequest",
        "workspace/diagnostic/refresh",
        "workspace/semanticTokens/refresh",
        "workspace/inlayHint/refresh",
        "workspace/codeLens/refresh",
      ];
      void this.send({
        jsonrpc: "2.0",
        id: message.id,
        ...(known.includes(message.method)
          ? { result }
          : { error: { code: -32601, message: "Unsupported server request" } }),
      }).catch((error) => this.failAll(error));
    }
  }

  private failAll(error: Error): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    this.killOwned("SIGTERM");
    this.termination = setTimeout(() => this.killOwned("SIGKILL"), 500);
    this.termination.unref();
  }
}

export function normalizeLocation(value: any): NormalizedLocation {
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.targetRange ?? value.range;
  const path = uriToFile(uri);
  const source = readFileSync(path, "utf8");
  const lines = source.split(/\r?\n/);
  const start = externalRangePosition(lines, range.start);
  const end = externalRangePosition(lines, range.end);
  return {
    path,
    sha256: sha256(source),
    location: {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
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
    output.push({
      name: item.name,
      kind: item.kind,
      path,
      sha256: digest,
      ...(container ? { container } : {}),
      location: {
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
      },
    });
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
  return {
    path,
    sha256: sha256(source),
    location: {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    severity: value.severity,
    code: value.code,
    source: value.source,
    message: String(value.message ?? "").slice(0, 1_000),
  };
}

export function hoverText(value: any): string {
  const contents = value?.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents))
    return contents.map(hoverText).filter(Boolean).join("\n");
  return contents?.value ?? value?.value ?? "";
}

function asArray(value: any): any[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

export function externalPosition(
  path: string,
  line: number,
  column: number,
): { line: number; character: number } {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  if (line < 1 || line > lines.length || column < 1)
    throw new Error("position is outside the file");
  const codePoints = Array.from(lines[line - 1]);
  if (column > codePoints.length + 1)
    throw new Error("position is outside the file");
  const prefix = codePoints.slice(0, column - 1).join("");
  return { line: line - 1, character: prefix.length };
}

function externalRangePosition(
  lines: string[],
  position: { line: number; character: number },
): { line: number; column: number } {
  const prefix = (lines[position.line] ?? "").slice(0, position.character);
  return { line: position.line + 1, column: Array.from(prefix).length + 1 };
}

function languageId(path: string): string {
  if (/\.tsx$/i.test(path)) return "typescriptreact";
  if (/\.ts$/i.test(path)) return "typescript";
  if (/\.jsx$/i.test(path)) return "javascriptreact";
  if (/\.[mc]?js$/i.test(path)) return "javascript";
  if (/\.py$/i.test(path)) return "python";
  if (/\.cs$/i.test(path)) return "csharp";
  if (/\.(c|h)$/i.test(path)) return "c";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(path)) return "cpp";
  if (/\.rs$/i.test(path)) return "rust";
  if (/\.go$/i.test(path)) return "go";
  return "plaintext";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function classifyTransportError(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPIPE" || code === "ECONNRESET"
    ? new LspTransportError(error.message, { cause: error })
    : error;
}
