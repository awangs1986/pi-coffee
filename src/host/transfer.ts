import type { Workspaces } from "./workspaces.js";
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, readdir, rm, stat, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { JsonValue } from "../shared/protocol.js";

/**
 * LocalSend v2 transfer API (https://github.com/localsend/protocol) served by
 * the Agent Host on the User VM's LAN interface (ADR-0009). Browsers speak it
 * with plain fetch; the Web Server never sees a file byte. Discovery,
 * fingerprints and PINs are deliberately absent: the browser always knows its
 * target, and access is scoped by a token the Host issues per open Session.
 */
export interface TransferServerOptions {
  host?: string;
  port?: number;
  /** Pi's working directory; uploads land under `<workdir>/.pi-coffee/inbox/<scope>/`. */
  workdir: string;
  workspaces?: Workspaces;
  allowUnscoped?: boolean;
  /** Address browsers should use to reach this server. Auto-detected LAN IPv4 when omitted. */
  advertiseHost?: string;
  alias?: string;
  maxFileBytes?: number;
  maxBatchBytes?: number;
  /** Transfer lifecycle events for a scope (a Session id), forwarded to its browsers. */
  onEvent?: (scope: string, event: JsonValue) => void;
  /**
   * Optional HTTPS route: a certificate browsers trust (internal CA). Plain
   * HTTP is the 0.1 default; see the runbook for the all-or-nothing rule with
   * the Web Server's scheme (mixed content).
   */
  tls?: { cert: string | Buffer; key: string | Buffer };
}

export const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_BATCH_BYTES = 1024 * 1024 * 1024;
export const INBOX_DIR = join(".pi-coffee", "inbox");
const API = "/api/localsend/v2";
const PROGRESS_INTERVAL_MS = 200;

interface PendingFile {
  id: string;
  token: string;
  fileName: string;
  size: number;
  fileType: string;
  sha256?: string;
  finalPath: string;
  partPath: string;
  state: "pending" | "uploading" | "done" | "failed";
}

interface UploadSession {
  id: string;
  scope: string;
  files: Map<string, PendingFile>;
  createdAt: number;
}

export class TransferServer {
  private readonly host: string;
  private readonly port: number;
  private readonly workdir: string;
  private readonly advertiseHost?: string;
  private readonly alias: string;
  private readonly maxFileBytes: number;
  private readonly maxBatchBytes: number;
  private readonly onEvent?: (scope: string, event: JsonValue) => void;
  private readonly http: HttpServer;
  private readonly tokenExpiry = new Map<string, number>();
  private readonly tokens = new Map<string, string>();        // scope -> token
  private readonly uploads = new Map<string, UploadSession>(); // upload session id -> session
  private readonly fingerprint: string;
  private readonly secure: boolean;
  private started = false;
  private readonly workspaces?: Workspaces;
  private readonly allowUnscoped: boolean;

