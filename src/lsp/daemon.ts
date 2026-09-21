import { chmodSync, unlinkSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { LspClient } from "./client.js";
import { runCoffeeLsp, type CoffeeLspClientPool } from "./cli.js";
import { toServerSpec, type LspProfileResolution } from "./profiles.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;

class ClientPool implements CoffeeLspClientPool {
  private readonly entries = new Map<string, { client: LspClient; lastUsed: number }>();
  constructor(private readonly maxClients = 4) {}

  async acquire(profile: LspProfileResolution, workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<LspClient> {
    const spec = toServerSpec(profile, workspace, env);
    const key = JSON.stringify([spec.id, spec.cwd, spec.command, spec.args, spec.allowVersionlessDiagnostics]);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }
    if (this.entries.size >= this.maxClients) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        this.entries.delete(oldest[0]);
        await oldest[1].client.close();
      }
    }
    const client = await LspClient.start(spec, timeoutMs);
    this.entries.set(key, { client, lastUsed: Date.now() });
    return client;
  }

  async invalidate(client: LspClient): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.client !== client) continue;
      this.entries.delete(key);
      break;
    }
    await client.close();
  }

  async close(): Promise<void> {
    const clients = [...this.entries.values()].map((entry) => entry.client);
    this.entries.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}

export async function runLspDaemon(socketPath: string, idleMs = DEFAULT_IDLE_MS): Promise<void> {
  const pool = new ClientPool();
  let chain = Promise.resolve();
  let idleTimer: NodeJS.Timeout;
  const server = createServer((socket) => {
    resetIdle();
    receive(socket, (request) => {
      chain = chain.then(async () => {
        let stdout = "";
        let stderr = "";
        const code = await runCoffeeLsp([...request.args, "--no-daemon"], {
          cwd: request.cwd,
          env: process.env,
          stdout: (text) => { stdout += text; },
          stderr: (text) => { stderr += text; },
          clientPool: pool,
        });
        socket.end(JSON.stringify({ code, stdout, stderr }));
        resetIdle();
      }).catch((error) => {
        socket.end(JSON.stringify({ code: 5, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n` }));
      });
    });
  });

  const shutdown = async () => {
    clearTimeout(idleTimer);
    await pool.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { unlinkSync(socketPath); } catch { /* already removed */ }
  };
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void shutdown(), idleMs);
  };

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    else throw error;
  });
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
  chmodSync(socketPath, 0o600);
  resetIdle();
}

function receive(socket: Socket, onRequest: (request: { args: string[]; cwd: string }) => void): void {
  let data = "";
  socket.on("data", (chunk) => {
    data += chunk.toString("utf8");
    if (data.length > MAX_REQUEST_BYTES) {
      socket.end(JSON.stringify({ code: 2, stdout: "", stderr: "request too large\n" }));
      return;
    }
    const newline = data.indexOf("\n");
    if (newline < 0) return;
    socket.removeAllListeners("data");
    try {
      const value = JSON.parse(data.slice(0, newline));
      if (!Array.isArray(value.args) || !value.args.every((item: unknown) => typeof item === "string") || typeof value.cwd !== "string") throw new Error("invalid request");
      onRequest(value);
    } catch {
      socket.end(JSON.stringify({ code: 2, stdout: "", stderr: "invalid request\n" }));
    }
  });
}
