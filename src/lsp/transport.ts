import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoffeeLspIo } from "./cli.js";

interface DaemonResponse { code: number; stdout: string; stderr: string }

export function lspDaemonSocket(env: NodeJS.ProcessEnv = process.env): string {
  const owner = env.PI_COFFEE_ROOT_SESSION?.trim() || "standalone";
  const digest = createHash("sha256").update(owner).digest("hex").slice(0, 16);
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(env.XDG_RUNTIME_DIR || tmpdir(), `pi-coffee-lsp-${uid}-${digest}.sock`);
}

export async function requestLspDaemon(args: readonly string[], io: CoffeeLspIo): Promise<number> {
  const socket = lspDaemonSocket(io.env);
  let response: DaemonResponse;
  try {
    response = await exchange(socket, args, io.cwd, 250);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ECONNREFUSED" && code !== "ETIMEDOUT") throw error;
    if (existsSync(socket)) {
      try { unlinkSync(socket); } catch { /* a racing daemon may own it */ }
    }
    const entry = fileURLToPath(new URL("./bin.js", import.meta.url));
    const child = spawn(process.execPath, [entry, "__daemon", socket], {
      detached: true,
      stdio: "ignore",
      env: io.env,
    });
    child.unref();
    response = await retryExchange(socket, args, io.cwd);
  }
  if (response.stdout) io.stdout(response.stdout);
  if (response.stderr) io.stderr(response.stderr);
  return response.code;
}

async function retryExchange(socket: string, args: readonly string[], cwd: string): Promise<DaemonResponse> {
  let last: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { return await exchange(socket, args, cwd, 500); }
    catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw last instanceof Error ? last : new Error("LSP daemon did not start");
}

function exchange(socketPath: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let data = "";
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    let timer = setTimeout(() => {
      const error = new Error("LSP daemon connection timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      finishError(error);
    }, timeoutMs);
    socket.once("error", finishError);
    socket.once("connect", () => {
      clearTimeout(timer);
      timer = setTimeout(() => finishError(new Error("LSP daemon request timed out")), 35_000);
      socket.write(`${JSON.stringify({ args, cwd })}\n`);
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 256 * 1024) finishError(new Error("LSP daemon response exceeded 256 KiB"));
    });
    socket.once("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { resolve(JSON.parse(data) as DaemonResponse); }
      catch { reject(new Error("LSP daemon returned invalid JSON")); }
    });
  });
}

/** Stop only an existing task daemon; cleanup must never launch a new server. */
export async function stopLspDaemon(sessionId:string, env:NodeJS.ProcessEnv=process.env):Promise<void> {
  try {
    const response=await exchange(lspDaemonSocket({...env,PI_COFFEE_ROOT_SESSION:sessionId}),['__shutdown'],process.cwd(),1000);
    if(response.code!==0)throw new Error(response.stderr || 'LSP shutdown failed');
  }catch(error){if(!['ENOENT','ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? ''))throw error;}
}
