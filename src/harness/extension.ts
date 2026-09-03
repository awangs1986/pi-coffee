import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CapabilityCatalog,
  type CapabilityManifest,
  type HarnessMode as CapabilityHarnessMode,
} from "../capabilities/catalog.js";
import { ExecutionEpoch } from "../capabilities/execution-epoch.js";
import { loadCapabilityManifests } from "../capabilities/manifest-loader.js";
import { createPiToolRegistrar } from "../capabilities/pi-registrar.js";
import { capabilityManifestRegistrations } from "../capabilities/registry.js";
import {
  FileCapabilitySettingsStore,
  MemoryCapabilitySettingsStore,
  type CapabilitySettingsStore,
  type TrustState,
} from "../capabilities/settings.js";
import { createSubagentsManifest } from "../subagents/capability.js";
import { createWebAccessManifest } from "../web/capability.js";
import {
  FULL_TOOLS,
  SIMPLE_TOOLS,
  mapHarnessAlias,
  promptProfileForMode,
  resolveToolTable,
  toolsForMode,
  type HarnessMode,
} from "./mode.js";
import { createNativeGitTool, type NativeCommandRunner } from "./native-git.js";
import {
  createMemoryVerifyState,
  createNativeVerifyTool,
  executeProfile,
  renderVerifyStatus,
  setVerifyProfile,
  type VerifyProfile,
  type VerifyWorkspaceState,
} from "./native-verify.js";
import { renderHarnessPrompt } from "./prompt.js";

const HARNESS_ENTRY = "pi-coffee-harness-state";
const VERIFY_ENTRY = "pi-coffee-verify-state";
const CAPABILITY_ENTRY = "pi-coffee-capability-state";
const BLOCK_START = "<pi_coffee_harness>";
const BLOCK_END = "</pi_coffee_harness>";
const BLOCK_PATTERN = /(?:\n\n)?<pi_coffee_harness>[\s\S]*?<\/pi_coffee_harness>/g;

interface HarnessSessionState {
  version: 1;
  mode: HarnessMode;
  source?: "simple" | "full" | "standard" | "tdd";
  baseline: "awangs/picode@778a3d534ba41f331210037a8c791bdfc0dabe7f";
}

interface PersistedVerifyState {
  version: 1;
  cwd: string;
  state: VerifyWorkspaceState;
}

interface PersistedCapabilityState {
  version: 1;
  mode: HarnessMode;
  activeCapabilityIds: string[];
}

export interface HarnessExtensionOptions {
  /** Injectable settings store for tests; production uses the User VM file. */
  settings?: CapabilitySettingsStore;
  /** Host evidence; a package cannot self-attest runner conformance. */
  conformedCapabilities?: ReadonlySet<string>;
  /** Additional user/task manifests, read without executing extension code. */
  manifests?: readonly CapabilityManifest[];
  manifestDirectories?: readonly string[];
}

/**
 * PI Coffee's native Pi extension.
 *
 * This is the single Interface joining the V3-derived Lean/Full prompt with
 * the frozen V5 8/10 tool contract.  It stays deliberately independent of
 * V5's Guard, permission, managed-snapshot, and Devloop Modules.
 */
export default function harnessExtension(pi: ExtensionAPI): void {
  createHarnessExtension()(pi);
}

/** Factory keeps the Pi seam small while allowing deterministic test adapters. */
export function createHarnessExtension(options: HarnessExtensionOptions = {}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => installHarnessExtension(pi, options);
}

