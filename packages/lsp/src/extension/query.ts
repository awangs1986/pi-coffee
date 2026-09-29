import { runCoffeeLsp } from "../lsp/cli.js";

export interface LspEnvelope {
  schemaVersion: number;
  operation: string;
  status: "ok" | "partial" | "unavailable" | "error";
  workspace?: string;
  projectRoot?: string;
  server?: {
    id: string;
    state: string;
    command?: string;
    role?: "language" | "linter";
    source?: string;
    language?: string;
  };
  managedPrefix?: string;
  capabilityState?: string;
  capabilities?: string[];
  diagnosticState?: "clean" | "findings" | "inconclusive";
  snapshot?: unknown;
  /** Position a navigation query actually used (after `symbol` resolution). */
  position?: { line: number; column: number };
  items?: any[];
  /** diagnostics: new errors/warnings in the other files the server has open. */
  related?: any[];
  emptyReason?: string;
  coverage?: {
    requestedFiles?: number;
    confirmedFiles?: number;
    truncated?: boolean;
    relatedFiles?: number;
  };
  issues?: Array<{ code: string; message: string }>;
  nextAction?: string;
}

export interface QueryOutcome {
  code: number;
  envelope?: LspEnvelope;
  stdout: string;
  stderr: string;
}

/**
 * Run one coffee-lsp operation in-process. Non-status operations go through the
 * session daemon exactly as the CLI does, so the extension and Bash share warm
 * language servers.
 */
export async function runQuery(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<QueryOutcome> {
  let stdout = "";
  let stderr = "";
  const code = await runCoffeeLsp(args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, envelope: parseEnvelope(stdout), stdout, stderr };
}

export function parseEnvelope(stdout: string): LspEnvelope | undefined {
  const line = stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as LspEnvelope) : undefined;
  } catch {
    return undefined;
  }
}
