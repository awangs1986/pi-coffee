import { NativeAgentFactory } from "./host/native/factory.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HostServer } from "./host/server.js";
import { RpcPiSessionFactory } from "./host/pi-adapter.js";
import { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_FILE_BYTES, TransferServer } from "./host/transfer.js";
import { Workspaces } from "./host/workspaces.js";
import { GiteaClient } from "./host/gitea.js";
import { resolvePiExtensions } from "./pi-extensions.js";
import { resolvePiSkills, withCoffeeLspPath } from "./pi-skills.js";

void run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

async function run(): Promise<void> {
  process.umask(0o077); // Task evidence and native child artifacts belong to the VM owner.
  const workdir = process.env.PI_COFFEE_WORKDIR ?? process.cwd();
  const forge=process.env.PI_COFFEE_GITEA_URL && process.env.PI_COFFEE_GITEA_TOKEN && process.env.PI_COFFEE_GITEA_OWNER ? new GiteaClient({baseUrl:process.env.PI_COFFEE_GITEA_URL,token:process.env.PI_COFFEE_GITEA_TOKEN,owner:process.env.PI_COFFEE_GITEA_OWNER}) : undefined;
  const workRoot=process.env.PI_COFFEE_WORK_ROOT ?? workdir;
  const workspaces = new Workspaces(process.env.PI_COFFEE_PROJECT_ROOT ?? join(workRoot,"projects"),{chatRoot:process.env.PI_COFFEE_CHAT_ROOT ?? join(workRoot,"chats"),ownerId:process.env.PI_COFFEE_VM_ID,forge});
  await workspaces.list();
  const transferTls = loadTls("PI_COFFEE_TRANSFER_TLS_CERT", "PI_COFFEE_TRANSFER_TLS_KEY");
  let host: HostServer | undefined;
  const transferBind = envString("PI_COFFEE_TRANSFER_BIND", "0.0.0.0");
  const transfer = transferBind === "off" ? undefined : new TransferServer({
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

  host = new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    idleTimeoutMs: envNumber("PI_COFFEE_IDLE_TIMEOUT_MS", 10 * 60 * 1000),
    transfer,
    workspaces,
    skills: {root:process.env.PI_COFFEE_SKILL_ROOT,piAgentDir:process.env.PI_COFFEE_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR,claudeDir:process.env.CLAUDE_CONFIG_DIR,bundledPiSkills:resolvePiSkills(),...(process.env.PI_COFFEE_GITEA_URL && process.env.PI_COFFEE_GITEA_TOKEN && process.env.PI_COFFEE_GITEA_OWNER ? {gitea:{url:process.env.PI_COFFEE_GITEA_URL,token:process.env.PI_COFFEE_GITEA_TOKEN,owner:process.env.PI_COFFEE_GITEA_OWNER}} : {})},
    factory: new NativeAgentFactory({
      workspaces,
      ...(process.env.PI_COFFEE_CODEX_COMMAND ? {codex:{command:process.env.PI_COFFEE_CODEX_COMMAND}} : {}),
      ...(process.env.PI_COFFEE_CLAUDE_COMMAND ? {claude:{command:process.env.PI_COFFEE_CLAUDE_COMMAND}} : {}),
      pi: new RpcPiSessionFactory({
      cwd: workdir,
      cwdForSession: workspaces ? async (id, existing) => {
        if (await workspaces.lookup(id)) return workspaces.file(id,"");
        if (existing) return workdir;
        throw new Error("Create a Chat or Work task before prompting");
      } : undefined,
      envForSession: async (id):Promise<Record<string,string>> => {
        const c=await workspaces.lookup(id);
        if(!c)return {};
        return workspaces.runtimeEnvironment(id);
      },
      agentDir: process.env.PI_COFFEE_AGENT_DIR,
      sessionDir: process.env.PI_COFFEE_SESSION_DIR,
      provider: process.env.PI_COFFEE_PROVIDER,
      model: process.env.PI_COFFEE_MODEL,
      extensions: resolvePiExtensions(),
      skills: resolvePiSkills(),
      env: withCoffeeLspPath(),
    }),
    }),
  });
  await host.start();

  console.log(`Host ws://${host.address().host}:${host.address().port}/host`);
  if (transfer) console.log(`Transfer ${transfer.publicUrl()}/api/localsend/v2`);

  const shutdown = async () => {
    await host?.close();
    await transfer?.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function loadTls(certVar: string, keyVar: string): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env[certVar]?.trim();
  const keyPath = process.env[keyVar]?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) throw new Error(`${certVar} and ${keyVar} must be set together`);
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}
