import { subagentsAllowed } from "../harness/runtime-mode.js";
import type { ContextEvent, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerCapabilityManifest } from "../capabilities/registry.js";
import { invokeNativeSubagent } from "../subagents/delegation.js";
import { ResearchArtifactStore, pointerContext, redactSecrets, type ResearchArtifactRef } from "./research-artifact.js";
import {
  MemorySearchTransport,
  RelaySearchTransport,
  normalizeWebSearchQuery,
  type SearchTransport,
  type WebSearchBatch,
  type WebSearchQuery,
} from "./search.js";

const SEALED_ENTRY = "pi-coffee-research-sealed";

export interface SubagentInvokerInput {
  task: string;
  signal?: AbortSignal;
  context: ExtensionContext;
}

export type SubagentInvoker = (input: SubagentInvokerInput) => Promise<string | undefined>;

export interface WebExtensionOptions {
  /** Injectable transport and artifact store for tests or a future Relay Adapter. */
  transport?: SearchTransport;
  artifactStore?: ResearchArtifactStore;
  subagentInvoker?: SubagentInvoker;
  /** Set false to keep search snippets only and skip the child researcher. */
  delegateByDefault?: boolean;
}

interface SealedResearch {
  version: 1;
  responseId: string;
  toolCallId: string;
  conclusion: string;
  ref: ResearchArtifactRef;
}

export default function webExtension(pi: ExtensionAPI): void {
  createWebExtension()(pi);
}

export function createWebExtension(options: WebExtensionOptions = {}): (pi: ExtensionAPI) => void {
  return (pi) => installWebExtension(pi, options);
}

function installWebExtension(pi: ExtensionAPI, options: WebExtensionOptions): void {
  const transport = options.transport ?? new RelaySearchTransport();
  const artifactStore = options.artifactStore ?? new ResearchArtifactStore();
  const sealedByToolCall = new Map<string, SealedResearch>();
  const delegateByDefault = options.delegateByDefault ?? true;

  const webSearchTool = createWebSearchTool(pi, transport, artifactStore, sealedByToolCall, options.subagentInvoker, delegateByDefault);
  const sealTool = createSealTool(sealedByToolCall, artifactStore, pi);
  pi.registerTool(webSearchTool);
  pi.registerTool(sealTool);
  pi.registerCommand("websearch", {
    description: "Search through the PI Coffee Control Plane Serper Relay",
    handler: async (args) => {
      const query = args.trim();
      if (query.length === 0) {
        pi.sendUserMessage("Use the web_search tool for the user's web research request.");
        return;
      }
      pi.sendUserMessage(`Use the web_search tool to research this request through the Control Plane Relay. Do not use another search provider. Request: ${query}`);
    },
  });

  registerCapabilityManifest(pi, {
    manifest: {
      id: "web",
      kind: "pi-extension",
      origin: "suite",
      title: "API-backed web research",
      summary: "Search through the Control Plane's Serper relay, optionally ask a native child Pi researcher, and seal the result as Markdown",
      keywords: ["web", "search", "internet", "serper", "research", "sources", "md", "artifact"],
      tools: [toolSchema(webSearchTool), toolSchema(sealTool)],
      supportedHarness: ["simple", "full"],
      permissionSummary: "network reads go through the Control Plane Relay; artifacts stay on the User VM",
      runnerConformance: "passed",
      supportsProxyCall: false,
    },
    initialTrust: "trusted",
    conformanceSource: "local",
    readiness: {
      status: "Degraded",
      summary: "Relay availability is checked when the first search runs",
      missing: [],
      nextSteps: ["configure PI_COFFEE_SEARCH_URL or the User VM Relay route"],
      inspectedAt: new Date().toISOString(),
    },
  });

  pi.on("session_start", (_event, ctx) => { sealedByToolCall.clear(); restoreSealedEntries(ctx, sealedByToolCall); });
  pi.on("session_tree", (_event, ctx) => { sealedByToolCall.clear(); restoreSealedEntries(ctx, sealedByToolCall); });
  // Compatibility projection for existing histories and later refined conclusions.
  // New searches already return only a brief and index BEFORE Pi persists them.
  // Pi 0.84 exposes the context event in its runtime API, but older bundled
  // declaration overloads can reject a structurally equivalent handler. Keep
  // this cast at the Adapter seam; the event shape is still checked above.
  pi.on("context", ((event: ContextEvent) => {
    let changed = false;
    const messages = event.messages.map((message) => {
      const value = message as unknown as Record<string, any>;
      if (value.role !== "toolResult" || typeof value.toolCallId !== "string") return message;
      const sealed = sealedByToolCall.get(value.toolCallId);
      if (sealed === undefined) return message;
      const currentText = textFromContent(value.content);
      if (currentText === pointerContext(sealed.ref, sealed.conclusion)) return message;
      changed = true;
      return {
        ...value,
        content: [{ type: "text", text: pointerContext(sealed.ref, sealed.conclusion) }],
        details: { artifactId: sealed.ref.artifactId, sha256: sealed.ref.sha256, responseId: sealed.responseId },
      };
    });
    return changed ? { messages } : undefined;
  }) as any);
}