function installHarnessExtension(pi: ExtensionAPI, options: HarnessExtensionOptions): void {
  let mode: HarnessMode = "simple";
  let turn = 0;
  let catalog: CapabilityCatalog | undefined;
  let epoch: ExecutionEpoch | undefined;
  const startupDiagnostics: string[] = [];
  const prompts = {
    lean: renderHarnessPrompt("lean"),
    full: renderHarnessPrompt("full"),
  } as const;
  const verifyState = createMemoryVerifyState();
  const run: NativeCommandRunner = (command, args, options) => pi.exec(command, args, options);
  const persistVerify = (cwd: string, state: VerifyWorkspaceState): void => {
    pi.appendEntry<PersistedVerifyState>(VERIFY_ENTRY, { version: 1, cwd, state });
  };

  const settings = options.settings ?? createDefaultSettingsStore(startupDiagnostics);
  const conformedCapabilities = options.conformedCapabilities ?? readCapabilitySet(process.env.PI_COFFEE_CONFORMED_CAPABILITIES);

  pi.registerTool(createSearchToolsTool(pi, () => mode, () => catalog, () => turn));
  pi.registerTool(createNativeGitTool({ run }));
  pi.registerTool(createNativeVerifyTool({ run, state: verifyState, persist: persistVerify }));

  function applyMode(nextMode: HarnessMode): ReturnType<typeof resolveToolTable> {
    const table = resolveToolTable(nextMode, pi.getAllTools().map((tool) => tool.name));
    if (table.ready) {
      pi.setActiveTools([...table.active]);
      mode = nextMode;
      if (epoch !== undefined) {
        epoch.rebuild({ harnessMode: nextMode }, table.active);
        catalog?.onEpochRebuild();
        persistCapabilityState();
      }
    }
    return table;
  }

  function buildCatalog(): CapabilityCatalog {
    const table = resolveToolTable(mode, pi.getAllTools().map((tool) => tool.name));
    epoch = new ExecutionEpoch({ harnessMode: mode }, table.active);
    const next = new CapabilityCatalog({
      epoch,
      registrar: createPiToolRegistrar(pi),
      harness: () => mode as CapabilityHarnessMode,
      settings,
    });

    const subagents = createSubagentsManifest(pi, conformedCapabilities);
    if (subagents !== undefined) next.register(subagents, "trusted");

    const webAccess = createWebAccessManifest(pi, conformedCapabilities);
    if (webAccess !== undefined) next.register(webAccess, "enabled-untrusted");

    for (const registration of capabilityManifestRegistrations(pi)) {
      next.register(
        withConformance(registration.manifest, conformedCapabilities, registration.conformanceSource),
        registration.initialTrust ?? "enabled-untrusted",
      );
      if (registration.readiness !== undefined) next.setReadiness(registration.manifest.id, registration.readiness);
    }

    const configured = options.manifests ?? [];
    for (const manifest of configured) next.register(withConformance(manifest, conformedCapabilities, "host"), "disabled");

    const directories = options.manifestDirectories ?? readManifestDirectories(process.env.PI_COFFEE_CAPABILITY_DIRS);
    if (directories.length > 0) {
      const report = loadCapabilityManifests(directories, { conformanceFor: (id) => conformedCapabilities.has(id) ? "passed" : "not_run" });
      for (const manifest of report.manifests) next.register(manifest, "disabled");
      startupDiagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`));
    }
    catalog = next;
    return next;
  }

  function persistCapabilityState(): void {
    if (catalog === undefined) return;
    pi.appendEntry<PersistedCapabilityState>(CAPABILITY_ENTRY, {
      version: 1,
      mode,
      activeCapabilityIds: catalog.activeCapabilityIds(),
    });
  }

  function restoreCapabilityState(ctx: ExtensionContext): void {
    if (catalog === undefined) return;
    const state = lastEntryData(ctx, CAPABILITY_ENTRY, isPersistedCapabilityState);
    if (state === undefined || state.mode !== mode) return;
    const failures: string[] = [];
    for (const id of state.activeCapabilityIds) {
      const result = catalog.activate(id, { currentTurn: turn });
      if (!result.ok) failures.push(`${id}: ${result.code}`);
    }
    if (catalog.activeCapabilityIds().length > 0) {
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...catalog.activeLeases().flatMap((lease) => {
        const manifest = catalog?.manifest(lease.capabilityId);
        return manifest?.tools.map((tool) => tool.name) ?? [];
      })])]);
    }
    if (failures.length > 0) ctx.ui.notify(`capability activation restore skipped: ${failures.join(", ")}`, "warning");
  }

  function persistMode(source: HarnessSessionState["source"]): void {
    pi.appendEntry<HarnessSessionState>(HARNESS_ENTRY, {
      version: 1,
      mode,
      source,
      baseline: "awangs/picode@778a3d534ba41f331210037a8c791bdfc0dabe7f",
    });
  }

  pi.registerCommand("harness", {
    description: "Show or switch PI Coffee harness: /harness [simple|full] (V3 aliases: standard|tdd)",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (requested.length === 0) {
        const active = pi.getActiveTools();
        const optional = catalog?.activeCapabilityIds() ?? [];
        ctx.ui.notify(
          `harness mode: ${mode}; prompt=${promptProfileForMode(mode)}; V5 base=${toolsForMode(mode).length}; effective active tools (${active.length}): ${active.join(", ")}; capabilities: ${optional.join(", ") || "none"}`,
          "info",
        );
        return;
      }

      const alias = mapHarnessAlias(requested);
      const nextMode: HarnessMode | undefined =
        requested === "simple" || requested === "full" ? requested : alias?.mode;
      if (nextMode === undefined) {
        ctx.ui.notify(`unknown harness mode '${requested}'; valid: simple | full (V3 aliases: standard, tdd)`, "error");
        return;
      }

      const table = applyMode(nextMode);
      if (!table.ready) {
        ctx.ui.notify(
          `harness ${nextMode} is not ready: missing tools [${table.missing.join(", ")}]. Staying on '${mode}'.`,
          "warning",
        );
        return;
      }

      if (requested === "standard") setVerifyProfile(ctx.cwd, "quick", verifyState, persistVerify);
      if (requested === "tdd") setVerifyProfile(ctx.cwd, "tdd", verifyState, persistVerify);
      if (requested === "simple") setVerifyProfile(ctx.cwd, "none", verifyState, persistVerify);
      persistMode(requested as HarnessSessionState["source"]);
      const compatibility = alias
        ? ` V3 alias '${requested}' maps to '${nextMode}'${requested === "tdd" ? " + advisory tdd profile" : " + quick profile"}; no third tool table exists.`
        : "";
      ctx.ui.notify(
        `harness mode set to '${nextMode}' with prompt '${promptProfileForMode(nextMode)}'. active tools (${table.active.length}): ${table.active.join(", ")}.${compatibility}`,
        "info",
      );
    },
  });

  pi.registerCommand("verify", {
    description: "VM-native verification: /verify [run|profile none|quick|tdd]",
    handler: async (args, ctx) => {
      const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (parts[0] === "profile") {
        const profile = parts[1];
        if (!isVerifyProfile(profile)) {
          ctx.ui.notify("usage: /verify profile none|quick|tdd", "error");
          return;
        }
        if (profile === "tdd" && mode !== "full") {
          ctx.ui.notify("tdd profile is only reachable in /harness full", "warning");
          return;
        }
        setVerifyProfile(ctx.cwd, profile, verifyState, persistVerify);
        ctx.ui.notify(
          `verification profile set to '${profile}'. Commands run in the User VM; no V5 Guard, Gate Evidence, or Completion Label is installed.`,
          "info",
        );
        return;
      }
      if (parts[0] === "run") {
        const result = await executeProfile(ctx.cwd, verifyState, persistVerify, run, ctx.signal);
        ctx.ui.notify(renderRunForCommand(result), result.overall === "failed" ? "error" : "info");
        return;
      }
      if (parts[0] === "trust") {
        ctx.ui.notify(
          "PI Coffee has no V5 config-trust gate. .picode/verify.json runs with the owning User VM's normal rights when /verify run is requested.",
          "warning",
        );
        return;
      }
      ctx.ui.notify(renderVerifyStatus(ctx.cwd, verifyState.get(ctx.cwd)), "info");
    },
  });

  pi.registerCommand("capabilities", {
    description: "User-owned capability settings: /capabilities [list|enable|trust|disable|readiness]",
    handler: async (args, ctx) => {
      if (catalog === undefined) {
        ctx.ui.notify("capability catalog is not ready; start or resume a session first", "warning");
        return;
      }
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const operation = (parts[0] ?? "list").toLowerCase();
      const id = parts[1];
      if (operation === "enable" || operation === "trust" || operation === "disable") {
        if (!id) {
          ctx.ui.notify(`usage: /capabilities ${operation} <capability-id>`, "error");
          return;
        }
        try {
          if (operation === "enable") catalog.enable(id);
          if (operation === "trust") catalog.trustCurrent(id);
          if (operation === "disable") catalog.disable(id);
          // Settings changes start a fresh runtime epoch; they never mutate
          // the model's current tool set halfway through a request.
          applyMode(mode);
          ctx.ui.notify(`capability '${id}' setting changed to ${operation}; activate it again if it is ready`, "info");
        } catch (error) {
          ctx.ui.notify(`capability setting failed: ${errorMessage(error)}`, "error");
        }
        return;
      }
      if (operation === "readiness") {
        const entries = catalog.listSettings();
        ctx.ui.notify(entries.length === 0 ? "no capability manifests" : entries.map((entry) => `${entry.id}: ${entry.readiness.status} — ${entry.readiness.summary}`).join("\n"), "info");
        return;
      }
      if (operation !== "list") {
        ctx.ui.notify("usage: /capabilities [list|enable|trust|disable|readiness]", "error");
        return;
      }
      const entries = catalog.listSettings();
      ctx.ui.notify(entries.length === 0
        ? "no capability manifests"
        : entries.map((entry) => `${entry.id} [${entry.trust}; runner=${entry.runnerConformance}; readiness=${entry.readiness.status}; agent=${entry.agentVisible ? "visible" : "hidden"}]`).join("\n"), "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const restoredMode = lastEntryData(ctx, HARNESS_ENTRY, isHarnessState)?.mode ?? "simple";
    const restoredVerify = lastEntryData(ctx, VERIFY_ENTRY, (value): value is PersistedVerifyState =>
      isPersistedVerifyState(value) && value.cwd === ctx.cwd,
    );
    if (restoredVerify) verifyState.set(ctx.cwd, restoredVerify.state);

    const table = applyMode(restoredMode);
    if (!table.ready) {
      const fallback = applyMode("simple");
      ctx.ui.notify(
        `session harness '${restoredMode}' cannot be restored (missing: ${table.missing.join(", ")}); ` +
          `using simple (${fallback.active.length}/${SIMPLE_TOOLS.length})`,
        "warning",
      );
    }
    const current = buildCatalog();
    restoreCapabilityState(ctx);
    if (startupDiagnostics.length > 0) ctx.ui.notify(`capability discovery diagnostics: ${startupDiagnostics.join(" | ")}`, "warning");
    // Keep the variable used so a future adapter can inspect the epoch through
    // this closure without widening the Pi interface.
    void current;
  });

  pi.on("turn_start", (event) => {
    turn = event.turnIndex;
  });

  pi.on("model_select", () => {
    if (epoch === undefined) return;
    const table = resolveToolTable(mode, pi.getAllTools().map((tool) => tool.name));
    if (!table.ready) return;
    pi.setActiveTools([...table.active]);
    epoch.rebuild({ harnessMode: mode }, table.active);
    catalog?.onEpochRebuild();
    persistCapabilityState();
  });

  pi.on("before_agent_start", (event) => {
    const profile = promptProfileForMode(mode);
    const active = pi.getActiveTools();
    const prompt = prompts[profile];
    const runtime = [
      `Active harness mode: ${mode}.`,
      `V5 base table has ${toolsForMode(mode).length} tools; effective active tools (${active.length}): ${active.join(", ")}.`,
      `Active optional capabilities: ${catalog?.activeCapabilityIds().join(", ") || "none"}.`,
      "These are runtime facts, not additional permissions.",
    ].join("\n");
    const block = `${BLOCK_START}\n${prompt}\n\n## Runtime harness state\n\n${runtime}\n${BLOCK_END}`;
    const base = event.systemPrompt.replace(BLOCK_PATTERN, "").trimEnd();
    return { systemPrompt: base.length === 0 ? block : `${base}\n\n${block}` };
  });
}

