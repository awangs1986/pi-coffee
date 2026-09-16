import { readJson, json } from "../shared/http.js";
import { Identity, type IdentityOptions } from "./identity.js";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServerFrame,
} from "../shared/protocol.js";
import { HostClient } from "./host-client.js";

/** PEM material for the optional HTTPS route (internal CA); HTTP when omitted. */
export interface TlsMaterial {
  cert: string | Buffer;
  key: string | Buffer;
}

export interface WebServerOptions {
  host?: string;
  port?: number;
  hostUrl: string;
  hostToken?: string;
  publicDir?: string;
  tls?: TlsMaterial;
  identity?: IdentityOptions;
  /** Deliberate single-user LAN/demo compatibility, never a multi-user deployment. */
  allowUnauthenticated?: boolean;
}

export interface WebAddress {
  host: string;
  port: number;
}

/** Browser-facing HTTP and WebSocket server. */
export class WebServer {
  private readonly host: string;
  private readonly port: number;
  private readonly hostUrl: string;
  private readonly hostToken?: string;
  private readonly publicDir: string;
  private readonly http: HttpServer;
  private readonly wsServer: WebSocketServer;
  private readonly bridges = new Set<BrowserBridge>();
  private readonly secure: boolean;
  private started = false;
  private readonly identity?: Identity;
  private readonly allowUnauthenticated: boolean;

  constructor(options: WebServerOptions) {
    this.allowUnauthenticated = options.allowUnauthenticated ?? false;
    this.identity = options.identity ? new Identity(options.identity) : undefined;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 3000;
    this.hostUrl = options.hostUrl;
    this.hostToken = options.hostToken;
    this.publicDir = options.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
    this.secure = options.tls !== undefined;
    const handler = (request: IncomingMessage, response: ServerResponse) => void this.handleHttp(request, response);
    this.http = options.tls ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, handler) : createServer(handler);
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.wsServer.on("connection", (socket, request) => {
      const route = (request as IncomingMessage & { coffeeRoute?: { hostUrl: string; hostToken: string } }).coffeeRoute;
      const bridge = new BrowserBridge(socket, { url: route?.hostUrl ?? this.hostUrl, token: route?.hostToken ?? this.hostToken });
      if (this.identity) {
        let checking = false;
        const timer = setInterval(async () => {
          if(checking) return; checking = true;
          try { if (!await this.identity!.authorize(request)) {
            if(route) await this.hostApi(route,"/api/revoke-files","POST",{}).catch(()=>undefined);
            bridge.close();
          } } finally { checking=false; }
        }, 5000);
        timer.unref(); socket.once("close", () => clearInterval(timer));
      }
      this.bridges.add(bridge);
      bridge.onClose = () => this.bridges.delete(bridge);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    if(!this.identity && !this.allowUnauthenticated && !["127.0.0.1","::1","localhost"].includes(this.host))throw new Error("Public Web binding requires Gitea identity. Explicit single-user demo mode is not multi-user isolation.");
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        this.http.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off("error", onError);
        resolvePromise();
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    this.started = true;
  }

  address(): WebAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") throw new Error("WebServer is not listening");
    return { host: this.host, port: address.port };
  }

  /** `https` when started with TLS material, otherwise `http`. */
  get scheme(): "http" | "https" {
    return this.secure ? "https" : "http";
  }

  async close(): Promise<void> {
    if (!this.started) return;
    for (const bridge of this.bridges) bridge.close();
    this.bridges.clear();
    this.wsServer.close();
    await new Promise<void>((resolvePromise, reject) => {
      this.http.close((error) => (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ? reject(error)
        : resolvePromise()));
    });
    this.started = false;
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, role: "web" }));
      return;
    }
    if(path === "/auth/logout" && request.method === "POST" && this.identity?.originAllowed(request)) {
      const session=await this.identity.authorize(request);
      if(session) await this.hostApi(session.route,"/api/revoke-files","POST",{}).catch(()=>undefined);
    }
    if (this.identity && await this.identity.handle(request, response)) return;
    if(path === "/api/workspace") {
      try {
        const session=await this.identity?.authorize(request);
        if(this.identity && !session) {json(response,401,{error:"Login required"});return;}
        if(request.method === "POST" && (this.identity ? !this.identity.originAllowed(request) : request.headers.origin !== `${this.scheme}://${request.headers.host}`)) {json(response,403,{error:"Invalid origin"});return;}
        if(!["GET","POST"].includes(request.method ?? "")) {json(response,405,{error:"Method not allowed"});return;}
        const route=session?.route ?? {hostUrl:this.hostUrl,hostToken:this.hostToken ?? ""};
        const result=await this.hostApi(route,path,request.method!,request.method==="POST" ? await readJson(request) : undefined);
        json(response,result.status,await result.json());
      } catch {json(response,502,{error:"VM unavailable or invalid request"});}
      return;
    }
    if (this.identity && (path === "/" || path === "/index.html") && !await this.identity.authorize(request)) {
      response.writeHead(302,{location:"/auth/login"});response.end();return;
    }
    const asset = resolveAsset(path);
    if (asset === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const body = await readFile(resolve(this.publicDir, asset.file));
      response.writeHead(200, { "content-type": asset.contentType, "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(asset.file === "index.html" ? 500 : 404, { "content-type": "text/plain; charset=utf-8" });
      response.end(asset.file === "index.html" ? "PI Coffee shell is not installed" : "Not found");
    }
  }

  private hostApi(route: { hostUrl:string;hostToken:string }, path:string, method:string, value?:unknown) {
    const url=new URL(route.hostUrl);url.protocol=url.protocol==="wss:" ? "https:" : "http:";url.pathname=path;url.search="";
    return fetch(url,{method,headers:{authorization:`Bearer ${route.hostToken}`,"content-type":"application/json"},...(value===undefined ? {} : {body:JSON.stringify(value)}),signal:AbortSignal.timeout(125000),redirect:"error"});
  }

  private async handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): Promise<void> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.destroy();
      return;
    }
    if (this.identity) {
      if (!this.identity.originAllowed(request)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      const session = await this.identity.authorize(request);
      if (!session) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
      try {
        const readiness=await this.hostApi(session.route,"/api/workspace","GET");
        await readiness.body?.cancel();
        if(!readiness.ok)throw new Error("VM workspace mode required");
      } catch {socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");return;}
      (request as IncomingMessage & { coffeeRoute?: unknown }).coffeeRoute = session.route;
    }
    this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.wsServer.emit("connection", websocket, request);
    });
  }
}

