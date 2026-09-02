import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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

/**
 * PI Coffee's native Pi extension.
 *
 * This is the single Interface joining the V3-derived Lean/Full prompt with
 * the frozen V5 8/10 tool contract.  It stays deliberately independent of
 * V5's Guard, permission, managed-snapshot, and Devloop Modules.
 */
export default function harnessExtension(pi: ExtensionAPI): void {
  let mode: HarnessMode = "simple";
  const prompts = {
    lean: renderHarnessPrompt("lean"),
    full: renderHarnessPrompt("full"),
  } as const;
  const verifyState = createMemoryVerifyState();
  const run: NativeCommandRunner = (command, args, options) => pi.exec(command, args, options);
  const persistVerify = (cwd: string, state: VerifyWorkspaceState): void => {
    pi.appendEntry<PersistedVerifyState>(VERIFY_ENTRY, { version: 1, cwd, state });
  };

  pi.registerTool(createSearchToolsTool(pi, () => mode));
  pi.registerTool(createNativeGitTool({ run }));
  pi.registerTool(createNativeVerifyTool({ run, state: verifyState, persist: persistVerify }));

  function applyMode(nextMode: HarnessMode): ReturnType<typeof resolveToolTable> {
    const table = resolveToolTable(nextMode, pi.getAllTools().map((tool) => tool.name));
    if (table.ready) {
      pi.setActiveTools([...table.active]);
      mode = nextMode;
    }
    return table;
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
        ctx.ui.notify(
          `harness mode: ${mode}; prompt=${promptProfileForMode(mode)}; V5 base=${toolsForMode(mode).length}; effective active tools (${active.length}): ${active.join(", ")}`,
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
  });

  pi.on("before_agent_start", (event) => {
    const profile = promptProfileForMode(mode);
    const active = pi.getActiveTools();
    const prompt = prompts[profile];
    const runtime = [
      `Active harness mode: ${mode}.`,
      `V5 base table has ${toolsForMode(mode).length} tools; effective active tools (${active.length}): ${active.join(", ")}.`,
      "These are runtime facts, not additional permissions.",
    ].join("\n");
    const block = `${BLOCK_START}\n${prompt}\n\n## Runtime harness state\n\n${runtime}\n${BLOCK_END}`;
    const base = event.systemPrompt.replace(BLOCK_PATTERN, "").trimEnd();
    return { systemPrompt: base.length === 0 ? block : `${base}\n\n${block}` };
  });
}

function createSearchToolsTool(pi: ExtensionAPI, currentMode: () => HarnessMode): ToolDefinition {
  return {
    name: "search_tools",
    label: "Search Tools",
    description:
      "Search tools registered in this Pi process and activate optional tools. git and verify are Full harness tools; packaged extensions such as subagent and bg_wait remain optional and do not change the frozen 8/10 base tables.",
    promptSnippet: "Search registered tools when the active table cannot perform the task; activate an optional extension deliberately.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("activate")]),
      query: Type.Optional(Type.String({ description: "name or description search" })),
      capability_id: Type.Optional(Type.String({ description: "registered tool name to activate" })),
    }),
    async execute(_toolCallId, params) {
      const input = params as unknown as { action: "search" | "activate"; query?: string; capability_id?: string };
      if (input.action === "search") {
        const query = (input.query ?? "").trim().toLowerCase();
        const active = new Set(pi.getActiveTools());
        const matches = pi.getAllTools().filter((tool) => {
          if (tool.name === "search_tools") return false;
          const isHarnessBase = (SIMPLE_TOOLS as readonly string[]).includes(tool.name) ||
            (FULL_TOOLS as readonly string[]).includes(tool.name);
          const isOptionalExtension = tool.sourceInfo.source !== "builtin" && tool.sourceInfo.source !== "sdk";
          if (!isHarnessBase && !isOptionalExtension) return false;
          const searchable = `${tool.name} ${tool.description}`.toLowerCase();
          return query.length === 0 || searchable.includes(query);
        });
        const text = matches.length === 0
          ? "No matching registered tools."
          : matches.map((tool) => {
              const state = active.has(tool.name)
                ? "active"
                : tool.name === "git" || tool.name === "verify"
                  ? "requires /harness full"
                  : "available for activation";
              return `${tool.name}: ${tool.description} [${state}]`;
            }).join("\n");
        return { content: [{ type: "text", text }], details: { matches: matches.map((tool) => tool.name) } };
      }

      const name = (input.capability_id ?? "").trim();
      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      if (!available.has(name)) {
        return { content: [{ type: "text", text: `Activation failed: unknown registered tool '${name}'.` }], details: { ok: false, name } };
      }
      if ((name === "git" || name === "verify") && currentMode() !== "full") {
        return {
          content: [{ type: "text", text: `${name} belongs to the frozen Full table; switch with /harness full instead of activating it independently.` }],
          details: { ok: false, name, reason: "requires-full" },
        };
      }
      if ((SIMPLE_TOOLS as readonly string[]).includes(name)) {
        return {
          content: [{ type: "text", text: `${name} is controlled by the selected Harness base table; no independent activation is needed.` }],
          details: { ok: false, name, reason: "harness-base" },
        };
      }
      if (pi.getActiveTools().includes(name)) {
        return { content: [{ type: "text", text: `${name} is already active.` }], details: { ok: true, name, alreadyActive: true } };
      }
      pi.setActiveTools([...new Set([...pi.getActiveTools(), name])]);
      return {
        content: [{ type: "text", text: `Activated ${name}; it is available from the next model request.` }],
        details: { ok: true, name, alreadyActive: false },
        addedToolNames: [name],
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

function isVerifyProfile(value: unknown): value is VerifyProfile {
  return value === "none" || value === "quick" || value === "tdd";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
