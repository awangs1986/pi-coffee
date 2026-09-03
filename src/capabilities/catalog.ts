import {
  estimateSchemaTokensAll,
  SCHEMA_BUDGETS,
  stableStringify,
  type ToolSchemaLike,
} from "./schema-budget.js";
import { createHash } from "node:crypto";
import type { ExecutionEpoch } from "./execution-epoch.js";
import {
  MemoryCapabilitySettingsStore,
  type CapabilitySettingsRecord,
  type CapabilitySettingsStore,
  type TrustState,
} from "./settings.js";

export type HarnessMode = "simple" | "full";
export type RunnerConformance = "passed" | "not_run";
export type ReadinessStatus = "Ready" | "Degraded" | "NeedsSetup" | "Unavailable";
export type CapabilityKind = "pi-extension" | "mcp-server" | "skill" | "builtin";
export type CapabilityOrigin = "suite" | "user" | "task";
export type ActivationPath = "proxy" | "registered" | "resident";

export interface CapabilityReadiness {
  status: ReadinessStatus;
  summary: string;
  missing: string[];
  nextSteps: string[];
  inspectedAt: string;
}
export interface CapabilityManifest {
  id: string;
  kind: CapabilityKind;
  origin: CapabilityOrigin;
  title: string;
  summary: string;
  keywords: string[];
  tools: ToolSchemaLike[];
  supportedHarness: HarnessMode[];
  /** Descriptive only; PI Coffee does not enforce an in-process permission tier. */
  permissionSummary: string;
  runnerConformance: RunnerConformance;
  /** A future adapter may use a resident proxy instead of adding schemas. */
  supportsProxyCall?: boolean;
}

export interface CapabilitySettingsEntry {
  id: string;
  title: string;
  trust: TrustState;
  trustedDigest?: string;
  manifestDigest: string;
  runnerConformance: RunnerConformance;
  readiness: CapabilityReadiness;
  agentVisible: boolean;
  schemaResident: boolean;
  active: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  summary: string;
  schemaCostTokens: number;
  permissionSummary: string;
  readiness: ReadinessStatus;
}

export interface ActiveCapabilityLease {
  leaseId: string;
  capabilityId: string;
  path: ActivationPath;
  activatedAtTurn: number;
  epochId: string;
}

export type ActivationResult =
  | {
      ok: true;
      capabilityId: string;
      toolsAdded: string[];
      alreadyActive: boolean;
      schemaCostTokens: number;
      effective: "next-model-request" | "immediate";
      lease: ActiveCapabilityLease;
    }
  | {
      ok: false;
      code: "unknown" | "not-trusted" | "not-ready" | "harness-unsupported" | "budget-exceeded" | "registration-failed";
      message: string;
    };

export interface ToolRegistrar {
  /** Register a schema/runner; throw to reject the whole bundle. */
  register(tool: ToolSchemaLike): void;
  /** Best-effort compensation for a partially prepared bundle. */
  unregister(toolName: string): void;
  /** Optional probe used to avoid compensating a preloaded Pi tool. */
  isRegistered?(toolName: string): boolean;
}

export interface CapabilityProxy {
  isAvailable(capabilityId: string): boolean;
  activate(capabilityId: string): void;
  release?(capabilityId: string): void;
}

export interface CapabilityContext {
  currentTurn?: number;
}

export interface CapabilityCatalogOptions {
  epoch: ExecutionEpoch;
  registrar: ToolRegistrar;
  harness: () => HarnessMode;
  settings?: CapabilitySettingsStore;
  proxy?: CapabilityProxy;
  now?: () => string;
  newLeaseId?: () => string;
  budgets?: Partial<typeof SCHEMA_BUDGETS>;
}

interface RegisteredCapability {
  manifest: CapabilityManifest;
  digest: string;
  initialSettings: CapabilitySettingsRecord;
  readiness: CapabilityReadiness;
}

/**
 * Deep discovery module: settings/trust, manifest search, readiness, schema
 * budgeting, atomic activation, and runtime leases live behind this small
 * interface. Pi's ExtensionAPI is only an Adapter supplied by the caller.
 */