function createSearchToolsTool(
  pi: ExtensionAPI,
  currentMode: () => HarnessMode,
  getCatalog: () => CapabilityCatalog | undefined,
  currentTurn: () => number,
): ToolDefinition {
  return {
    name: "search_tools",
    label: "Search Tools",
    description:
      "Discover trusted, runner-ready optional capabilities and activate one bundle. Results contain summaries only; capabilities not listed here do not exist for this session. Harness base tools are selected with /harness.",
    promptSnippet: "Search trusted optional capabilities when the active Harness tools cannot perform the task; activate a listed capability deliberately.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("activate")]),
      query: Type.Optional(Type.String({ description: "name or description search" })),
      capability_id: Type.Optional(Type.String({ description: "capability id to activate" })),
    }),
    async execute(_toolCallId, params) {
      const input = params as unknown as { action: "search" | "activate"; query?: string; capability_id?: string };
      const activeCatalog = getCatalog();
      if (activeCatalog === undefined) return { content: [{ type: "text", text: "Capability catalog is not ready." }], details: { ok: false, code: "not-ready" } };
      if (input.action === "search") {
        const hits = activeCatalog.search(input.query ?? "");
        const text = hits.length === 0
          ? "No matching trusted capabilities."
          : hits.map((hit) => `${hit.id}: ${hit.title} — ${hit.summary} (schema cost ~${hit.schemaCostTokens} tokens; ${hit.readiness}; ${hit.permissionSummary})`).join("\n");
        return { content: [{ type: "text", text }], details: { hits } };
      }
      const id = (input.capability_id ?? "").trim();
      const result = activeCatalog.activate(id, { currentTurn: currentTurn() });
      if (!result.ok) return { content: [{ type: "text", text: `Activation failed (${result.code}): ${result.message}` }], details: result };
      if (result.toolsAdded.length > 0) pi.setActiveTools([...new Set([...pi.getActiveTools(), ...result.toolsAdded])]);
      return {
        content: [{ type: "text", text: result.alreadyActive ? `Capability ${result.capabilityId} is already active.` : `Activated ${result.capabilityId}; its tools are available from the next model request.` }],
        details: result,
        addedToolNames: result.toolsAdded,
      };
    },
  };
}

