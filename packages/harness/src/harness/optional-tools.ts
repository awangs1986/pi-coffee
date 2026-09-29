import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CapabilityManifest } from "../capabilities/catalog.js";

/** Metadata for the public pi-coffee-lsp tool; execution and lifecycle stay in its package. */
export function createLspManifest(pi: ExtensionAPI): CapabilityManifest | undefined {
  const tool = pi.getAllTools().find(tool => tool.name === "lsp");
  if (!tool) return undefined;
  return {
    id: "lsp", kind: "pi-extension", origin: "suite", title: "Language server",
    summary: "Inspect diagnostics, definitions, references and types through the installed LSP tool",
    keywords: ["lsp", "language", "diagnostics", "definition", "references", "types", "rename"],
    tools: [{ name: tool.name, description: tool.description, parameters: tool.parameters }],
    supportedHarness: ["work"], permissionSummary: "Installed LSP plugin owns language servers and workspace operations",
    runnerConformance: "passed", supportsProxyCall: false,
  };
}
