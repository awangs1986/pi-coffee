import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { HarnessMode } from "./catalog.js";

export interface ExecutionIdentity {
  harnessMode: HarnessMode;
  provider?: string;
  model?: string;
  account?: string;
}

export interface EpochSnapshot {
  epochId: string;
  identity: ExecutionIdentity;
  activeTools: readonly string[];
  schemaDigest: string;
  cacheEpoch: number;
}

/**
 * Runtime axis for capability activation.  It deliberately knows nothing
 * about OS permissions or VM policy: it only describes which tool schemas are
 * in the next Pi request's immutable prefix.
 */
export class ExecutionEpoch {
  private epochId: string;
  private identity: ExecutionIdentity;
  private tools: string[];
  private cacheEpoch = 0;

  constructor(
    identity: ExecutionIdentity,
    baseTools: readonly string[],
    private readonly idFactory: () => string = () => `epoch-${randomUUID()}`,
  ) {
    this.identity = { ...identity };
    this.tools = unique(baseTools);
    this.epochId = this.idFactory();
  }

  snapshot(): EpochSnapshot {
    return {
      epochId: this.epochId,
      identity: { ...this.identity },
      activeTools: [...this.tools],
      schemaDigest: digest(this.tools),
      cacheEpoch: this.cacheEpoch,
    };
  }

  rebuild(identity: ExecutionIdentity, baseTools: readonly string[]): EpochSnapshot {
    this.identity = { ...identity };
    this.tools = unique(baseTools);
    this.epochId = this.idFactory();
    this.cacheEpoch = 0;
    return this.snapshot();
  }

  requiresRebuild(identity: ExecutionIdentity): boolean {
    return this.identity.harnessMode !== identity.harnessMode
      || this.identity.provider !== identity.provider
      || this.identity.model !== identity.model
      || this.identity.account !== identity.account;
  }

  /** Tool schemas are append-only until an identity change rebuilds the epoch. */
  appendTools(names: readonly string[]): EpochSnapshot {
    const added = names.filter((name) => !this.tools.includes(name));
    if (added.length > 0) {
      this.tools.push(...added);
      this.cacheEpoch += 1;
    }
    return this.snapshot();
  }

  hasTool(name: string): boolean {
    return this.tools.includes(name);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function digest(values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
}

