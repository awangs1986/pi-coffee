import { chmodSync, unlinkSync } from "node:fs";
import {
  projectSnapshot,
  sourceChanges,
  type ProjectSnapshot,
} from "./snapshot.js";
import { createServer, type Socket } from "node:net";
import { LspClient, LspTransportError } from "./client.js";
import { runCoffeeLsp, type CoffeeLspClientPool } from "./cli.js";
import { toServerSpec, type LspProfileResolution } from "./profiles.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;

class ClientPool implements CoffeeLspClientPool {
  private readonly entries = new Map<
    string,
    {
      client: LspClient;
      lastUsed: number;
      snapshot: ProjectSnapshot;
      scope: string;
    }
  >();
  private closed = false;
  private readonly failures = new Map<string, { at: number; error: unknown }>();
  constructor(private readonly maxClients = 4) {}

  async acquire(
    profile: LspProfileResolution,
    workspace: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LspClient> {
    if (this.closed) throw new Error("LSP daemon is stopping");
    const spec = toServerSpec(profile, workspace, env);
    const key = JSON.stringify([
      spec.id,
      spec.cwd,
      spec.command,
      spec.args,
      spec.allowVersionlessDiagnostics,
      spec.settings,
      spec.initializationOptions,
    ]);
    const snapshot = projectSnapshot(workspace);
    const scope = JSON.stringify([spec.id, spec.cwd]);
    // Retire superseded configuration immediately, including servers using old settings.
    for (const [oldKey, entry] of this.entries) {
      if (
        entry.scope === scope &&
        (oldKey !== key ||
          entry.snapshot.configuration !== snapshot.configuration ||
          !entry.client.isAlive())
      )
        await this.invalidate(entry.client);
    }
    const existing = this.entries.get(key);
    if (existing) {
      const unbind = existing.client.bindSignal(signal, timeoutMs);
      try {
        await existing.client.reconcileWorkspace(
          sourceChanges(existing.snapshot, snapshot),
        );
        existing.snapshot = snapshot;
        existing.lastUsed = Date.now();
        return existing.client;
      } catch (error) {
        // A partially delivered watcher batch cannot safely be replayed as if fresh.
        await this.invalidate(existing.client);
        throw error;
      } finally {
        unbind();
      }
    }
    const failureKey = key + snapshot.configuration;
    const recent = this.failures.get(failureKey);
    if (recent && Date.now() - recent.at < 3 * 60 * 1000) throw recent.error;
    if (this.entries.size >= this.maxClients) {
      const oldest = [...this.entries.entries()].sort(
        (a, b) => a[1].lastUsed - b[1].lastUsed,
      )[0];
      if (oldest) {
        this.entries.delete(oldest[0]);
        await oldest[1].client.close();
      }
    }
    let client: LspClient;
    try {
      client = await LspClient.start(spec, timeoutMs, signal);
    } catch (error) {
      // Only deterministic initialization failures back off; a broken transport,
      // cancellation or caller-shortened deadline must permit a fresh attempt.
      if (
        !(error instanceof LspTransportError) &&
        !signal?.aborted &&
        !/timed out/i.test(String(error))
      ) {
        if (this.failures.size >= 16)
          this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(failureKey, { at: Date.now(), error });
      }
      throw error;
    }
    this.failures.delete(failureKey);
    if (this.closed) {
      await client.close();
      throw new Error("LSP daemon is stopping");
    }
    this.entries.set(key, { client, lastUsed: Date.now(), snapshot, scope });
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
    this.closed = true;
    const clients = [...this.entries.values()].map((entry) => entry.client);
    this.entries.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}

// OMP mux shutdown guard adapted to Coffee's existing task-owned daemon.
export async function runLspDaemon(
  socketPath: string,
  idleMs = DEFAULT_IDLE_MS,
): Promise<void> {
  const pool = new ClientPool();
  let chain = Promise.resolve();
  let idleTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  const connections = new Map<Socket, AbortController>();
  const resetIdle = () => {
    clearTimeout(idleTimer);
    if (!shuttingDown && connections.size === 0)
      idleTimer = setTimeout(() => void shutdown(), idleMs);
  };
  const server = createServer((socket) => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }
    clearTimeout(idleTimer);
    const cancellation = new AbortController();
    connections.set(socket, cancellation);
    socket.on("error", () => cancellation.abort());
    socket.once("close", () => {
      connections.delete(socket);
      cancellation.abort();
      resetIdle();
    });
    receive(socket, (request) => {
      // Stop is control traffic: cancel active work before waiting for its chain.
      if (request.args.length === 1 && request.args[0] === "__shutdown") {
        void shutdown(socket);
        return;
      }
      const deadline = Math.min(
        request.deadline ?? Date.now() + 10000,
        Date.now() + 60000,
      );
      chain = chain
        .then(async () => {
          if (cancellation.signal.aborted || shuttingDown) return;
          let stdout = "";
          let stderr = "";
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            socket.end(
              JSON.stringify({
                code: 4,
                stdout:
                  JSON.stringify({
                    schemaVersion: 1,
                    operation: request.args[0],
                    status: "partial",
                    items: [],
                    issues: [
                      {
                        code: "request_timeout",
                        message: "LSP request timed out while queued",
                      },
                    ],
                  }) + "\n",
                stderr: "",
              }),
            );
            return;
          }
          const code = await runCoffeeLsp(
            [...request.args, "--no-daemon", "--timeout-ms", String(remaining)],
            {
              cwd: request.cwd,
              signal: cancellation.signal,
              env: process.env,
              stdout: (text) => {
                stdout += text;
              },
              stderr: (text) => {
                stderr += text;
              },
              clientPool: pool,
            },
          );
          socket.end(JSON.stringify({ code, stdout, stderr }));
        })
        .catch((error) => {
          socket.end(
            JSON.stringify({
              code: 5,
              stdout: "",
              stderr: `${error instanceof Error ? error.message : String(error)}\n`,
            }),
          );
        });
    });
  });
  const shutdown = (requester?: Socket): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    clearTimeout(idleTimer);
    const stopped = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    for (const [socket, controller] of connections) {
      if (socket === requester) continue;
      controller.abort();
      socket.destroy();
    }
    return (shutdownPromise = (async () => {
      await chain;
      await pool.close();
      requester?.end(
        JSON.stringify({ code: 0, stdout: "", stderr: "", pid: process.pid }),
      );
      await stopped;
      try {
        unlinkSync(socketPath);
      } catch {
        /* already removed */
      }
    })());
  };
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    else throw error;
  });
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await new Promise<void>((resolve) =>
    server.listen(socketPath, () => resolve()),
  );
  chmodSync(socketPath, 0o600);
  resetIdle();
}

function receive(
  socket: Socket,
  onRequest: (request: {
    args: string[];
    cwd: string;
    deadline?: number;
  }) => void,
): void {
  let data = "";
  socket.on("data", (chunk) => {
    data += chunk.toString("utf8");
    if (data.length > MAX_REQUEST_BYTES) {
      socket.end(
        JSON.stringify({ code: 2, stdout: "", stderr: "request too large\n" }),
      );
      return;
    }
    const newline = data.indexOf("\n");
    if (newline < 0) return;
    socket.removeAllListeners("data");
    try {
      const value = JSON.parse(data.slice(0, newline));
      if (
        !Array.isArray(value.args) ||
        !value.args.every((item: unknown) => typeof item === "string") ||
        typeof value.cwd !== "string" ||
        (value.deadline !== undefined && !Number.isFinite(value.deadline))
      )
        throw new Error("invalid request");
      onRequest(value);
    } catch {
      socket.end(
        JSON.stringify({ code: 2, stdout: "", stderr: "invalid request\n" }),
      );
    }
  });
}
