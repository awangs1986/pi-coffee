import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installSubagentModelPolicy } from "./model-policy.js";

// Resolve the package without importing its TypeScript source. Node's native
// ESM loader intentionally refuses type stripping for files under
// node_modules; Pi's own extension loader (jiti) is the code that loads the
// upstream `.ts` entry passed separately by the Host.
const resolvePackage = createRequire(import.meta.url).resolve;
const packageEntry = resolvePackage("pi-subagents");
const packageRoot = dirname(packageEntry);

/**
 * PI Coffee's packaged pi-subagents resource Adapter.
 *
 * The upstream factory is loaded unchanged as a separate native Pi extension
 * entry. This Adapter only exposes the package's shipped skills and prompt
 * templates through Pi's resource discovery seam, which is not reached by an
 * explicit `--extension` path alone.
 */
export default function piCoffeeSubagentsResources(pi: ExtensionAPI): void {
  installSubagentModelPolicy(pi);
  if (pi.events) {
    // Public runtime-agent event contract v1; avoid compiling the package's private TS dependency graph.
    const request: { version: number; name: string; definition: unknown; result?: { ok: boolean; error?: Error } } = { version: 1, name: "coffee-research", definition: {
    description: "Research with Relay web search and source reading; return short evidence and indexes, not raw transcripts",
    systemPrompt: "You are a focused research assistant. Execute the supplied search query using web_search, open relevant primary sources with fetch_content when useful, and return a concise answer with exact source URLs, artifact paths and caveats. Search snippets are leads, not verified facts. Do not return complete search results or logs. Never delegate to another agent. Keep the final result under 2400 characters. Use only the supplied task, not the parent conversation.",
    systemPromptMode: "append", defaultContext: "fresh", allowNestedSubagents: false, maxSubagentDepth: 1,
    tools: ["web_search", "fetch_content", "read"],
    extensions: [fileURLToPath(new URL("../web/child-extension.js", import.meta.url)), fileURLToPath(new URL("../web/pi-web-access-adapter.js", import.meta.url)), fileURLToPath(new URL("../context/extension.js", import.meta.url))],
    defaultTimeoutMs: 15 * 60_000,
    } };
    pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
    if (!request.result?.ok) throw request.result?.error ?? new Error("Native researcher registration failed");
  }
  pi.on("resources_discover", () => ({
    skillPaths: [join(packageRoot, "skills")],
    promptPaths: [join(packageRoot, "prompts")],
  }));
}
