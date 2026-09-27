import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve, delimiter } from "node:path";
import type { LspServerSpec } from "./client.js";

const requireFromHere = createRequire(import.meta.url);

export interface LspProfileResolution {
  id: "typescript" | "python" | "csharp" | "cpp" | "rust" | "go";
  available: boolean;
  command?: string;
  args?: string[];
  allowVersionlessDiagnostics?: boolean;
  reason?: string;
}

export function resolveProfile(
  path: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): LspProfileResolution {
  const extension = extname(path).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return (
      commandOverride("typescript", env.PI_COFFEE_TS_LSP_COMMAND) ??
      resolveNodeServer(
        "typescript",
        "typescript-language-server/lib/cli.mjs",
        ["--stdio"],
        true,
      )
    );
  }
  if (extension === ".py") {
    return (
      commandOverride("python", env.PI_COFFEE_PYTHON_LSP_COMMAND) ??
      resolveNodeServer("python", "pyright/langserver.index.js", ["--stdio"])
    );
  }
  const native = [
    {
      id: "csharp",
      extensions: [".cs"],
      variable: "CSHARP",
      command: "csharp-ls",
      args: [],
    },
    {
      id: "cpp",
      extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"],
      variable: "CPP",
      command: "clangd",
      args: ["--background-index"],
    },
    {
      id: "rust",
      extensions: [".rs"],
      variable: "RUST",
      command: "rust-analyzer",
      args: [],
    },
    {
      id: "go",
      extensions: [".go"],
      variable: "GO",
      command: "gopls",
      args: ["serve"],
    },
  ] as const;
  for (const profile of native) {
    if (!(profile.extensions as readonly string[]).includes(extension))
      continue;
    const override = commandOverride(
      profile.id,
      env[`PI_COFFEE_${profile.variable}_LSP_COMMAND`],
    );
    if (override) return override;
    const command = (env.PATH ?? "")
      .split(delimiter)
      .map((dir) => resolve(dir, profile.command))
      .find(existsSync);
    return command
      ? {
          id: profile.id,
          available: true,
          command,
          args: [...profile.args],
          allowVersionlessDiagnostics: profile.id === "rust",
        }
      : {
          id: profile.id,
          available: false,
          reason: `Install ${profile.command} and its project toolchain, or set PI_COFFEE_${profile.variable}_LSP_COMMAND to a JSON argv array.`,
        };
  }
  return {
    id: "typescript",
    available: false,
    reason: `unsupported language: ${extension || "no extension"}`,
  };
}

export function toServerSpec(
  profile: LspProfileResolution,
  cwd: string,
  env: NodeJS.ProcessEnv,
): LspServerSpec {
  if (!profile.available || !profile.command)
    throw new Error(profile.reason ?? "language server unavailable");
  // Command overrides configure this adapter and may use an in-process NUL
  // separator in tests. They are not language-server configuration and must
  // never be forwarded to spawn(), whose environment rejects NUL bytes.
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv))
    if (/^PI_COFFEE_.*_LSP_COMMAND$/.test(key)) delete childEnv[key];
  const configuration = resolve(cwd, "coffee-lsp.json");
  let settings: Record<string, unknown> = {},
    initializationOptions: Record<string, unknown> = {};
  if (existsSync(configuration)) {
    if (statSync(configuration).size > 65536)
      throw new Error("coffee-lsp.json exceeds 64 KiB");
    const configured =
      JSON.parse(readFileSync(configuration, "utf8"))[profile.id] ?? {};
    for (const key of ["settings", "initializationOptions"])
      if (
        configured[key] !== undefined &&
        (!configured[key] ||
          typeof configured[key] !== "object" ||
          Array.isArray(configured[key]))
      )
        throw new Error(`Invalid ${key} in coffee-lsp.json`);
    settings = configured.settings ?? {};
    initializationOptions = configured.initializationOptions ?? {};
  }
  return {
    settings,
    initializationOptions,
    id: profile.id,
    command: profile.command,
    args: profile.args ?? [],
    cwd: resolve(cwd),
    env: childEnv,
    allowVersionlessDiagnostics: profile.allowVersionlessDiagnostics,
  };
}

function commandOverride(
  id: LspProfileResolution["id"],
  raw: string | undefined,
): LspProfileResolution | undefined {
  if (!raw) return undefined;
  let parts: string[];
  try {
    const parsed = JSON.parse(raw);
    parts =
      Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string")
        ? parsed
        : raw.split("\0");
  } catch {
    parts = raw.split("\0");
  }
  const [command, ...args] = parts;
  return existsSync(command)
    ? {
        id,
        available: true,
        command,
        args,
        allowVersionlessDiagnostics: id === "typescript",
      }
    : {
        id,
        available: false,
        reason: `configured server does not exist: ${command}`,
      };
}

function resolveNodeServer(
  id: LspProfileResolution["id"],
  moduleId: string,
  args: string[],
  allowVersionlessDiagnostics = false,
): LspProfileResolution {
  try {
    return {
      id,
      available: true,
      command: process.execPath,
      args: [requireFromHere.resolve(moduleId), ...args],
      allowVersionlessDiagnostics,
    };
  } catch {
    return {
      id,
      available: false,
      reason: `${id} language server is not installed`,
    };
  }
}
