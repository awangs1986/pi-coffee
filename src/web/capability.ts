import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { CapabilityManifest } from "../capabilities/catalog.js";

const WEB_ACCESS_TOOL_NAMES = ["fetch_content", "source_check", "get_search_content"] as const;

/**
 * Describe the native pi-web-access tools without importing its implementation.
 * The official extension remains responsible for execution; the catalog only
 * verifies that the matching definitions are present before activation.
 */
export function createWebAccessManifest(
  pi: ExtensionAPI,
  conformedCapabilities: ReadonlySet<string>,
): CapabilityManifest | undefined {
  const tools = WEB_ACCESS_TOOL_NAMES
    .map((name) => pi.getAllTools().find((tool) => tool.name === name))
    .filter((tool): tool is ToolInfo => tool !== undefined);
  if (tools.length === 0) return undefined;

  return {
    id: "web-access",
    kind: "pi-extension",
    origin: "suite",
    title: "pi-web-access content tools",
    summary: "Fetch readable source content and inspect stored web-search results through the native pi-web-access extension",
    keywords: ["web", "fetch", "content", "source", "check", "research", "pi-web-access"],
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    supportedHarness: ["simple", "full"],
    permissionSummary: "the upstream extension runs in the owning User VM; credentials and outbound provider access remain its configured responsibility",
    runnerConformance: conformedCapabilities.has("web-access") ? "passed" : "not_run",
    supportsProxyCall: false,
  };
}
