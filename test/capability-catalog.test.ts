import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapabilityCatalog,
  type CapabilityManifest,
  type CapabilityProxy,
  type ToolRegistrar,
} from "../src/capabilities/catalog.js";
import { ExecutionEpoch } from "../src/capabilities/execution-epoch.js";
import { loadCapabilityManifests } from "../src/capabilities/manifest-loader.js";
import {
  FileCapabilitySettingsStore,
  MemoryCapabilitySettingsStore,
} from "../src/capabilities/settings.js";
import { SCHEMA_BUDGETS, estimateSchemaTokens } from "../src/capabilities/schema-budget.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function manifest(
  id: string,
  toolNames: string[],
  overrides: Partial<CapabilityManifest> = {},
): CapabilityManifest {
  return {
    id,
    kind: "pi-extension",
    origin: "suite",
    title: `${id} title`,
    summary: `${id} performs bounded work`,
    keywords: [id, "research"],
    tools: toolNames.map((name) => ({
      name,
      description: `${name} does useful work`,
      parameters: { type: "object", properties: { query: { type: "string" } } },
    })),
    supportedHarness: ["simple", "full"],
    permissionSummary: "runs with the owning User VM's normal rights",
    runnerConformance: "passed",
    ...overrides,
  };
}

function setup(options: {
  mode?: "simple" | "full";
  failOn?: string;
  proxy?: CapabilityProxy;
  settings?: MemoryCapabilitySettingsStore;
} = {}) {
  let mode = options.mode ?? "simple";
  let registered: string[] = [];
  const registrar: ToolRegistrar = {
    register(tool) {
      if (tool.name === options.failOn) throw new Error(`refuse ${tool.name}`);
      registered.push(tool.name);
    },
    unregister(name) {
      registered = registered.filter((candidate) => candidate !== name);
    },
  };
  const epoch = new ExecutionEpoch({ harnessMode: mode }, ["read", "search_tools"], () => "epoch-test");
  const catalog = new CapabilityCatalog({
    epoch,
    registrar,
    harness: () => mode,
    settings: options.settings ?? new MemoryCapabilitySettingsStore(),
    proxy: options.proxy,
    newLeaseId: (() => {
      let serial = 0;
      return () => `lease-${++serial}`;
    })(),
    now: () => "2026-09-03T00:00:00.000Z",
  });
  return {
    catalog,
    epoch,
    registered: () => [...registered],
    setMode(next: "simple" | "full") {
      mode = next;
      epoch.rebuild({ harnessMode: next }, ["read", "search_tools"]);
      catalog.onEpochRebuild();
    },
  };
}

