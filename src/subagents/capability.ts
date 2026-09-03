import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { CapabilityManifest } from "../capabilities/catalog.js";

const SUBAGENT_TOOL_NAMES = ["subagent", "bg_wait"] as const;

/** Build a manifest from the pinned upstream definitions without importing its implementation. */
export function createSubagentsManifest(
  pi: ExtensionAPI,
  conformedCapabilities: ReadonlySet<string>,
): CapabilityManifest | undefined {
  const all = pi.getAllTools();
  const tools = SUBAGENT_TOOL_NAMES.map((name) => all.find((tool) => tool.name === name)).filter(
    (tool): tool is ToolInfo => tool !== undefined,
  );
  if (tools.length !== SUBAGENT_TOOL_NAMES.length) return undefined;
  return {
    id: "subagent",
    kind: "pi-extension",
    origin: "suite",
    title: "Subagent delegation",
    summary: "Launch focused foreground or background child Pi sessions for bounded delegation",
    keywords: ["subagent", "child", "delegate", "parallel", "background", "researcher"],
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    supportedHarness: ["full"],
    permissionSummary: "child Pi sessions use the owning User VM's normal rights; no PI Coffee sandbox is applied",
    runnerConformance: conformedCapabilities.has("subagent") ? "passed" : "not_run",
    supportsProxyCall: false,
  };
}