export class CapabilityCatalog {
  private readonly records = new Map<string, RegisteredCapability>();
  private readonly schemaResident = new Set<string>();
  private readonly leases = new Map<string, ActiveCapabilityLease>();
  private readonly settings: CapabilitySettingsStore;
  private readonly proxy?: CapabilityProxy;
  private readonly now: () => string;
  private readonly newLeaseId: () => string;
  private readonly budgets: typeof SCHEMA_BUDGETS;
  private spentSchemaTokens = 0;

  constructor(private readonly options: CapabilityCatalogOptions) {
    this.settings = options.settings ?? new MemoryCapabilitySettingsStore();
    this.proxy = options.proxy;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newLeaseId = options.newLeaseId ?? (() => `lease-${cryptoRandomId()}`);
    this.budgets = {
      ...SCHEMA_BUDGETS,
      ...(options.budgets ?? {}),
    };
  }

  /** Register/replace a lightweight manifest; code is never loaded here. */
  register(manifest: CapabilityManifest, initialTrust: TrustState = "enabled-untrusted"): void {
    validateManifest(manifest);
    const digest = digestCapabilityManifest(manifest);
    const previous = this.records.get(manifest.id);
    if (previous !== undefined && this.schemaResident.has(manifest.id)) {
      throw new Error(`cannot replace active capability '${manifest.id}' before an epoch rebuild`);
    }
    const existing = this.settings.get(manifest.id);
    const initialSettings = existing ?? settingsForTrust(initialTrust, digest);
    const readiness = defaultReadiness(manifest);
    this.records.set(manifest.id, { manifest: cloneManifest(manifest), digest, initialSettings, readiness });
  }

  /** Alias useful to adapters that receive manifests incrementally. */
  upsert(manifest: CapabilityManifest, initialTrust: TrustState = "enabled-untrusted"): void {
    this.register(manifest, initialTrust);
  }