function lastEntryData<T>(
  ctx: ExtensionContext,
  customType: string,
  guard: (value: unknown) => value is T,
): T | undefined {
  const entries = ctx.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === customType && guard(entry.data)) return entry.data;
  }
  return undefined;
}

function isHarnessState(value: unknown): value is HarnessSessionState {
  if (!isRecord(value)) return false;
  return value.version === 1 && (value.mode === "simple" || value.mode === "full");
}

function isPersistedVerifyState(value: unknown): value is PersistedVerifyState {
  if (!isRecord(value) || value.version !== 1 || typeof value.cwd !== "string" || !isRecord(value.state)) return false;
  return isVerifyProfile(value.state.profile);
}

function isPersistedCapabilityState(value: unknown): value is PersistedCapabilityState {
  if (!isRecord(value) || value.version !== 1 || (value.mode !== "simple" && value.mode !== "full") || !Array.isArray(value.activeCapabilityIds)) return false;
  return value.activeCapabilityIds.every((id) => typeof id === "string" && id.length > 0);
}

function isVerifyProfile(value: unknown): value is VerifyProfile {
  return value === "none" || value === "quick" || value === "tdd";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withConformance(
  manifest: CapabilityManifest,
  conformed: ReadonlySet<string>,
  source: "local" | "host" | undefined,
): CapabilityManifest {
  return {
    ...manifest,
    keywords: [...manifest.keywords],
    tools: manifest.tools.map((tool) => ({ ...tool })),
    supportedHarness: [...manifest.supportedHarness],
    runnerConformance: source === "local" || conformed.has(manifest.id) ? "passed" : "not_run",
  };
}

function readCapabilitySet(raw: string | undefined): ReadonlySet<string> {
  return new Set((raw ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

function readManifestDirectories(raw: string | undefined): string[] {
  return (raw ?? "").split(process.platform === "win32" ? ";" : ":").map((path) => path.trim()).filter(Boolean);
}

function createDefaultSettingsStore(diagnostics: string[]): CapabilitySettingsStore {
  if (isDisabled(process.env.PI_COFFEE_CAPABILITY_SETTINGS)) return new MemoryCapabilitySettingsStore();
  const configured = process.env.PI_COFFEE_CAPABILITY_SETTINGS?.trim();
  const path = configured && configured.length > 0
    ? configured
    : join(
      process.env.PI_COFFEE_AGENT_DIR?.trim()
        || process.env.PI_CODING_AGENT_DIR?.trim()
        || join(homedir(), ".pi", "agent"),
      "pi-coffee",
      "capabilities.json",
    );
  try {
    return new FileCapabilitySettingsStore(path);
  } catch (error) {
    diagnostics.push(`settings ${path}: ${errorMessage(error)}; using empty in-memory settings`);
    return new MemoryCapabilitySettingsStore();
  }
}

function isDisabled(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderRunForCommand(run: { profile: VerifyProfile; overall: string; commands: Array<{ status: string; name: string; detail: string }> }): string {
  const lines = [`verify [${run.profile}] overall: ${run.overall}`];
  for (const command of run.commands) lines.push(`  ${command.status.padEnd(8)} ${command.name}: ${command.detail}`);
  if (run.commands.length === 0) lines.push("  (no commands configured — configure .picode/verify.json)");
  return lines.join("\n");
}

export const V5_HARNESS_TOOL_COUNTS = Object.freeze({
  simple: SIMPLE_TOOLS.length,
  full: FULL_TOOLS.length,
});