function createWebSearchTool(
  pi: ExtensionAPI,
  transport: SearchTransport,
  artifactStore: ResearchArtifactStore,
  sealedByToolCall: Map<string, SealedResearch>,
  suppliedInvoker: SubagentInvoker | undefined,
  delegateByDefault: boolean,
): ToolDefinition {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web through the Control Plane Serper Relay. The Relay holds the Serper key; this User VM receives bounded results. Results are saved on the User VM before returning a short top-ranked brief and source index. Simple/Lean search directly without children. Full delegates to a native researcher by default; delegate=false explicitly selects direct search.",
    promptSnippet: "Use for current web facts. Read specific sources to verify important claims; do not load the whole search archive.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "single search query" })),
      queries: Type.Optional(Type.Array(Type.String({ description: "up to four complementary queries" }), { maxItems: 4 })),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "results per query" })),
      recencyFilter: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")])),
      domainFilter: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
      delegate: Type.Optional(Type.Boolean({ description: "Full: use a research child by default; false searches directly. Simple/Lean always search directly, even when true." })),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as unknown as WebSearchQuery;
      const normalized = normalizeWebSearchQuery(input);
      const shouldDelegate = subagentsAllowed(pi) && process.env.PI_SUBAGENT_CHILD !== "1" && (input.delegate ?? delegateByDefault);
      if (shouldDelegate) {
        const invoker = suppliedInvoker ?? ((value: SubagentInvokerInput) => invokeNativeSubagent(pi, value));
        // The parent does not fetch sources first: the child executes the search and source reads.
        const brief = await invoker({ task: buildResearchTask(normalized), signal, context: ctx });
        if (signal?.aborted) throw new Error("Research cancelled; no fallback search was started");
        if (!brief?.trim()) throw new Error("Research child failed, timed out or is unavailable. Check /subagents-policy and model configuration; use delegate=false only for an explicit direct search.");
        const conclusion = redactSecrets(brief).slice(0, 3200);
        const responseId = `child-${toolCallId}`;
        const ref = artifactStore.seal({ responseId, provider: "serper", queries: normalized.queries, results: [], conclusion, sessionId: sessionId(ctx) });
        rememberResearch(pi, sealedByToolCall, { version: 1, responseId, toolCallId, conclusion, ref });
        return { content: [{ type: "text", text: pointerContext(ref, conclusion) }],
          details: { responseId, artifactId: ref.artifactId, path: ref.path, delegated: true } };
      }
      const batch = await transport.search(normalized, signal);
      // Complete results live only in the evidence artifact, never tool content/details/session entries.
      // Provider ranking is a selection heuristic, not an assertion of factual correctness.
      const conclusion = bestResultBrief(batch);
      const ref = artifactStore.seal({ ...batch, conclusion, sessionId: sessionId(ctx) });
      const sealed: SealedResearch = { version: 1, responseId: batch.responseId, toolCallId, conclusion, ref };
      rememberResearch(pi, sealedByToolCall, sealed);
      return {
        content: [{ type: "text", text: pointerContext(ref, conclusion) }],
        details: { responseId: batch.responseId, artifactId: ref.artifactId, path: ref.path,
          sha256: ref.sha256, resultCount: batch.results.length, delegated: false },
      };
    },
  };
}

