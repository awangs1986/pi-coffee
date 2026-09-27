import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import type { LspServerSpec } from "./client.js";

const requireFromHere = createRequire(import.meta.url);

export interface LspProfileResolution {
  id: "typescript" | "python";
  available: boolean;
  command?: string;
  args?: string[];
  allowVersionlessDiagnostics?: boolean;
  reason?: string;
}

export function resolveProfile(path: string, cwd: string, env: NodeJS.ProcessEnv): LspProfileResolution {
  const extension = extname(path).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return commandOverride("typescript", env.PI_COFFEE_TS_LSP_COMMAND) ?? resolveNodeServer("typescript", "typescript-language-server/lib/cli.mjs", ["--stdio"], true);
  }
  if (extension === ".py") {
    return commandOverride("python", env.PI_COFFEE_PYTHON_LSP_COMMAND) ?? resolveNodeServer("python", "pyright/langserver.index.js", ["--stdio"]);
  }
  return { id: "typescript", available: false, reason: `unsupported language: ${extension || "no extension"}` };
}

export function toServerSpec(profile: LspProfileResolution, cwd: string, env: NodeJS.ProcessEnv): LspServerSpec {
  if (!profile.available || !profile.command) throw new Error(profile.reason ?? "language server unavailable");
  // Command overrides configure this adapter and may use an in-process NUL
  // separator in tests. They are not language-server configuration and must
  // never be forwarded to spawn(), whose environment rejects NUL bytes.
  const childEnv = { ...env };
  delete childEnv.PI_COFFEE_TS_LSP_COMMAND;
  delete childEnv.PI_COFFEE_PYTHON_LSP_COMMAND;
  return { id: profile.id, command: profile.command, args: profile.args ?? [], cwd: resolve(cwd), env: childEnv, allowVersionlessDiagnostics: profile.allowVersionlessDiagnostics };
}

function commandOverride(id: LspProfileResolution["id"], raw: string | undefined): LspProfileResolution | undefined {
  if (!raw) return undefined;
  let parts: string[];
  try {
    const parsed = JSON.parse(raw);
    parts = Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : raw.split("\0");
  } catch {
    parts = raw.split("\0");
  }
  const [command, ...args] = parts;
  return existsSync(command) ? { id, available: true, command, args, allowVersionlessDiagnostics: id === "typescript" } : { id, available: false, reason: `configured server does not exist: ${command}` };
}

function resolveNodeServer(id: LspProfileResolution["id"], moduleId: string, args: string[], allowVersionlessDiagnostics = false): LspProfileResolution {
  try {
    return { id, available: true, command: process.execPath, args: [requireFromHere.resolve(moduleId), ...args], allowVersionlessDiagnostics };
  } catch {
    return { id, available: false, reason: `${id} language server is not installed` };
  }
}
