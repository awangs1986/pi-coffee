import { RelayServer } from "./server.js";

const relay = new RelayServer({
  host: envString("PI_COFFEE_RELAY_BIND", "127.0.0.1"),
  port: envNumber("PI_COFFEE_RELAY_PORT", 8789),
  upstreamBaseUrl: envString("PI_COFFEE_UPSTREAM_URL", "https://b.awangsawangs.xyz/v1"),
  upstreamKey: process.env.PI_COFFEE_UPSTREAM_KEY ?? "",
  serperApiKey: process.env.PI_COFFEE_SERPER_KEY,
  serperEndpoint: process.env.PI_COFFEE_SERPER_ENDPOINT,
  clientTokens: envList("PI_COFFEE_RELAY_TOKENS"),
  upstreamHeadersTimeoutMs: envNumber("PI_COFFEE_RELAY_TIMEOUT_MS", 60_000),
  maxRequestBytes: envNumber("PI_COFFEE_RELAY_MAX_REQUEST_BYTES", 32 * 1024 * 1024),
  onRecord: (record) => {
    if (process.env.PI_COFFEE_RELAY_LOG !== "0") console.log(JSON.stringify({ relay: record }));
  },
});

await relay.start();
console.log(`Relay http://${relay.address().host}:${relay.address().port}/v1`);

const shutdown = async () => relay.close();
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function envList(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
