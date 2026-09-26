import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CodexSessionFactory } from "./host/codex-adapter.js";
import { HostServer, type UserScope } from "./host/server.js";
import { RpcPiSessionFactory, type PiSessionFactory } from "./host/pi-adapter.js";
import { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_FILE_BYTES, TransferServer } from "./host/transfer.js";
import { resolvePiExtensions } from "./pi-extensions.js";
import { RelayServer } from "./relay/server.js";
import { normalizeUsername, parseAllowedUsers } from "./shared/identity.js";
import { GiteaAuth } from "./web/auth.js";
import { WebServer } from "./web/server.js";

type Role = "host" | "web" | "relay" | "all";

const role = process.argv[2] ?? "all";

if (role !== "host" && role !== "web" && role !== "relay" && role !== "all") {
  console.error(`Usage: node dist/src/main.js [host|web|relay|all]`);
  process.exitCode = 2;
} else {
  void run(role).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function run(selectedRole: Role): Promise<void> {
  // The Relay is the only process that may hold upstream credentials. `all`
  // starts it when either the LLM key or the Serper key is configured; the
  // generic LLM routes remain unavailable when only search is enabled.
  const upstreamKey = process.env.PI_COFFEE_UPSTREAM_KEY ?? "";
  const serperKey = process.env.PI_COFFEE_SERPER_KEY ?? "";
  const wantRelay = selectedRole === "relay" || (selectedRole === "all" && (upstreamKey.length > 0 || serperKey.length > 0));
  const relay = !wantRelay ? undefined : new RelayServer({
    host: envString("PI_COFFEE_RELAY_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_RELAY_PORT", 8789),
    upstreamBaseUrl: envString("PI_COFFEE_UPSTREAM_URL", "https://b.awangsawangs.xyz/v1"),
    upstreamKey,
    serperApiKey: serperKey,
    serperEndpoint: process.env.PI_COFFEE_SERPER_ENDPOINT,
    clientTokens: envList("PI_COFFEE_RELAY_TOKENS"),
    upstreamHeadersTimeoutMs: envNumber("PI_COFFEE_RELAY_TIMEOUT_MS", 60_000),
    maxRequestBytes: envNumber("PI_COFFEE_RELAY_MAX_REQUEST_BYTES", 32 * 1024 * 1024),
    onRecord: (record) => {
      if (process.env.PI_COFFEE_RELAY_LOG === "0") return;
      console.log(JSON.stringify({ relay: record }));
    },
  });
  if (relay) await relay.start();

  const wantHost = selectedRole !== "web" && selectedRole !== "relay";
  const workdir = process.env.PI_COFFEE_WORKDIR ?? process.cwd();
  // Optional HTTPS route (internal CA). 0.1 runs plain HTTP; when a
  // certificate is given, both browser-facing surfaces must use one, because a
  // browser on an https page refuses plain-http transfers as mixed content.
  const webTls = loadTls("PI_COFFEE_WEB_TLS_CERT", "PI_COFFEE_WEB_TLS_KEY");
  const transferTls = loadTls("PI_COFFEE_TRANSFER_TLS_CERT", "PI_COFFEE_TRANSFER_TLS_KEY");
  if (selectedRole === "all" && (webTls === undefined) !== (transferTls === undefined)) {
    throw new Error("Set TLS for both the Web Server and the transfer port, or for neither (browsers block mixed content)");
  }
  // File transfer (ADR-0009): the Host speaks LocalSend v2 on the User VM's LAN
  // interface so browsers move files without touching the Web Server.
  let host: HostServer | undefined;
  const transferBind = envString("PI_COFFEE_TRANSFER_BIND", "0.0.0.0");
  const transfer = !wantHost || transferBind === "off" ? undefined : new TransferServer({
    host: transferBind,
    port: envNumber("PI_COFFEE_TRANSFER_PORT", 53317),
    workdir,
    advertiseHost: process.env.PI_COFFEE_TRANSFER_ADVERTISE,
    alias: envString("PI_COFFEE_TRANSFER_ALIAS", "PI Coffee"),
    maxFileBytes: envNumber("PI_COFFEE_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES),
    maxBatchBytes: envNumber("PI_COFFEE_MAX_BATCH_BYTES", DEFAULT_MAX_BATCH_BYTES),
    onEvent: (scope, event) => host?.announce(scope, event),
    ...(transferTls === undefined ? {} : { tls: transferTls }),
  });
  if (transfer) await transfer.start();

  // One shared User VM, one model login, one Host (ADR-0010). Each Gitea user
  // the Web Server forwards gets a private cwd and session store under the
  // shared roots; the agent dir (model account, models.json) stays common.
  const piOptions = {
    agentDir: process.env.PI_COFFEE_AGENT_DIR,
    provider: process.env.PI_COFFEE_PROVIDER,
    model: process.env.PI_COFFEE_MODEL,
    extensions: resolvePiExtensions(),
  };
  const sessionRoot = process.env.PI_COFFEE_SESSION_DIR?.trim();
  // Which agent runs behind the seam (ADR-0011): the original Pi (default) or
  // Codex CLI's app-server. Both are logged in once, in the VM, by its owner.
  const agent = envString("PI_COFFEE_AGENT", "pi").toLowerCase();
  if (agent !== "pi" && agent !== "codex") throw new Error("PI_COFFEE_AGENT must be pi or codex");
  const codexSandbox = envString("PI_COFFEE_CODEX_SANDBOX", "danger-full-access");
  const codexApproval = envString("PI_COFFEE_CODEX_APPROVAL", "never");
  if (!["read-only", "workspace-write", "danger-full-access"].includes(codexSandbox)) throw new Error("PI_COFFEE_CODEX_SANDBOX must be read-only, workspace-write or danger-full-access");
  if (!["never", "on-request", "untrusted"].includes(codexApproval)) throw new Error("PI_COFFEE_CODEX_APPROVAL must be never, on-request or untrusted");
  const idleTimeoutMs = envNumber("PI_COFFEE_IDLE_TIMEOUT_MS", 10 * 60 * 1000);
  const factoryFor = (cwd: string, sessionDir: string | undefined, perUser: boolean): PiSessionFactory => {
    if (agent === "codex") {
      return new CodexSessionFactory({
        cwd,
        // The id map is session bookkeeping: keep it out of the directory the agent edits.
        mappingFile: join(sessionDir ?? join(cwd, ".pi-coffee"), "codex-threads.json"),
        idleTimeoutMs,
        cliPath: process.env.PI_COFFEE_CODEX_BIN?.trim() || undefined,
        codexHome: process.env.PI_COFFEE_CODEX_HOME?.trim() || undefined,
        model: process.env.PI_COFFEE_MODEL?.trim() || undefined,
        reasoningEffort: process.env.PI_COFFEE_CODEX_EFFORT?.trim() || undefined,
        sandbox: codexSandbox as "read-only" | "workspace-write" | "danger-full-access",
        approvalPolicy: codexApproval as "never" | "on-request" | "untrusted",
        args: envList("PI_COFFEE_CODEX_ARGS", ":"),
      });
    }
    return new RpcPiSessionFactory({
      ...piOptions,
      cwd,
      ...(sessionDir === undefined ? {} : { sessionDir }),
      // Research closures are user content too; keep them beside the user's work.
      env: perUser && !process.env.PI_COFFEE_RESEARCH_DIR ? { PI_COFFEE_RESEARCH_DIR: join(cwd, ".pi-coffee", "research") } : {},
    });
  };
  const scopeForUser = async (user: string): Promise<UserScope> => {
    const cwd = resolve(workdir, user);
    await mkdir(cwd, { recursive: true });
    const sessionDir = sessionRoot ? join(sessionRoot, user) : undefined;
    if (sessionDir !== undefined) await mkdir(sessionDir, { recursive: true });
    return { workdir: cwd, factory: factoryFor(cwd, sessionDir, true) };
  };
  host = !wantHost ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    idleTimeoutMs,
    requireUser: envFlag("PI_COFFEE_REQUIRE_USER"),
    transfer,
    factory: factoryFor(workdir, sessionRoot, false),
    scopeForUser,
  });
  if (host) await host.start();

  // Gitea OAuth is on as soon as the app credentials are configured. Without
  // them the shell is open (local smoke); PI_COFFEE_DEFAULT_USER can still
  // exercise the per-user layout on the Host.
  const giteaUrl = process.env.PI_COFFEE_GITEA_URL?.trim();
  const giteaClientId = process.env.PI_COFFEE_GITEA_CLIENT_ID?.trim();
  const giteaClientSecret = process.env.PI_COFFEE_GITEA_CLIENT_SECRET?.trim();
  const wantWeb = selectedRole !== "host" && selectedRole !== "relay";
  let auth: GiteaAuth | undefined;
  if (wantWeb && (giteaUrl || giteaClientId || giteaClientSecret)) {
    if (!giteaUrl || !giteaClientId || !giteaClientSecret) {
      throw new Error("Set PI_COFFEE_GITEA_URL, PI_COFFEE_GITEA_CLIENT_ID and PI_COFFEE_GITEA_CLIENT_SECRET together");
    }
    const allowedUsers = parseAllowedUsers(process.env.PI_COFFEE_ALLOWED_USERS);
    if (allowedUsers.length === 0) throw new Error("PI_COFFEE_ALLOWED_USERS must list at least one Gitea login when Gitea login is enabled");
    const cookieSecret = process.env.PI_COFFEE_COOKIE_SECRET?.trim();
    if (!cookieSecret) console.warn("PI_COFFEE_COOKIE_SECRET is not set: everyone must log in again after each Web Server restart");
    // The OAuth redirect URI and the cookie's Secure flag derive from this; it
    // must not come from whatever Host header a client sends.
    const publicUrl = process.env.PI_COFFEE_PUBLIC_URL?.trim();
    if (!publicUrl || !/^https?:\/\//.test(publicUrl)) throw new Error("PI_COFFEE_PUBLIC_URL (http(s)://host[:port] browsers use) is required when Gitea login is enabled");
    auth = new GiteaAuth({
      giteaUrl,
      clientId: giteaClientId,
      clientSecret: giteaClientSecret,
      allowedUsers,
      publicUrl,
      cookieSecret,
    });
  }
  const defaultUser = normalizeUsername(process.env.PI_COFFEE_DEFAULT_USER);
  if (process.env.PI_COFFEE_DEFAULT_USER?.trim() && defaultUser === undefined) {
    throw new Error("PI_COFFEE_DEFAULT_USER must be a plain login name (letters, digits, . - _)");
  }

  const web = !wantWeb ? undefined : new WebServer({
    host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_WEB_PORT", 3000),
    hostUrl: process.env.PI_COFFEE_HOST_URL ?? `ws://127.0.0.1:${host?.address().port ?? envNumber("PI_COFFEE_HOST_PORT", 8788)}/host`,
    hostToken: process.env.PI_COFFEE_HOST_TOKEN,
    ...(webTls === undefined ? {} : { tls: webTls }),
    ...(auth === undefined ? {} : { auth }),
    ...(auth !== undefined || defaultUser === undefined ? {} : { defaultUser }),
  });
  if (web) await web.start();

  const shutdown = async () => {
    await web?.close();
    await host?.close();
    await transfer?.close();
    await relay?.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  const addresses = [
    relay ? `Relay http://${relay.address().host}:${relay.address().port}/v1` : undefined,
    host ? `Host ws://${host.address().host}:${host.address().port}/host (agent: ${agent})` : undefined,
    transfer ? `Transfer ${transfer.publicUrl()}/api/localsend/v2 (LocalSend v2, inbox ${transfer.inboxFor("<session>").split("\\").join("/")})` : undefined,
    web ? `Web ${web.scheme}://${web.address().host}:${web.address().port}/${auth ? " (Gitea login on)" : defaultUser ? ` (user ${defaultUser})` : ""}` : undefined,
  ].filter((address): address is string => address !== undefined);
  for (const address of addresses) console.log(address);
}

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** Reads a PEM certificate/key pair named by two env vars; undefined when neither is set. */
function loadTls(certVar: string, keyVar: string): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env[certVar]?.trim();
  const keyPath = process.env[keyVar]?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) throw new Error(`${certVar} and ${keyVar} must be set together`);
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

function envFlag(name: string): boolean {
  return ["1", "on", "true", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function envList(name: string, separator = ","): string[] {
  return (process.env[name] ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