  manifest(id: string): CapabilityManifest | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneManifest(record.manifest);
  }

  manifestDigest(id: string): string | undefined {
    return this.records.get(id)?.digest;
  }

  setReadiness(id: string, readiness: CapabilityReadiness): void {
    const record = this.records.get(id);
    if (record === undefined) throw new Error(`unknown capability '${id}'`);
    validateReadiness(readiness);
    record.readiness = { ...readiness, missing: [...readiness.missing], nextSteps: [...readiness.nextSteps] };
  }

  readiness(id: string): CapabilityReadiness | undefined {
    const value = this.records.get(id)?.readiness;
    return value === undefined ? undefined : cloneReadiness(value);
  }

  /** User settings operations; no model-callable tool invokes these methods. */
  enable(id: string): void {
    const record = this.require(id);
    const current = this.settings.get(id) ?? record.initialSettings;
    this.settings.set(id, { ...current, enabled: true });
  }

  disable(id: string): void {
    const record = this.require(id);
    const current = this.settings.get(id) ?? record.initialSettings;
    this.settings.set(id, { ...current, enabled: false });
  }

  trustCurrent(id: string): void {
    const record = this.require(id);
    this.settings.set(id, { enabled: true, trustedDigest: record.digest });
  }

  setTrust(id: string, trust: TrustState): void {
    if (trust === "disabled") this.disable(id);
    else if (trust === "enabled-untrusted") {
      const record = this.require(id);
      this.settings.set(id, { enabled: true, ...(this.settings.get(id)?.trustedDigest === record.digest ? {} : {}) });
    } else this.trustCurrent(id);
  }

  listSettings(): CapabilitySettingsEntry[] {
    return [...this.records.values()].map((record) => {
      const settings = this.settings.get(record.manifest.id) ?? record.initialSettings;
      const trust = trustState(settings, record.digest);
      const harnessCompatible = record.manifest.supportedHarness.includes(this.options.harness());
      const runnerReady = record.manifest.runnerConformance === "passed";
      const readinessReady = record.readiness.status === "Ready" || record.readiness.status === "Degraded";
      return {
        id: record.manifest.id,
        title: record.manifest.title,
        trust,
        ...(settings.trustedDigest === undefined ? {} : { trustedDigest: settings.trustedDigest }),
        manifestDigest: record.digest,
        runnerConformance: record.manifest.runnerConformance,
        readiness: cloneReadiness(record.readiness),
        agentVisible: trust === "trusted" && runnerReady && readinessReady && harnessCompatible,
        schemaResident: this.schemaResident.has(record.manifest.id),
        active: this.leases.has(record.manifest.id),
      };
    });
  }

  /** Search returns summaries only; complete tool schemas stay out of context. */
  search(query: string, limit = 5): SearchHit[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const candidates: Array<{ hit: SearchHit; score: number; order: number }> = [];
    let order = 0;
    for (const record of this.records.values()) {
      const settings = this.settings.get(record.manifest.id) ?? record.initialSettings;
      if (trustState(settings, record.digest) !== "trusted") { order += 1; continue; }
      if (record.manifest.runnerConformance !== "passed") { order += 1; continue; }
      if (!record.manifest.supportedHarness.includes(this.options.harness())) { order += 1; continue; }
      if (record.readiness.status !== "Ready" && record.readiness.status !== "Degraded") { order += 1; continue; }
      const haystack = `${record.manifest.id} ${record.manifest.title} ${record.manifest.summary} ${record.manifest.keywords.join(" ")}`.toLowerCase();
      if (terms.length > 0 && !terms.some((term) => haystack.includes(term))) { order += 1; continue; }
      const score = terms.reduce((total, term) => total + (record.manifest.id.toLowerCase().includes(term) ? 4 : haystack.includes(term) ? 1 : 0), 0);
      candidates.push({
        hit: {
          id: record.manifest.id,
          title: record.manifest.title,
          summary: record.manifest.summary,
          schemaCostTokens: estimateSchemaTokensAll(record.manifest.tools),
          permissionSummary: record.manifest.permissionSummary,
          readiness: record.readiness.status,
        },
        score,
        order,
      });
      order += 1;
    }
    return candidates.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ hit }) => hit);
  }

  activate(id: string, context: CapabilityContext = {}): ActivationResult {
    const record = this.records.get(id);
    if (record === undefined) return { ok: false, code: "unknown", message: `capability '${id}' is not registered` };
    const settings = this.settings.get(id) ?? record.initialSettings;
    if (trustState(settings, record.digest) !== "trusted") {
      return { ok: false, code: "not-trusted", message: `capability '${id}' is not enabled and trusted for this manifest` };
    }
    if (record.manifest.runnerConformance !== "passed") {
      return { ok: false, code: "not-ready", message: `capability '${id}' has no conformed runner in this build (not_run); no callable tool is exposed` };
    }
    if (!record.manifest.supportedHarness.includes(this.options.harness())) {
      return { ok: false, code: "harness-unsupported", message: `capability '${id}' does not support harness '${this.options.harness()}'` };
    }
    if (record.readiness.status === "NeedsSetup" || record.readiness.status === "Unavailable") {
      return { ok: false, code: "not-ready", message: `capability '${id}' is ${record.readiness.status}: ${record.readiness.summary}` };
    }

    const existingLease = this.leases.get(id);
    if (existingLease !== undefined) {
      return {
        ok: true,
        capabilityId: id,
        toolsAdded: [],
        alreadyActive: true,
        schemaCostTokens: 0,
        effective: existingLease.path === "proxy" ? "immediate" : "next-model-request",
        lease: { ...existingLease },
      };
    }

    if (this.schemaResident.has(id)) {
      const lease = this.newLease(id, "resident", context.currentTurn ?? 0);
      this.leases.set(id, lease);
      return { ok: true, capabilityId: id, toolsAdded: [], alreadyActive: true, schemaCostTokens: 0, effective: "next-model-request", lease };
    }

    if (record.manifest.supportsProxyCall === true && this.proxy?.isAvailable(id) === true) {
      try {
        this.proxy.activate(id);
      } catch (error) {
        return { ok: false, code: "registration-failed", message: `proxy activation failed (${errorMessage(error)})` };
      }
      const lease = this.newLease(id, "proxy", context.currentTurn ?? 0);
      this.leases.set(id, lease);
      return { ok: true, capabilityId: id, toolsAdded: [], alreadyActive: false, schemaCostTokens: 0, effective: "immediate", lease };
    }
    if (record.manifest.tools.length === 0) {
      return { ok: false, code: "not-ready", message: `capability '${id}' has no registered tools or available proxy` };
    }

    const cost = estimateSchemaTokensAll(record.manifest.tools);
    const modeBudget = this.options.harness() === "simple" ? this.budgets.simple : this.budgets.full;
    const remaining = Math.min(modeBudget, this.budgets.epochCeiling) - this.spentSchemaTokens;
    if (cost > remaining) {
      return { ok: false, code: "budget-exceeded", message: `activation would spend ${cost} schema tokens; remaining budget ${Math.max(0, remaining)}` };
    }

    const newlyRegistered: string[] = [];
    try {
      for (const tool of record.manifest.tools) {
        const wasRegistered = this.options.registrar.isRegistered?.(tool.name) ?? false;
        this.options.registrar.register(tool);
        if (!wasRegistered) newlyRegistered.push(tool.name);
      }
    } catch (error) {
      for (const name of newlyRegistered.reverse()) {
        try { this.options.registrar.unregister(name); } catch { /* compensation is best effort */ }
      }
      return { ok: false, code: "registration-failed", message: `bundle registration failed (${errorMessage(error)}); active set unchanged` };
    }

    try {
      this.options.epoch.appendTools(record.manifest.tools.map((tool) => tool.name));
    } catch (error) {
      for (const name of newlyRegistered.reverse()) {
        try { this.options.registrar.unregister(name); } catch { /* compensation is best effort */ }
      }
      return { ok: false, code: "registration-failed", message: `epoch update failed (${errorMessage(error)}); active set unchanged` };
    }
    this.schemaResident.add(id);
    this.spentSchemaTokens += cost;
    const lease = this.newLease(id, "registered", context.currentTurn ?? 0);
    this.leases.set(id, lease);
    return {
      ok: true,
      capabilityId: id,
      toolsAdded: record.manifest.tools.map((tool) => tool.name),
      alreadyActive: false,
      schemaCostTokens: cost,
      effective: "next-model-request",
      lease,
    };
  }

  release(leaseId: string): { ok: true; schemaResidentUntilEpochEnd: boolean } | { ok: false; code: "unknown"; message: string } {
    const found = [...this.leases.entries()].find(([, lease]) => lease.leaseId === leaseId);
    if (found === undefined) return { ok: false, code: "unknown", message: `lease '${leaseId}' is not active` };
    const [capabilityId, lease] = found;
    if (lease.path === "proxy") {
      try { this.proxy?.release?.(capabilityId); } catch { /* release is best effort */ }
    }
    this.leases.delete(capabilityId);
    return { ok: true, schemaResidentUntilEpochEnd: lease.path !== "proxy" };
  }

  activeLeases(): ActiveCapabilityLease[] {
    return [...this.leases.values()].map((lease) => ({ ...lease }));
  }

  activeCapabilityIds(): string[] {
    return [...this.leases.keys()];
  }

  /** Identity changes clear runtime schemas/budget but keep user trust settings. */
  onEpochRebuild(): void {
    for (const [id, lease] of this.leases) {
      if (lease.path === "proxy") {
        try { this.proxy?.release?.(id); } catch { /* best effort */ }
      }
    }
    this.leases.clear();
    this.schemaResident.clear();
    this.spentSchemaTokens = 0;
  }

  schemaBudgetSnapshot(): { spent: number; ceiling: number; modeBudget: number; remaining: number } {
    const modeBudget = this.options.harness() === "simple" ? this.budgets.simple : this.budgets.full;
    const ceiling = Math.min(modeBudget, this.budgets.epochCeiling);
    return { spent: this.spentSchemaTokens, ceiling: this.budgets.epochCeiling, modeBudget, remaining: Math.max(0, ceiling - this.spentSchemaTokens) };
  }

  isSchemaResident(id: string): boolean {
    return this.schemaResident.has(id);
  }

  private require(id: string): RegisteredCapability {
    const record = this.records.get(id);
    if (record === undefined) throw new Error(`unknown capability '${id}'`);
    return record;
  }

  private newLease(capabilityId: string, path: ActivationPath, turn: number): ActiveCapabilityLease {
    return { leaseId: this.newLeaseId(), capabilityId, path, activatedAtTurn: turn, epochId: this.options.epoch.snapshot().epochId };
  }
}

