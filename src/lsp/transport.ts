import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoffeeLspIo } from "./cli.js";

interface DaemonResponse {
  code: number;
  stdout: string;
  stderr: string;
  pid?: number;
}

export function lspDaemonSocket(env: NodeJS.ProcessEnv = process.env): string {
  const owner = env.PI_COFFEE_ROOT_SESSION?.trim() || "standalone";
  const digest = createHash("sha256").update(owner).digest("hex").slice(0, 16);
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(
    env.XDG_RUNTIME_DIR || tmpdir(),
    `pi-coffee-lsp-${uid}-${digest}.sock`,
  );
}

export async function requestLspDaemon(
  args: readonly string[],
  io: CoffeeLspIo,
): Promise<number> {
  const socket = lspDaemonSocket(io.env);
  const timeoutIndex = args.lastIndexOf("--timeout-ms");
  const requested = timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 10000;
  const deadline =
    Date.now() + (requested > 0 && requested <= 60000 ? requested : 10000);
  let response: DaemonResponse;
  try {
    response = await exchange(socket, args, io.cwd, 250, io.signal, deadline);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
    response = await startOrJoin(socket, args, io, deadline);
  }
  if (response.stdout) io.stdout(response.stdout);
  if (response.stderr) io.stderr(response.stderr);
  return response.code;
}

async function startOrJoin(
  socket: string,
  args: readonly string[],
  io: CoffeeLspIo,
  deadline: number,
): Promise<DaemonResponse> {
  const lock = `${socket}.starting`;
  for (let attempt = 0; attempt < 200; attempt++) {
    io.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("LSP daemon request timed out");
    let ownsLock = false;
    try {
      mkdirSync(lock, { mode: 0o700 });
      ownsLock = true;
      writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (ownsLock) {
      try {
        // Recheck under the startup lock: another caller may already have bound
        // a healthy socket after our first connection failure.
        try {
          return await exchange(socket, args, io.cwd, 500, io.signal, deadline);
        } catch (error) {
          if (
            !["ENOENT", "ECONNREFUSED"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
        }
        if (existsSync(socket)) unlinkSync(socket);
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("./bin.js", import.meta.url)),
            "__daemon",
            socket,
          ],
          { detached: true, stdio: "ignore", env: io.env },
        );
        child.unref();
        return await retryExchange(socket, args, io.cwd, io.signal, deadline);
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
    try {
      return await exchange(socket, args, io.cwd, 500, io.signal, deadline);
    } catch (error) {
      if (
        !["ENOENT", "ECONNREFUSED"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
    try {
      const owner = Number(readFileSync(join(lock, "pid"), "utf8"));
      if (Number.isSafeInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH")
            rmSync(lock, { recursive: true, force: true });
        }
      }
    } catch {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 5000)
        rmSync(lock, { recursive: true, force: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("LSP daemon startup remained busy");
}

async function retryExchange(
  socket: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  deadline = Date.now() + 10000,
): Promise<DaemonResponse> {
  let last: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (Date.now() >= deadline) throw new Error("LSP daemon request timed out");
    try {
      return await exchange(socket, args, cwd, 500, signal, deadline);
    } catch (error) {
      if (
        signal?.aborted ||
        !["ENOENT", "ECONNREFUSED"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw last instanceof Error ? last : new Error("LSP daemon did not start");
}

function exchange(
  socketPath: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  deadline = Date.now() + 10000,
): Promise<DaemonResponse> {
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
      const error = new Error(
        "LSP daemon connection timed out",
      ) as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      finishError(error);
    }, timeoutMs);
    const abort = () => finishError(new Error("LSP request cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("close", () => signal?.removeEventListener("abort", abort));
    if (signal?.aborted) abort();
    socket.once("error", finishError);
    socket.once("connect", () => {
      clearTimeout(timer);
      // Includes daemon startup and queue time; allow a short response/cleanup margin.
      timer = setTimeout(
        () => finishError(new Error("LSP daemon request timed out")),
        Math.max(1, deadline - Date.now()) + 250,
      );
      socket.write(`${JSON.stringify({ args, cwd, deadline })}\n`);
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 256 * 1024)
        finishError(new Error("LSP daemon response exceeded 256 KiB"));
    });
    socket.once("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data) as DaemonResponse);
      } catch {
        reject(new Error("LSP daemon returned invalid JSON"));
      }
    });
  });
}

/** Stop only an existing task daemon; cleanup must never launch a new server. */
export async function stopLspDaemon(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const response = await exchange(
      lspDaemonSocket({ ...env, PI_COFFEE_ROOT_SESSION: sessionId }),
      ["__shutdown"],
      process.cwd(),
      1000,
    );
    if (response.code !== 0)
      throw new Error(response.stderr || "LSP shutdown failed");
    if (response.pid) {
      const deadline = Date.now() + 2000;
      while (true) {
        try {
          process.kill(response.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
          throw error;
        }
        if (Date.now() >= deadline)
          throw new Error("LSP daemon exit could not be confirmed");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  } catch (error) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  }
}
