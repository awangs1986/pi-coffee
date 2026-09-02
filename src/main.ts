import { HostServer } from "./host/server.js";
import { RpcPiSessionFactory } from "./host/pi-adapter.js";
import { WebServer } from "./web/server.js";

const role = process.argv[2] ?? "all";

if (role !== "host" && role !== "web" && role !== "all") {
  console.error(`Usage: node dist/src/main.js [host|web|all]`);
  process.exitCode = 2;
} else {
  void run(role).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function run(selectedRole: "host" | "web" | "all"): Promise<void> {
  const host = selectedRole === "web" ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    factory: new RpcPiSessionFactory({
      cwd: process.env.PI_COFFEE_WORKDIR ?? process.cwd(),
      sessionDir: process.env.PI_COFFEE_SESSION_DIR,
      provider: process.env.PI_COFFEE_PROVIDER,
      model: process.env.PI_COFFEE_MODEL,
      env: process.env.PI_COFFEE_PI_ENV === undefined ? undefined : { PI_COFFEE_PI_ENV: process.env.PI_COFFEE_PI_ENV },
    }),
  });

  if (host) await host.start();

  const web = selectedRole === "host" ? undefined : new WebServer({
    host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_WEB_PORT", 3000),
    hostUrl: process.env.PI_COFFEE_HOST_URL ?? `ws://127.0.0.1:${host?.address().port ?? envNumber("PI_COFFEE_HOST_PORT", 8788)}/host`,
    hostToken: process.env.PI_COFFEE_HOST_TOKEN,
  });
  if (web) await web.start();

  const shutdown = async () => {
    await web?.close();
    await host?.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  const addresses = [
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