export function digestCapabilityManifest(manifest: CapabilityManifest): string {
  const digestable = {
    ...manifest,
    // Runner conformance is host evidence, not a user-trusted code/content
    // change. A conformance result can improve without re-prompting trust.
    runnerConformance: undefined,
  };
  return createHash("sha256").update(stableStringify(digestable), "utf8").digest("hex");
}

export function validateManifest(manifest: CapabilityManifest): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.id)) throw new Error(`invalid capability id '${manifest.id}'`);
  if (manifest.title.trim() === "" || manifest.summary.trim() === "") throw new Error(`capability '${manifest.id}' needs title and summary`);
  if (!Array.isArray(manifest.tools) || !Array.isArray(manifest.supportedHarness) || manifest.supportedHarness.length === 0) {
    throw new Error(`capability '${manifest.id}' needs tools and supportedHarness`);
  }
  const names = new Set<string>();
  for (const tool of manifest.tools) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(tool.name) || tool.description.trim() === "") throw new Error(`invalid tool in capability '${manifest.id}'`);
    if (names.has(tool.name)) throw new Error(`duplicate tool '${tool.name}' in capability '${manifest.id}'`);
    names.add(tool.name);
  }
  if (manifest.supportedHarness.some((mode) => mode !== "simple" && mode !== "full")) throw new Error(`invalid harness in capability '${manifest.id}'`);
  if (manifest.runnerConformance !== "passed" && manifest.runnerConformance !== "not_run") throw new Error(`invalid runner status for '${manifest.id}'`);
}

