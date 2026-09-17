import { Workspaces } from "./host/workspaces.js";
import { parseUserRoutes, type IdentityOptions } from "./web/identity.js";
import { readFileSync } from "node:fs";
import { HostServer } from "./host/server.js";
import { RpcPiSessionFactory } from "./host/pi-adapter.js";
import { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_FILE_BYTES, TransferServer } from "./host/transfer.js";
import { resolvePiExtensions } from "./pi-extensions.js";
import { RelayServer } from "./relay/server.js";
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
  const workspaces = process.env.PI_COFFEE_PROJECT_ROOT ? new Workspaces(process.env.PI_COFFEE_PROJECT_ROOT) : undefined;
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
    workspaces,
    allowUnscoped: !workspaces && process.env.PI_COFFEE_LEGACY_LOCALSEND === "1",
    advertiseHost: process.env.PI_COFFEE_TRANSFER_ADVERTISE,
    alias: envString("PI_COFFEE_TRANSFER_ALIAS", "PI Coffee"),
    maxFileBytes: envNumber("PI_COFFEE_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES),
    maxBatchBytes: envNumber("PI_COFFEE_MAX_BATCH_BYTES", DEFAULT_MAX_BATCH_BYTES),
    onEvent: (scope, event) => host?.announce(scope, event),
    ...(transferTls === undefined ? {} : { tls: transferTls }),
  });
  if (transfer) await transfer.start();

  host = !wantHost ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    idleTimeoutMs: envNumber("PI_COFFEE_IDLE_TIMEOUT_MS", 10 * 60 * 1000),
    transfer,
    workspaces,
    factory: new RpcPiSessionFactory({
      cwd: workdir,
      cwdForSession: workspaces ? async (id, existing) => {
        if(await workspaces.lookup(id)) return workspaces.cwd(id);
        if(existing) return workdir; // Historical unregistered sessions retain the original cwd.
        throw new Error("Create a project conversation in the sidebar before prompting");
      } : undefined,
      agentDir: process.env.PI_COFFEE_AGENT_DIR,
      sessionDir: process.env.PI_COFFEE_SESSION_DIR,
      provider: process.env.PI_COFFEE_PROVIDER,
      model: process.env.PI_COFFEE_MODEL,
      extensions: resolvePiExtensions(),
    }),
  });
  if (host) await host.start();

  const web = selectedRole === "host" || selectedRole === "relay" ? undefined : new WebServer({
    host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_WEB_PORT", 3000),
    hostUrl: process.env.PI_COFFEE_HOST_URL ?? `ws://127.0.0.1:${host?.address().port ?? envNumber("PI_COFFEE_HOST_PORT", 8788)}/host`,
    hostToken: process.env.PI_COFFEE_HOST_TOKEN,
    identity: identityOptions(),
    allowUnauthenticated: process.env.PI_COFFEE_ALLOW_UNAUTHENTICATED === "1",
    ...(webTls === undefined ? {} : { tls: webTls }),
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
    host ? `Host ws://${host.address().host}:${host.address().port}/host` : undefined,
    transfer ? `Transfer ${transfer.publicUrl()}/api/localsend/v2 (LocalSend v2, inbox ${transfer.inboxFor("<session>").split("\\").join("/")})` : undefined,
    web ? `Web ${web.scheme}://${web.address().host}:${web.address().port}/` : undefined,
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

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function identityOptions(): IdentityOptions | undefined {
  const routeFile = process.env.PI_COFFEE_ROUTES_FILE;
  if (!routeFile) return undefined; // Existing single-Host local mode; not a multi-user deployment.
  const required = (key: string) => { const value=process.env[key]; if(!value) throw new Error(`${key} is required for multi-user mode`); return value; };
  return { giteaUrl: required("PI_COFFEE_GITEA_URL"), clientId: required("PI_COFFEE_GITEA_CLIENT_ID"), clientSecret: required("PI_COFFEE_GITEA_CLIENT_SECRET"), publicUrl: required("PI_COFFEE_PUBLIC_URL"), routes: () => parseUserRoutes(readFileSync(routeFile,"utf8")) };
}