  constructor(options: TransferServerOptions) {
    this.host = options.host ?? "0.0.0.0";
    this.port = options.port ?? 53317;
    this.workdir = resolve(options.workdir);
    this.workspaces=options.workspaces;
    this.allowUnscoped=options.allowUnscoped ?? false;
    this.advertiseHost = options.advertiseHost;
    this.alias = options.alias ?? "PI Coffee";
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    this.onEvent = options.onEvent;
    this.secure = options.tls !== undefined;
    // LocalSend convention: over HTTPS the fingerprint is the certificate's SHA-256.
    this.fingerprint = options.tls ? new X509Certificate(options.tls.cert).fingerprint256.replace(/:/g, "").toLowerCase() : randomBytes(16).toString("hex");
    const handler = (request: IncomingMessage, response: ServerResponse) => void this.handle(request, response).catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { message: error instanceof Error ? error.message : "Unknown error" });
      else response.destroy();
    });
    this.http = options.tls ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, handler) : createServer(handler);
    this.http.requestTimeout = 0; // large uploads
  }

  async start(): Promise<void> {
    if (this.started) return;
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => { this.http.off("listening", onListening); reject(error); };
      const onListening = () => { this.http.off("error", onError); resolvePromise(); };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    this.started = true;
  }

  async close(): Promise<void> {
    if (!this.started) return;
    this.http.closeAllConnections();
    await new Promise<void>((resolvePromise, reject) => this.http.close((error) => (error ? reject(error) : resolvePromise())));
    this.started = false;
  }

  address(): { host: string; port: number } {
    const address = this.http.address();
    if (address === null || typeof address === "string") throw new Error("TransferServer is not listening");
    return { host: this.host, port: address.port };
  }

  /** Base URL a browser on the LAN should use. */
  publicUrl(): string {
    const host = this.advertiseHost ?? detectLanAddress() ?? "127.0.0.1";
    return `${this.secure ? "https" : "http"}://${host}:${this.address().port}`;
  }

  /** The token a browser presents for this scope (Session); stable while the Host runs. */
  issueToken(scope: string): string {
    this.tokenExpiry.set(scope,Date.now()+45000);
    const existing = this.tokens.get(scope);
    if (existing) return existing;
    const token = randomBytes(24).toString("hex");
    this.tokens.set(scope, token);
    return token;
  }

  revokeAll(): void { this.tokens.clear(); this.tokenExpiry.clear(); this.uploads.clear(); }

  async importPath(scope:string,file:string):Promise<string> {
    const base=await realpath(join(this.workdir,this.inboxFor(scope)));
    const full=await realpath(resolve(base,file));
    if(!full.startsWith(base+sep) || !full.toLowerCase().endsWith('.zip'))throw new Error("Only a ZIP in the conversation inbox can be imported");
    return full;
  }

  inboxFor(scope: string): string {
    return join(INBOX_DIR, safeScope(scope));
  }

  get limits(): { maxFileBytes: number; maxBatchBytes: number } {
    return { maxFileBytes: this.maxFileBytes, maxBatchBytes: this.maxBatchBytes };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Cross-origin by design: the page comes from the Web Server, the bytes go here.
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-expose-headers", "content-disposition, content-length");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }

    const url = new URL(request.url ?? "/", "http://transfer.local");
    const path = url.pathname;
    if (path === "/healthz") { sendJson(response, 200, { ok: true, role: "transfer" }); return; }
    if (!path.startsWith(API + "/")) { sendJson(response, 404, { message: "Not found" }); return; }
    const route = path.slice(API.length + 1);

    if(route === "tree" || route === "artifacts" || route === "preview" || route === "workspace-download") {
      const scope=this.scopeOf(url);
      if(!scope || scope==="shared" || !this.workspaces) {sendJson(response,401,{message:"Authorized workspace required"});return;}
      try {
        const path=url.searchParams.get("path") ?? "";
        if(route==="artifacts") {sendJson(response,200,{artifacts:await this.workspaces.artifacts(scope)} as unknown as JsonValue);return;}
        if(route==="tree") {sendJson(response,200,await this.workspaces.tree(scope,path) as unknown as JsonValue);return;}
        const full=await this.workspaces.file(scope,path);const info=await stat(full);
        if(!info.isFile())throw new Error("Not a file");
        if(route==="preview" && info.size>10*1024*1024) {sendJson(response,413,{message:"Preview exceeds 10 MiB; download instead"});return;}
        const mime=mimeFor(full);const inline=route==="preview" && /^(image\/|text\/plain|text\/markdown|application\/pdf)/.test(mime);
        response.writeHead(200,{"content-type":mime,"content-length":String(info.size),"x-content-type-options":"nosniff","content-security-policy":"sandbox; default-src 'none'; style-src 'unsafe-inline'", "referrer-policy":"no-referrer","cache-control":"no-store","content-disposition":`${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(basename(full))}`});
        createReadStream(full).on("error",()=>response.destroy()).pipe(response);
      } catch {sendJson(response,403,{message:"File unavailable or outside workspace"});}
      return;
    }
    switch (route) {
      case "info":
      case "register":
        sendJson(response, 200, this.info());
        return;
      case "prepare-upload":
        if (request.method !== "POST") return methodNotAllowed(response);
        await this.prepareUpload(request, response, url);
        return;
      case "upload":
        if (request.method !== "POST") return methodNotAllowed(response);
        await this.upload(request, response, url);
        return;
      case "cancel":
        if (request.method !== "POST") return methodNotAllowed(response);
        await this.cancel(response, url);
        return;
      case "prepare-download":
        if (request.method !== "POST" && request.method !== "GET") return methodNotAllowed(response);
        await this.prepareDownload(response, url);
        return;
      case "download":
        if (request.method !== "GET") return methodNotAllowed(response);
        await this.download(response, url);
        return;
      default:
        sendJson(response, 404, { message: "Not found" });
    }
  }

  private info(): JsonValue {
    return {
      alias: this.alias,
      version: "2.0",
      deviceModel: "PI Coffee Host",
      deviceType: "server",
      fingerprint: this.fingerprint,
      port: this.address().port,
      protocol: this.secure ? "https" : "http",
      download: true,
    };
  }

  /** Resolve the scope for a request: token-scoped, or "shared" when a plain LocalSend client comes by. */
  private scopeOf(url: URL): string | null {
    const scope = url.searchParams.get("scope");
    const token = url.searchParams.get("token");
    if (scope === null && token === null) return this.allowUnscoped ? "shared" : null;
    if (scope === null || token === null) return null;
    return this.tokens.get(scope) === token && (!this.workspaces || (this.tokenExpiry.get(scope) ?? 0)>Date.now()) ? scope : null;
  }

  private async prepareUpload(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const scope = this.scopeOf(url);
    if (scope === null) { sendJson(response, 401, { message: "Invalid scope token" }); return; }
    let body: unknown;
    try {
      body = JSON.parse((await readAll(request, 1024 * 1024)).toString("utf8"));
    } catch {
      sendJson(response, 400, { message: "Invalid body" });
      return;
    }
    const files = isRecord(body) && isRecord(body.files) ? body.files : null;
    if (!files || Object.keys(files).length === 0) { sendJson(response, 400, { message: "Invalid body: files" }); return; }

    const targetDir = join(this.workdir, this.inboxFor(scope));
    await mkdir(targetDir, { recursive: true });
    const session: UploadSession = { id: randomUUID(), scope, files: new Map(), createdAt: Date.now() };
    const usedNames = new Set(await readdir(targetDir).catch(() => [] as string[]));
    let batch = 0;
    for (const [id, raw] of Object.entries(files)) {
      if (!isRecord(raw)) { sendJson(response, 400, { message: `Invalid file ${id}` }); return; }
      const size = typeof raw.size === "number" && Number.isSafeInteger(raw.size) && raw.size >= 0 ? raw.size : -1;
      if (size < 0) { sendJson(response, 400, { message: `Invalid size for ${id}` }); return; }
      if (size > this.maxFileBytes) { sendJson(response, 403, { message: `File exceeds ${this.maxFileBytes} bytes` }); return; }
      batch += size;
      if (batch > this.maxBatchBytes) { sendJson(response, 403, { message: `Batch exceeds ${this.maxBatchBytes} bytes` }); return; }
      const fileName = uniqueName(sanitizeFileName(typeof raw.fileName === "string" ? raw.fileName : id), usedNames);
      usedNames.add(fileName);
      const sha256 = typeof raw.sha256 === "string" && /^[0-9a-f]{64}$/i.test(raw.sha256) ? raw.sha256.toLowerCase() : undefined;
      const token = randomBytes(16).toString("hex");
      session.files.set(id, {
        id,
        token,
        fileName,
        size,
        fileType: typeof raw.fileType === "string" ? raw.fileType : "application/octet-stream",
        ...(sha256 === undefined ? {} : { sha256 }),
        finalPath: join(targetDir, fileName),
        partPath: join(targetDir, `.${fileName}.${token.slice(0, 8)}.part`),
        state: "pending",
      });
    }
    this.uploads.set(session.id, session);
    const tokens: Record<string, string> = {};
    for (const [id, file] of session.files) tokens[id] = file.token;
    sendJson(response, 200, { sessionId: session.id, files: tokens });
  }

  private async upload(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    const fileId = url.searchParams.get("fileId");
    const token = url.searchParams.get("token");
    if (!sessionId || !fileId || !token) { sendJson(response, 400, { message: "Missing parameters" }); return; }
    const session = this.uploads.get(sessionId);
    const file = session?.files.get(fileId);
    if (!session || !file || file.token !== token) { sendJson(response, 403, { message: "Invalid token" }); return; }
    if (file.state === "uploading" || file.state === "done") { sendJson(response, 409, { message: "Already uploading or completed" }); return; }
    if (this.workspaces && (this.tokenExpiry.get(session.scope) ?? 0) <= Date.now()) {
      sendJson(response, 403, { message: "File authorization expired; refresh the workspace and retry" }); return;
    }
    file.state = "uploading";

    const hash = createHash("sha256");
    let received = 0;
    let lastProgress = 0;
    const scope = session.scope;
    const fail = async (status: number, message: string) => {
      file.state = "failed";
      await rm(file.partPath, { force: true }).catch(() => undefined);
      this.emit(scope, { type: "transfer_failed", sessionId: session.id, fileId: file.id, fileName: file.fileName, message });
      if (!response.headersSent) sendJson(response, status, { message });
      else response.destroy();
    };

    const out = createWriteStream(file.partPath);
    try {
      await new Promise<void>((resolvePromise, reject) => {
        request.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > file.size || received > this.maxFileBytes) {
            request.destroy();
            reject(new UploadError(413, "More bytes than declared"));
            return;
          }
          hash.update(chunk);
          if (!out.write(chunk)) request.pause();
          const now = Date.now();
          if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
            lastProgress = now;
            this.emit(scope, { type: "transfer_progress", sessionId: session.id, fileId: file.id, fileName: file.fileName, received, size: file.size });
          }
        });
        out.on("drain", () => request.resume());
        request.on("end", () => out.end());
        request.on("error", (error) => reject(new UploadError(400, error.message)));
        request.on("aborted", () => reject(new UploadError(400, "Upload aborted")));
        out.on("finish", () => resolvePromise());
        out.on("error", (error) => reject(new UploadError(500, error.message)));
      });
    } catch (error) {
      out.destroy();
      const status = error instanceof UploadError ? error.status : 500;
      await fail(status, error instanceof Error ? error.message : "Upload failed");
      return;
    }

    if (this.workspaces && (this.tokenExpiry.get(session.scope) ?? 0)<=Date.now()) {await fail(403,"File authorization expired; refresh the workspace and retry");return;}
    if (!this.uploads.has(session.id)) { await fail(403,"Upload authorization revoked"); return; }
    if (received !== file.size) { await fail(400, `Expected ${file.size} bytes, received ${received}`); return; }
    const digest = hash.digest("hex");
    if (file.sha256 !== undefined && file.sha256 !== digest) { await fail(422, "Checksum mismatch (sha256)"); return; }
    try {
      await this.publishUpload(file);
    } catch (error) {
      await fail(500, error instanceof Error ? error.message : "Upload publication failed");
      return;
    }
    file.state = "done";
    this.emit(scope, {
      type: "transfer_complete",
      sessionId: session.id,
      fileId: file.id,
      fileName: file.fileName,
      path: relative(this.workdir, file.finalPath).split(sep).join("/"),
      size: file.size,
      sha256: digest,
      fileType: file.fileType,
    });
    response.writeHead(200);
    response.end();
    if ([...session.files.values()].every((f) => f.state === "done" || f.state === "failed")) this.uploads.delete(session.id);
  }

  /** Publish complete bytes without replacing another upload or a user's file. */
  private async publishUpload(file: PendingFile): Promise<void> {
    const dir = resolve(file.finalPath, "..");
    const originalName = file.fileName;
    const used = new Set<string>();
    for (;;) {
      try {
        // Both paths are in the same inbox. link is atomic and fails if the destination exists.
        await link(file.partPath, file.finalPath);
        await rm(file.partPath, { force: true });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        used.add(file.fileName);
        for (const name of await readdir(dir)) used.add(name);
        file.fileName = uniqueName(originalName, used);
        file.finalPath = join(dir, file.fileName);
      }
    }
  }

  private async cancel(response: ServerResponse, url: URL): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId ? this.uploads.get(sessionId) : undefined;
    if (session && (this.allowUnscoped || this.scopeOf(url) === session.scope)) {
      for (const file of session.files.values()) {
        if (file.state !== "done") {
          file.state = "failed";
          await rm(file.partPath, { force: true }).catch(() => undefined);
        }
      }
      this.uploads.delete(session.id);
    }
    response.writeHead(200);
    response.end();
  }

  /** Lists the scope's inbox (LocalSend download API shape); fileId is the workdir-relative path. */
  private async prepareDownload(response: ServerResponse, url: URL): Promise<void> {
    const scope = this.scopeOf(url);
    if (scope === null) { sendJson(response, 401, { message: "Invalid scope token" }); return; }
    const dir = join(this.workdir, this.inboxFor(scope));
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: Record<string, JsonValue> = {};
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      const info = await stat(full);
      const id = relative(this.workdir, full).split(sep).join("/");
      files[id] = { id, fileName: entry.name, size: info.size, fileType: mimeFor(entry.name), modified: info.mtime.toISOString() };
    }
    sendJson(response, 200, { info: this.info(), sessionId: scope, files });
  }

  /** Streams any file under the working directory (inbox or agent output). */
  private async download(response: ServerResponse, url: URL): Promise<void> {
    const scope = this.scopeOf(url);
    if (scope === null) { sendJson(response, 401, { message: "Invalid scope token" }); return; }
    const fileId = url.searchParams.get("fileId");
    if (!fileId) { sendJson(response, 400, { message: "Missing fileId" }); return; }
    let full: string;
    try {
      if(this.workspaces && !fileId.startsWith(this.inboxFor(scope)+"/")) full=await this.workspaces.file(scope,fileId);
      else {
        full=await realpath(resolve(this.workdir,fileId));
        const base=await realpath(this.workspaces ? join(this.workdir,this.inboxFor(scope)) : this.workdir);
        if(!full.startsWith(base+sep))throw new Error("Outside download scope");
      }
    } catch(e) {sendJson(response,(e as NodeJS.ErrnoException).code==="ENOENT" ? 404 : 403,{message:"File unavailable or outside download scope"});return;}
    if (!this.workspaces && full !== this.workdir && !full.startsWith(this.workdir + sep)) { sendJson(response, 403, { message: "Outside the working directory" }); return; }
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) { sendJson(response, 404, { message: "Not found" }); return; }
    response.writeHead(200, {
      "content-type": mimeFor(full),
      "content-length": String(info.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(full))}`,
      "cache-control": "no-store",
    });
    createReadStream(full).pipe(response);
  }

  private emit(scope: string, event: JsonValue): void {
    try { this.onEvent?.(scope, event); } catch { /* browsers are best-effort observers */ }
  }
}

class UploadError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function sanitizeFileName(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  const cleaned = base.replace(/^\.+/, "").slice(0, 180);
  return cleaned.length === 0 ? "file" : cleaned;
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function safeScope(scope: string): string {
  return scope.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "shared";
}

const MIME: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".json": "application/json", ".csv": "text/csv",
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".zip": "application/zip", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".ts": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
};
function mimeFor(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
}

function detectLanAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

function readAll(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) { request.destroy(); reject(new Error("Body too large")); return; }
      chunks.push(chunk);
    });
    request.on("end", () => resolvePromise(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(response: ServerResponse): void {
  sendJson(response, 405, { message: "Method not allowed" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
