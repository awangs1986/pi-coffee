import { registerContextWindow } from './context-window.js';
import { createLspManifest } from "./optional-tools.js";
import { PACKAGE_VERSION } from "../version.js";
import { chatPayload } from "./chat-payload.js";
import { HARNESS_BLOCK_PATTERN, refreshWorkPayload } from "./work-payload.js";
import { registerHarnessMode } from "./runtime-mode.js";
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
import { createWebAccessManifest, createWebSearchManifest } from "../extensions/web-access/capability.js";
import {
  WORK_TOOLS,
  CHAT_TOOLS,
  HANDOFF_TOOLS,
  promptProfileForMode,
  resolveToolTable,
  toolsForMode,
  type HarnessMode,
} from "./mode.js";
import { createNativeGitTool, type NativeCommandRunner } from "./native-git.js";
import {
  createMemoryVerifyState,
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

interface HarnessSessionState {
  version: 2;
  mode: HarnessMode;
  source?: "command" | "migration" | "new";
}

interface PersistedVerifyState {
  version: 1;
  cwd: string;
  state: VerifyWorkspaceState;
}

interface PersistedCapabilityState {
  version: 2;
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
  /** Host-verified User VM authority; injected as runtime scope, never baked into the generic Work body. */
  ownerAuthority?:boolean;
}

/** Native Pi extension; the VM remains the execution boundary. */
export default function harnessExtension(pi: ExtensionAPI): void {
  createHarnessExtension()(pi);
}

/** Factory keeps the Pi seam small while allowing deterministic test adapters. */
export function createHarnessExtension(options: HarnessExtensionOptions = {}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => installHarnessExtension(pi, options);
}

function installHarnessExtension(pi: ExtensionAPI, options: HarnessExtensionOptions): void {
  registerContextWindow(pi);
  let mode: HarnessMode = process.env.PI_COFFEE_INITIAL_MODE==="chat" ? "chat" : "work";
  registerHarnessMode(pi, () => mode);
  let turn = 0;
  let validState = true;
  let catalog: CapabilityCatalog | undefined;
  let epoch: ExecutionEpoch | undefined;
  const startupDiagnostics: string[] = [];
  let verifyState = createMemoryVerifyState();
  const run: NativeCommandRunner = (command, args, options) => pi.exec(command, args, options);
  const persistVerify = (cwd: string, state: VerifyWorkspaceState): void => {
    pi.appendEntry<PersistedVerifyState>(VERIFY_ENTRY, { version: 1, cwd, state });
  };

  const settings = options.settings ?? createDefaultSettingsStore(startupDiagnostics);
  const conformedCapabilities = options.conformedCapabilities ?? readCapabilitySet(process.env.PI_COFFEE_CONFORMED_CAPABILITIES);

  pi.registerTool(createSearchToolsTool(pi, () => mode, () => catalog, () => turn, persistCapabilityState));
  pi.registerTool(createNativeGitTool({ run }));

  // Mode policy lives in Harness. Native subagent schemas and execution stay upstream.
  pi.on("tool_call", event => {
    if (mode === "chat" && !([...CHAT_TOOLS, ...HANDOFF_TOOLS] as readonly string[]).includes(event.toolName)) {
      return { block: true, reason: "This tool is unavailable to the model in Chat; select Work." };
    }
  });

  function applyMode(nextMode: HarnessMode, persist = true): ReturnType<typeof resolveToolTable> {
    const table = resolveToolTable(nextMode, pi.getAllTools().map((tool) => tool.name));
    if (table.ready) {
      pi.setActiveTools([...table.active]);
      mode = nextMode;
      validState = true;
      if (epoch !== undefined) {
        epoch.rebuild({ harnessMode: nextMode }, table.active);
        catalog?.onEpochRebuild();
        if (persist) persistCapabilityState();
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

    const registrations = capabilityManifestRegistrations(pi);
    const lsp = createLspManifest(pi);
    if (lsp !== undefined) next.register(lsp, "trusted");
    const webSearch = createWebSearchManifest(pi);
    if (webSearch !== undefined) next.register(webSearch, "trusted");
    const webAccess = createWebAccessManifest(pi, conformedCapabilities);
    if (webAccess !== undefined) next.register(webAccess, "enabled-untrusted");

    for (const registration of registrations) {
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
      version: 2,
      mode,
      activeCapabilityIds: catalog.activeCapabilityIds(),
    });
  }

  function restoreCapabilityState(ctx: ExtensionContext): void {
    if (catalog === undefined || mode === "chat") return;
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
      version: 2,
      mode,
      source,
    });
  }

  async function switchMode(requested: string, ctx: ExtensionContext): Promise<void> {
    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait for the current turn to finish before switching Chat/Work.", "warning");
      return;
    }
    if (requested !== "chat" && requested !== "work") {
      ctx.ui.notify("Unknown mode; use /chat, /work or /harness chat|work.", "error");
      return;
    }
    const table = applyMode(requested);
    if (!table.ready) {
      ctx.ui.notify(`Cannot enter ${requested}: missing tools [${table.missing.join(", ")}]. Staying on ${mode}.`, "error");
      return;
    }
    if (!catalog) buildCatalog();
    persistMode("command");
    ctx.ui.notify(`Mode: ${mode}; system prompt: ${promptProfileForMode(mode)}; active tools: ${table.active.join(", ")}.`, "info");
  }
  pi.registerCommand("harness", {
    description: "Show version or switch Chat/Work: /harness [version|chat|work]",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (requested === "version") {
        ctx.ui.notify(`pi-coffee-harness ${PACKAGE_VERSION}`, "info");
        return;
      }
      if (!requested) {
        ctx.ui.notify(`Mode: ${mode}; system prompt: ${promptProfileForMode(mode)}; active tools: ${pi.getActiveTools().join(", ")}.`, "info");
        return;
      }
      await switchMode(requested, ctx);
    },
  });
  for (const name of ["chat", "work"] as const) pi.registerCommand(name, {
    description: name === "chat" ? "Chat: no system prompt, four basic tools and web search" : "Work: software development, tool discovery and Skills",
    handler: async (args, ctx) => {
      if (args.trim()) { ctx.ui.notify(`Usage: /${name}`, "error"); return; }
      await switchMode(name, ctx);
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
        if (profile === "tdd" && mode !== "work") {
          ctx.ui.notify("tdd profile is only reachable in /work", "warning");
          return;
        }
        setVerifyProfile(ctx.cwd, profile, verifyState, persistVerify);
        ctx.ui.notify(
          `verification profile set to '${profile}'. Commands run with the VM user's normal rights; results are evidence, not an automatic completion gate.`,
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
          ".picode/verify.json runs with the VM user's normal rights when /verify run is requested.",
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

  function restoreSession(_event: unknown, ctx: ExtensionContext): void {
    const stored = lastEntryData(ctx, HARNESS_ENTRY, isStoredHarnessState);
    // All pre-v2 sessions used software-development instructions. Preserve that
    // meaning instead of relabelling their histories as zero-system Chat.
    if (stored && stored.version !== 1 && !isHarnessState(stored)) {
      validState = false;
      pi.setActiveTools([]);
      catalog = undefined;
      epoch = undefined;
      ctx.ui.notify("Unknown stored mode state. History is preserved; explicitly select /chat or /work.", "error");
      return;
    }
    const migrated = stored !== undefined && stored.version === 1;
    const restoredMode = stored?.version === 2 && isHarnessState(stored) ? stored.mode : (!stored && process.env.PI_COFFEE_INITIAL_MODE==="chat" ? "chat" : "work");
    const restoredVerify = lastEntryData(ctx, VERIFY_ENTRY, (value): value is PersistedVerifyState =>
      isPersistedVerifyState(value) && value.cwd === ctx.cwd,
    );
    verifyState = createMemoryVerifyState();
    if (restoredVerify) verifyState.set(ctx.cwd, restoredVerify.state);
    const table = applyMode(restoredMode, false);
    if (!table.ready) {
      mode = restoredMode;
      pi.setActiveTools([]);
      ctx.ui.notify(`Cannot restore ${mode}: missing tools [${table.missing.join(", ")}]. Repair the extension setup or select another mode.`, "error");
    }
    buildCatalog();
    if (!migrated) restoreCapabilityState(ctx);
    if (migrated || !stored) persistMode(migrated ? "migration" : "new");
    if (migrated) ctx.ui.notify("Session migrated to Work. History is preserved; optional capabilities must be activated again. Use /chat to switch explicitly.", "info");
    if (startupDiagnostics.length > 0) ctx.ui.notify(`capability discovery diagnostics: ${startupDiagnostics.join(" | ")}`, "warning");
  }
  pi.on("session_start", restoreSession);
  pi.on("session_tree", restoreSession);

  pi.on("turn_start", (event) => {
    turn = event.turnIndex;
  });

  pi.on("model_select", () => {
    if (epoch === undefined || !validState) return;
    const table = resolveToolTable(mode, pi.getAllTools().map((tool) => tool.name));
    if (!table.ready) return;
    pi.setActiveTools([...table.active]);
    epoch.rebuild({ harnessMode: mode }, table.active);
    catalog?.onEpochRebuild();
    persistCapabilityState();
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!validState || !resolveToolTable(mode, pi.getAllTools().map(tool => tool.name)).ready) {
      // before_agent_start precedes Pi's run controller; abort again here at
      // the actual request seam so an invalid restoration cannot send a turn.
      ctx.abort();
      return;
    }
    if (mode === "chat") {
      pi.setActiveTools([...resolveToolTable(mode, pi.getAllTools().map(tool => tool.name)).active]);
      return chatPayload(event.payload);
    }
    try {
      return refreshWorkPayload(event.payload, workPromptBlock());
    } catch (error) {
      ctx.abort();
      ctx.ui.notify(`Work prompt unavailable: ${errorMessage(error)}`, "error");
      return;
    }
  });

  pi.on("before_agent_start", (event, ctx) => {
    const table = resolveToolTable(mode, pi.getAllTools().map(tool => tool.name));
    if (!validState || !table.ready) {
      ctx.abort();
      ctx.ui.notify(`Mode ${mode} is unavailable: missing ${table.missing.join(", ")}.`, "error");
      return { systemPrompt: "" };
    }
    if (mode === "chat") {
      pi.setActiveTools([...table.active]);
      return { systemPrompt: "" };
    }
    try {
      const block = workPromptBlock();
      const base = event.systemPrompt.replace(HARNESS_BLOCK_PATTERN, "").trimEnd();
      return { systemPrompt: base.length === 0 ? block : `${base}\n\n${block}` };
    } catch (error) {
      // Pi creates its run controller after this hook. Revalidate at the
      // provider boundary too, so a failed render cannot send an empty Work prompt.
      ctx.abort();
      ctx.ui.notify(`Work prompt unavailable: ${errorMessage(error)}`, "error");
      return { systemPrompt: "" };
    }
  });

  function workPromptBlock(): string {
    const active = pi.getActiveTools();
    const runtime = [
      `Active harness mode: ${mode}.`,
      `Base tool table has ${toolsForMode(mode).length} tools; effective active tools (${active.length}): ${active.join(", ")}.`,
      `Active optional capabilities: ${catalog?.activeCapabilityIds().join(", ") || "none"}.`,
      "These are runtime facts, not additional permissions.",
      ...((options.ownerAuthority ?? process.env.PI_COFFEE_VM_OWNER_AUTHORITY==='1') ? [
        "Execution scope: this Agent runs as the VM owner with verified passwordless sudo.",
        "Within an implementation request, reversible VM work and normal commit and push to the current Conversation branch are already authorized; do not request approval again.",
        "Shared/default branch merge, force-push, remote deletion, and publication remain scoped to explicit user intent.",
      ] : []),
    ].join("\n");
    const prompt = renderHarnessPrompt("work", active);
    return `${BLOCK_START}\n${prompt}\n\n## Runtime harness state\n\n${runtime}\n${BLOCK_END}`;
  }
}

function createSearchToolsTool(
  pi: ExtensionAPI,
  currentMode: () => HarnessMode,
  getCatalog: () => CapabilityCatalog | undefined,
  currentTurn: () => number,
  persist: () => void,
): ToolDefinition {
  return {
    name: "search_tools",
    label: "Search Tools",
    description:
      "Discover trusted, runner-ready optional capabilities and activate one bundle. Results contain summaries only; unlisted capabilities may be disabled, unconfigured, or unavailable; /capabilities reports setup state. Harness base tools are selected with /harness.",
    promptSnippet: "Search trusted optional capabilities when the active Harness tools cannot perform the task; activate a listed capability deliberately.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("activate")]),
      query: Type.Optional(Type.String({ description: "name or description search" })),
      capability_id: Type.Optional(Type.String({ description: "capability id to activate" })),
    }),
    async execute(_toolCallId, params) {
      const input = params as unknown as { action: "search" | "activate"; query?: string; capability_id?: string };
      if (currentMode() !== "work") return { content: [{ type: "text", text: "Capability discovery is available in Work. Use /work." }], details: { ok: false, code: "mode-disabled" } };
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
      persist();
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
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === customType && guard(entry.data)) return entry.data;
  }
  return undefined;
}

function isHarnessState(value: unknown): value is HarnessSessionState {
  if (!isRecord(value)) return false;
  return value.version === 2 && (value.mode === "chat" || value.mode === "work");
}

function isPersistedVerifyState(value: unknown): value is PersistedVerifyState {
  if (!isRecord(value) || value.version !== 1 || typeof value.cwd !== "string" || !isRecord(value.state)) return false;
  return isVerifyProfile(value.state.profile);
}

function isPersistedCapabilityState(value: unknown): value is PersistedCapabilityState {
  if (!isRecord(value) || value.version !== 2 || (value.mode !== "chat" && value.mode !== "work") || !Array.isArray(value.activeCapabilityIds)) return false;
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

export const HARNESS_TOOL_COUNTS = Object.freeze({
  chat: CHAT_TOOLS.length,
  work: WORK_TOOLS.length,
});

function isStoredHarnessState(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