function createSealTool(
  sealedByToolCall: Map<string, SealedResearch>,
  artifactStore: ResearchArtifactStore,
  pi: ExtensionAPI,
): ToolDefinition {
  return {
    name: "research_seal",
    label: "Refine research conclusion",
    description: "Record a short verified conclusion for an already archived search. Cite selected source URLs; do not repeat the source dump.",
    parameters: Type.Object({ responseId: Type.String(), conclusion: Type.String({ maxLength: 2400 }) }),
    async execute(_toolCallId, params) {
      const input = params as unknown as { responseId: string; conclusion: string };
      const previous = [...sealedByToolCall.values()].find(item => item.responseId === input.responseId);
      if (!previous) return { content: [{ type: "text", text: "Unknown research response; search again or use the saved artifact index." }], details: { ok: false, code: "unknown" } };
      const conclusion = redactSecrets(input.conclusion).trim().slice(0, 2400);
      if (!conclusion) throw new Error("A research conclusion must not be empty");
      const ref = artifactStore.refine(previous.ref, conclusion);
      const sealed = { ...previous, conclusion, ref };
      rememberResearch(pi, sealedByToolCall, sealed);
      return { content: [{ type: "text", text: pointerContext(ref, conclusion) }],
        details: { ok: true, responseId: input.responseId, artifactId: ref.artifactId, path: ref.path } };
    },
  };
}

function rememberResearch(pi: ExtensionAPI, target: Map<string, SealedResearch>, value: SealedResearch): void {
  pi.appendEntry(SEALED_ENTRY, value);
  target.set(value.toolCallId, value);
}

/** Top three distinct provider-ranked sources; no extra model call or claim that ranking proves truth. */
export function bestResultBrief(batch: WebSearchBatch, delegated?: string, error?: string): string {
  const selected = [...new Map(batch.results.map(result => [result.url, result])).values()].slice(0, 3);
  const lines = ["Top-ranked search leads (not independently verified):"];
  if (selected.length === 0) lines.push("No sources returned. Do not infer an answer from this search.");
  if (delegated) lines.push(`Optional evidence brief: ${delegated.slice(0, 800)}`);
  else if (error) lines.push(`Optional brief unavailable: ${error.slice(0, 160)}`);
  selected.forEach((source, i) => lines.push(
    `${i + 1}. ${source.title.slice(0, 100)}: ${source.snippet.slice(0, 300)}`,
    // Never turn a truncated URL into a citation to a different resource.
    source.url.length <= 400 ? source.url : `Source URL: see entry ${i + 1} in the artifact.`,
  ));
  return redactSecrets(lines.join("\n")).slice(0, 3200);
}

function buildResearchTask(input: import("./search.js").NormalizedWebSearchQuery): string {
  return `Research this request using web_search with the following JSON arguments (set delegate=false). Do the searches yourself; verify relevant primary sources when useful. Return only a short best-result summary, exact source URLs, evidence artifact paths and limitations; never a full result dump.\n${JSON.stringify({ ...input, delegate: false })}`;
}

function toolSchema(tool: ToolDefinition): { name: string; description: string; parameters: unknown } {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function restoreSealedEntries(ctx: ExtensionContext, target: Map<string, SealedResearch>): void {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry?.type !== "custom" || entry.customType !== SEALED_ENTRY || !isSealedResearch(entry.data)) continue;
    target.set(entry.data.toolCallId, entry.data);
  }
}

function isSealedResearch(value: unknown): value is SealedResearch {
  if (!isRecord(value) || value.version !== 1 || typeof value.responseId !== "string" || typeof value.toolCallId !== "string" || typeof value.conclusion !== "string" || !isRecord(value.ref)) return false;
  return typeof value.ref.artifactId === "string" && typeof value.ref.path === "string" && typeof value.ref.sha256 === "string" && typeof value.ref.bytes === "number" && typeof value.ref.pointer === "string";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    return isRecord(part) && typeof part.text === "string" ? part.text : "";
  }).filter(Boolean).join("\n");
}

function sessionId(ctx: ExtensionContext): string | undefined {
  const manager = ctx.sessionManager as unknown as { getSessionFile?: () => string };
  return typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedDelegationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 240) || "delegation unavailable";
}

// Kept available to tests and examples without requiring a network or Pi.
export function createMemoryWebExtensionOptions(results: ConstructorParameters<typeof MemorySearchTransport>[0] = []) {
  return { transport: new MemorySearchTransport(results), delegateByDefault: false } satisfies WebExtensionOptions;
}