function settingsForTrust(trust: TrustState, digest: string): CapabilitySettingsRecord {
  if (trust === "disabled") return { enabled: false };
  if (trust === "trusted") return { enabled: true, trustedDigest: digest };
  return { enabled: true };
}

function trustState(settings: CapabilitySettingsRecord, digest: string): TrustState {
  if (!settings.enabled) return "disabled";
  return settings.trustedDigest === digest ? "trusted" : "enabled-untrusted";
}

function defaultReadiness(manifest: CapabilityManifest): CapabilityReadiness {
  return manifest.runnerConformance === "passed"
    ? { status: "Ready", summary: "runner is available", missing: [], nextSteps: [], inspectedAt: new Date().toISOString() }
    : { status: "Unavailable", summary: "runner conformance has not been recorded", missing: ["runner conformance"], nextSteps: ["run the capability's User VM conformance check"], inspectedAt: new Date().toISOString() };
}

function validateReadiness(value: CapabilityReadiness): void {
  if (!["Ready", "Degraded", "NeedsSetup", "Unavailable"].includes(value.status)) throw new Error(`invalid readiness status '${value.status}'`);
}

function cloneReadiness(value: CapabilityReadiness): CapabilityReadiness {
  return { ...value, missing: [...value.missing], nextSteps: [...value.nextSteps] };
}

function cloneManifest(value: CapabilityManifest): CapabilityManifest {
  return { ...value, keywords: [...value.keywords], tools: value.tools.map((tool) => ({ ...tool })), supportedHarness: [...value.supportedHarness] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cryptoRandomId(): string {
  // Kept in a helper so deterministic tests can inject newLeaseId without
  // mocking global crypto.
  return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 20);
}
