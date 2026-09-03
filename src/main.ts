import { HostServer } from "./host/server.js";
import { RpcPiSessionFactory } from "./host/pi-adapter.js";
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

  const host = selectedRole === "web" || selectedRole === "relay" ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    factory: new RpcPiSessionFactory({
      cwd: process.env.PI_COFFEE_WORKDIR ?? process.cwd(),
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
  });
  if (web) await web.start();

  const shutdown = async () => {
    await web?.close();
    await host?.close();
    await relay?.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  const addresses = [
    relay ? `Relay http://${relay.address().host}:${relay.address().port}/v1` : undefined,
    host ? `Host ws://${host.address().host}:${host.address().port}/host` : undefined,
    web ? `Web http://${web.address().host}:${web.address().port}/` : undefined,
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

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
