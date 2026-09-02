import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { ImageInput, SessionState } from "../shared/protocol.js";

/**
 * The only Pi-specific seam in PI Coffee.  The Host and Web Server depend on
 * this small interface rather than on Pi's SDK or RPC implementation.
 */
export interface PiSession {
  prompt(text: string, images?: ImageInput[]): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<SessionState>;
  onEvent(listener: (event: unknown) => void): () => void;
  stop(): Promise<void>;
}

export interface PiSessionFactory {
  create(options: { sessionId: string }): Promise<PiSession>;
}

export interface RpcPiSessionFactoryOptions {
  cwd?: string;
  agentDir?: string;
  sessionDir?: string;
  cliPath?: string;
  provider?: string;
  model?: string;
  args?: string[];
  /** Additional native Pi extensions loaded for every Host session. */
  extensions?: string[];
  env?: Record<string, string>;
}

/** Adapter around the original Pi agent's documented RPC client. */
export class RpcPiSessionFactory implements PiSessionFactory {
  private readonly options: RpcPiSessionFactoryOptions;

  constructor(options: RpcPiSessionFactoryOptions = {}) {
    this.options = options;
  }

  async create(options: { sessionId: string }): Promise<PiSession> {
    const args = appendExtensionArgs([...(this.options.args ?? [])], this.options.extensions ?? []);
    if (!args.includes("--session-id")) args.push("--session-id", options.sessionId);
    if (this.options.sessionDir !== undefined) {
      args.push("--session-dir", this.options.sessionDir);
    }
    const client = new RpcClient({
      cliPath: this.options.cliPath ?? resolvePiCliPath(),
      cwd: this.options.cwd,
      provider: this.options.provider,
      model: this.options.model,
      env: {
        ...(this.options.agentDir === undefined ? {} : { PI_CODING_AGENT_DIR: this.options.agentDir }),
        ...this.options.env,
      },
      args,
    });
    const session = new RpcPiSession(client);
    await session.start();
    return session;
  }
}

/** Add `--extension path` pairs without duplicating explicitly supplied paths. */
export function appendExtensionArgs(args: string[], extensions: readonly string[]): string[] {
  for (const extension of extensions) {
    const trimmed = extension.trim();
    if (trimmed.length === 0) continue;
    const alreadyPresent = args.some((arg, index) =>
      (arg === "--extension" || arg === "-e") && args[index + 1] === trimmed,
    ) || args.includes(`--extension=${trimmed}`);
    if (!alreadyPresent) args.push("--extension", trimmed);
  }
  return args;
}

class RpcPiSession implements PiSession {
  private readonly client: RpcClient;
  private readonly listeners = new Set<(event: unknown) => void>();
  private unsubscribe?: () => void;

  constructor(client: RpcClient) {
    this.client = client;
    this.unsubscribe = client.onEvent((event) => {
      for (const listener of this.listeners) listener(event);
    });
  }

  async start(): Promise<void> {
    try {
      await this.client.start();
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      throw error;
    }
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {
    // The RPC package's wire image shape is intentionally the same compact
    // shape used by PI Coffee.  Keep the cast local to this adapter.
    await this.client.prompt(text, images as never);
  }

  async abort(): Promise<void> {
    await this.client.abort();
  }

  async getState(): Promise<SessionState> {
    const state = await this.client.getState();
    return {
      isStreaming: state.isStreaming,
      messageCount: state.messageCount,
      ...(state.sessionName === undefined ? {} : { sessionName: state.sessionName }),
    };
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
    await this.client.stop();
  }
}

function resolvePiCliPath(): string {
  // The published Pi package ships the CLI bundle beside its main module.
  // Keeping resolution here means the rest of the Host does not know how Pi
  // is installed (npm, pnpm, or a future vendored adapter).
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(packageEntry), "bundle", "cli.js");
}
