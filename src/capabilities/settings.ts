import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TrustState = "disabled" | "enabled-untrusted" | "trusted";

/** Persistent user-owned facts. Running leases are intentionally absent. */
export interface CapabilitySettingsRecord {
  enabled: boolean;
  trustedDigest?: string;
}

export interface CapabilitySettingsStore {
  get(id: string): CapabilitySettingsRecord | undefined;
  set(id: string, value: CapabilitySettingsRecord): void;
  entries(): Array<[string, CapabilitySettingsRecord]>;
}

export class MemoryCapabilitySettingsStore implements CapabilitySettingsStore {
  private readonly records = new Map<string, CapabilitySettingsRecord>();

  constructor(initial: Iterable<[string, CapabilitySettingsRecord]> = []) {
    for (const [id, value] of initial) this.records.set(id, clone(value));
  }

  get(id: string): CapabilitySettingsRecord | undefined {
    const value = this.records.get(id);
    return value === undefined ? undefined : clone(value);
  }

  set(id: string, value: CapabilitySettingsRecord): void {
    this.records.set(id, clone(value));
  }

  entries(): Array<[string, CapabilitySettingsRecord]> {
    return [...this.records.entries()].map(([id, value]) => [id, clone(value)]);
  }
}

/**
 * Small, atomic JSON store for settings on the User VM. It never stores a
 * runner, transcript, prompt, tool result, or credential.
 */
export class FileCapabilitySettingsStore implements CapabilitySettingsStore {
  private readonly records: Map<string, CapabilitySettingsRecord>;

  constructor(readonly path: string) {
    this.records = readRecords(path);
  }

  get(id: string): CapabilitySettingsRecord | undefined {
    const value = this.records.get(id);
    return value === undefined ? undefined : clone(value);
  }

  set(id: string, value: CapabilitySettingsRecord): void {
    validateRecord(id, value);
    this.records.set(id, clone(value));
    this.flush();
  }

  entries(): Array<[string, CapabilitySettingsRecord]> {
    return [...this.records.entries()].map(([id, value]) => [id, clone(value)]);
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      capabilities: [...this.records.entries()].map(([id, value]) => ({ id, ...value })),
    }, null, 2) + "\n";
    writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
    // chmod is a no-op on platforms without POSIX modes, and keeps an old
    // file from becoming more permissive after an atomic replacement.
    try { chmodSync(this.path, 0o600); } catch { /* best effort on Windows */ }
  }
}

function readRecords(path: string): Map<string, CapabilitySettingsRecord> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return new Map();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid capability settings JSON at ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.capabilities)) {
    throw new Error(`invalid capability settings shape at ${path}`);
  }
  const records = new Map<string, CapabilitySettingsRecord>();
  for (const item of parsed.capabilities) {
    if (!isRecord(item) || typeof item.id !== "string") throw new Error(`invalid capability settings entry at ${path}`);
    const value: CapabilitySettingsRecord = {
      enabled: item.enabled === true,
      ...(typeof item.trustedDigest === "string" ? { trustedDigest: item.trustedDigest } : {}),
    };
    validateRecord(item.id, value);
    records.set(item.id, value);
  }
  return records;
}

function validateRecord(id: string, value: CapabilitySettingsRecord): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error(`invalid capability id '${id}'`);
  if (typeof value.enabled !== "boolean") throw new Error(`invalid enabled flag for '${id}'`);
  if (value.trustedDigest !== undefined && !/^[a-f0-9]{64}$/i.test(value.trustedDigest)) {
    throw new Error(`invalid trustedDigest for '${id}'`);
  }
}

function clone(value: CapabilitySettingsRecord): CapabilitySettingsRecord {
  return value.trustedDigest === undefined
    ? { enabled: value.enabled }
    : { enabled: value.enabled, trustedDigest: value.trustedDigest };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

/** Kept exported for diagnostics/tests without making file metadata an authority. */
export function settingsFileMode(path: string): number | undefined {
  try { return statSync(path).mode & 0o777; } catch { return undefined; }
}