interface BrowserBridgeOptions {
  url: string;
  token?: string;
}

class BrowserBridge {
  private readonly browser: WebSocket;
  private readonly host: HostClient;
  private hostUnsubscribe?: () => void;
  private connected = false;
  private opened = false;
  private closed = false;
  private messageQueue: Promise<void> = Promise.resolve();
  onClose: () => void = () => undefined;

  constructor(browser: WebSocket, options: BrowserBridgeOptions) {
    this.browser = browser;
    this.host = new HostClient({
      ...options,
      onUnavailable: (error) => {
        this.send({ v: 1, type: "error", code: "host_unavailable", message: error.message });
        this.close();
      },
    });
    browser.on("message", (data: RawData) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data)).catch(() => undefined);
    });
    browser.on("close", () => this.close());
    browser.on("error", () => this.close());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hostUnsubscribe?.();
    this.hostUnsubscribe = undefined;
    this.host.close();
    if (this.browser.readyState !== WebSocket.CLOSED) this.browser.close();
    this.onClose();
  }

  private send(frame: ServerFrame): void {
    if (this.closed || this.browser.readyState !== WebSocket.OPEN) return;
    try {
      this.browser.send(encodeFrame(frame));
    } catch {
      this.close();
    }
  }

  private async handleMessage(data: RawData): Promise<void> {
    if (this.closed) return;
    let frame: ClientFrame;
    try {
      frame = decodeClientFrame(rawDataToBytes(data));
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: error instanceof Error && "code" in error ? String(error.code) : "invalid_frame",
        message: error instanceof Error ? error.message : "Invalid frame",
        fatal: true,
      });
      this.browser.close(1008, "invalid frame");
      return;
    }

    if (frame.type === "close") {
      this.close();
      return;
    }
    if (frame.type === "ping") {
      this.send({ v: 1, type: "pong", nonce: frame.nonce });
      return;
    }
    // Sidebar commands may arrive before a session is chosen; everything else
    // needs an open Session on the Host.
    const sidebarCommand = frame.type === "list_sessions" || frame.type === "delete_session" || frame.type === "rename_session";
    if (frame.type !== "open" && !sidebarCommand && !this.opened) {
      this.send({ v: 1, type: "error", code: "not_open", message: "Send open before other commands" });
      return;
    }

    try {
      if (frame.type === "open" && this.opened) {
        this.send({ v: 1, type: "error", code: "already_open", message: "Connection is already open" });
        return;
      }
      if (!this.connected) {
        await this.host.connect();
        this.hostUnsubscribe = this.host.onFrame((hostFrame) => this.send(hostFrame));
        this.connected = true;
      }
      if (frame.type === "open") this.opened = true;
      this.host.send(frame);
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: "host_unavailable",
        message: error instanceof Error ? error.message : "Host is unavailable",
      });
    }
  }
}

const ASSET_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

/**
 * The shell is a flat set of files directly under `public/`. Only a single
 * safe path segment with a known extension is served, so `..`, nested paths,
 * and anything else never reach the filesystem.
 */
function resolveAsset(path: string): { file: string; contentType: string } | undefined {
  if (path === "/" || path === "/index.html") return { file: "index.html", contentType: ASSET_TYPES.html };
  const match = /^\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(path);
  if (match === null) return undefined;
  const contentType = ASSET_TYPES[match[2]];
  if (contentType === undefined) return undefined;
  return { file: `${match[1]}.${match[2]}`, contentType };
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}