describe("CapabilityCatalog", () => {
  it("keeps enable/trust digest separate from runner and runtime state", () => {
    const settings = new MemoryCapabilitySettingsStore();
    const { catalog } = setup({ settings });
    const first = manifest("web", ["web_search"]);
    catalog.register(first, "enabled-untrusted");

    expect(catalog.search("web")).toEqual([]);
    expect(catalog.listSettings()[0]).toMatchObject({
      id: "web",
      trust: "enabled-untrusted",
      runnerConformance: "passed",
      agentVisible: false,
      schemaResident: false,
    });

    catalog.trustCurrent("web");
    expect(catalog.search("web").map((hit) => hit.id)).toEqual(["web"]);
    expect(catalog.search("web")[0]).not.toHaveProperty("tools");

    catalog.register({ ...first, summary: "the manifest changed" }, "enabled-untrusted");
    expect(catalog.listSettings()[0]?.trust).toBe("enabled-untrusted");
    expect(catalog.search("web")).toEqual([]);

    catalog.disable("web");
    expect(catalog.listSettings()[0]?.trust).toBe("disabled");
    catalog.enable("web");
    expect(catalog.listSettings()[0]?.trust).toBe("enabled-untrusted");
  });

  it("hides not-run and harness-incompatible capabilities from the agent", () => {
    const { catalog, setMode } = setup();
    catalog.register(manifest("subagent", ["subagent"], {
      supportedHarness: ["full"],
      runnerConformance: "not_run",
    }), "trusted");
    catalog.register(manifest("lsp", ["lsp"], { supportedHarness: ["full"] }), "trusted");

    expect(catalog.search("subagent lsp")).toEqual([]);
    expect(catalog.activate("subagent", { currentTurn: 1 })).toMatchObject({ ok: false, code: "not-ready" });
    expect(catalog.activate("lsp", { currentTurn: 1 })).toMatchObject({ ok: false, code: "harness-unsupported" });

    setMode("full");
    expect(catalog.search("lsp").map((hit) => hit.id)).toEqual(["lsp"]);
    expect(catalog.search("subagent")).toEqual([]);
  });

  it("activates a registered bundle atomically, returns a lease, and is idempotent", () => {
    const failed = setup({ failOn: "tool_b" });
    failed.catalog.register(manifest("broken", ["tool_a", "tool_b", "tool_c"]), "trusted");
    const before = failed.epoch.snapshot();
    expect(failed.catalog.activate("broken", { currentTurn: 2 })).toMatchObject({
      ok: false,
      code: "registration-failed",
    });
    expect(failed.registered()).toEqual([]);
    expect(failed.epoch.snapshot().activeTools).toEqual(before.activeTools);

    const working = setup();
    working.catalog.register(manifest("bundle", ["tool_a", "tool_b"]), "trusted");
    const first = working.catalog.activate("bundle", { currentTurn: 3 });
    expect(first).toMatchObject({
      ok: true,
      alreadyActive: false,
      toolsAdded: ["tool_a", "tool_b"],
      effective: "next-model-request",
      lease: { leaseId: "lease-1", capabilityId: "bundle", path: "registered", activatedAtTurn: 3 },
    });
    expect(working.epoch.snapshot()).toMatchObject({
      activeTools: ["read", "search_tools", "tool_a", "tool_b"],
      cacheEpoch: 1,
    });

    const second = working.catalog.activate("bundle", { currentTurn: 4 });
    expect(second).toMatchObject({ ok: true, alreadyActive: true, toolsAdded: [], lease: { leaseId: "lease-1" } });
    expect(working.registered()).toEqual(["tool_a", "tool_b"]);
  });

  it("enforces schema budget and resets only runtime state on an epoch rebuild", () => {
    const { catalog, epoch, setMode } = setup();
    const huge = {
      name: "huge",
      description: "x".repeat(SCHEMA_BUDGETS.simple * 3 + 2_000),
      parameters: { type: "object" },
    };
    expect(estimateSchemaTokens(huge)).toBeGreaterThan(SCHEMA_BUDGETS.simple);
    catalog.register({ ...manifest("huge", []), tools: [huge] }, "trusted");
    const before = epoch.snapshot();
    expect(catalog.activate("huge", { currentTurn: 1 })).toMatchObject({ ok: false, code: "budget-exceeded" });
    expect(epoch.snapshot().activeTools).toEqual(before.activeTools);

    catalog.register(manifest("small", ["small_tool"]), "trusted");
    expect(catalog.activate("small", { currentTurn: 1 }).ok).toBe(true);
    expect(catalog.listSettings().find((entry) => entry.id === "small")?.schemaResident).toBe(true);
    setMode("full");
    expect(catalog.listSettings().find((entry) => entry.id === "small")).toMatchObject({
      trust: "trusted",
      schemaResident: false,
    });
    expect(catalog.schemaBudgetSnapshot().spent).toBe(0);
  });

  it("uses a pre-existing proxy deterministically without adding schemas", () => {
    const active: string[] = [];
    const proxy: CapabilityProxy = {
      isAvailable: (id) => id === "mcp",
      activate: (id) => active.push(id),
      release: (id) => active.splice(active.indexOf(id), 1),
    };
    const { catalog, epoch } = setup({ proxy });
    catalog.register(manifest("mcp", [], { supportsProxyCall: true }), "trusted");

    const result = catalog.activate("mcp", { currentTurn: 7 });
    expect(result).toMatchObject({
      ok: true,
      toolsAdded: [],
      schemaCostTokens: 0,
      effective: "immediate",
      lease: { path: "proxy" },
    });
    expect(active).toEqual(["mcp"]);
    expect(epoch.snapshot().cacheEpoch).toBe(0);
    if (result.ok) expect(catalog.release(result.lease.leaseId)).toMatchObject({ ok: true, schemaResidentUntilEpochEnd: false });
    expect(active).toEqual([]);
  });
});

describe("Capability manifest and settings persistence", () => {
  it("discovers bounded JSON manifests without loading extension code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-coffee-capabilities-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "search.capability.json"), JSON.stringify({
      schemaVersion: 1,
      id: "enhanced-web",
      kind: "pi-extension",
      title: "Enhanced web search",
      summary: "API-backed search",
      keywords: ["web", "search"],
      tools: [{ name: "web_search", description: "search", parameters: { type: "object" } }],
      supportedHarness: ["simple", "full"],
      permissionSummary: "network access through the configured Adapter",
      supportsProxyCall: false,
    }));
    await writeFile(join(directory, "bad.capability.json"), "{not json");

    const report = loadCapabilityManifests([directory], {
      conformanceFor: (id) => id === "enhanced-web" ? "passed" : "not_run",
    });
    expect(report.manifests).toEqual([
      expect.objectContaining({ id: "enhanced-web", runnerConformance: "passed" }),
    ]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]?.message).toMatch(/JSON|parse/i);
  });

  it("persists only user-owned enable/trustedDigest settings with a private file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-coffee-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "capabilities.json");
    const first = new FileCapabilitySettingsStore(path);
    first.set("web", { enabled: true, trustedDigest: "a".repeat(64) });
    const second = new FileCapabilitySettingsStore(path);
    expect(second.get("web")).toEqual({ enabled: true, trustedDigest: "a".repeat(64) });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      capabilities: [{ id: "web", enabled: true, trustedDigest: "a".repeat(64) }],
    });
    if (process.platform !== "win32") {
      await chmod(path, 0o600);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });
});
