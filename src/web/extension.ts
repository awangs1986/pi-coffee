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

interface PendingResearch {
  toolCallId: string;
  batch: WebSearchBatch;
  turnIndex: number;
  delegatedSummary?: string;
  sealed?: SealedResearch;
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
  const pending = new Map<string, PendingResearch>();
  const sealedByToolCall = new Map<string, SealedResearch>();
  const delegateByDefault = options.delegateByDefault ?? !isDisabled(process.env.PI_COFFEE_WEB_SUBAGENT);
  let currentTurn = 0;

  const webSearchTool = createWebSearchTool(pi, transport, pending, options.subagentInvoker, delegateByDefault, () => currentTurn);
  const sealTool = createSealTool(pending, sealedByToolCall, artifactStore, pi);
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

  pi.on("session_start", (_event, ctx) => restoreSealedEntries(ctx, sealedByToolCall));
  pi.on("session_tree", (_event, ctx) => restoreSealedEntries(ctx, sealedByToolCall));
  pi.on("turn_start", (event) => {
    currentTurn = event.turnIndex;
  });

  pi.on("agent_end", async (event, ctx) => {
    const conclusion = finalAssistantText(event.messages);
    if (!conclusion) return;
    for (const research of pending.values()) {
      if (research.turnIndex !== currentTurn) continue;
      if (research.sealed !== undefined) continue;
      sealResearch(research, conclusion, artifactStore, sealedByToolCall, pi, ctx);
    }
  });

  // Keep the transcript useful for the current turn. Once the turn has
  // settled, replace bulky search results before the next provider request
  // with a pointer + conclusion; the Markdown file remains the User VM source.
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
      if (currentText.startsWith("[Research sealed]")) return message;
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
  pending: Map<string, PendingResearch>,
  suppliedInvoker: SubagentInvoker | undefined,
  delegateByDefault: boolean,
  currentTurn: () => number,
): ToolDefinition {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web through the Control Plane Serper Relay. The Relay holds the Serper key; this User VM receives bounded results. By default a native pi-subagents child prepares a research brief.",
    promptSnippet: "Use for current web facts; results will be sealed to a User VM Markdown artifact after your conclusion.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "single search query" })),
      queries: Type.Optional(Type.Array(Type.String({ description: "up to four complementary queries" }), { maxItems: 4 })),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "results per query" })),
      recencyFilter: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")])),
      domainFilter: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
      delegate: Type.Optional(Type.Boolean({ description: "ask the native child researcher for a bounded brief (default true)" })),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as unknown as WebSearchQuery;
      const normalized = normalizeWebSearchQuery(input);
      const batch = await transport.search(normalized, signal);
      const research: PendingResearch = { toolCallId, batch, turnIndex: currentTurn() };
      pending.set(batch.responseId, research);
      while (pending.size > 64) {
        const oldest = pending.keys().next().value;
        if (typeof oldest !== "string") break;
        pending.delete(oldest);
      }

      const shouldDelegate = input.delegate ?? delegateByDefault;
      let delegatedSummary: string | undefined;
      let delegationError: string | undefined;
      if (shouldDelegate) {
        const invoker = suppliedInvoker ?? ((value: SubagentInvokerInput) => invokeNativeSubagent(pi, value));
        try {
          delegatedSummary = await invoker({
            task: buildResearchTask(batch),
            signal,
            context: ctx,
          });
        } catch (error) {
          delegationError = boundedDelegationError(error);
        }
        if (delegatedSummary) research.delegatedSummary = delegatedSummary.slice(0, 12_000);
      }

      const lines = [
        `responseId: ${batch.responseId} | provider: serper | queries: ${batch.queries.join(" | ")}`,
        delegatedSummary ? `\nNative subagent research brief:\n${delegatedSummary.slice(0, 12_000)}` : `\nNative subagent brief: unavailable${delegationError ? ` (${delegationError})` : ""}; inspect the bounded sources below.`,
        "\nSources:",
        ...batch.results.map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`),
        "\nAfter deriving the answer, the Host will seal these sources and your conclusion into a User VM Markdown artifact; future context keeps only its pointer and conclusion.",
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          responseId: batch.responseId,
          provider: batch.provider,
          queries: batch.queries,
          resultCount: batch.results.length,
          delegated: Boolean(delegatedSummary),
          ...(delegationError === undefined ? {} : { delegationError }),
        },
      };
    },
  };
}

function createSealTool(
  pending: Map<string, PendingResearch>,
  sealedByToolCall: Map<string, SealedResearch>,
  artifactStore: ResearchArtifactStore,
  pi: ExtensionAPI,
): ToolDefinition {
  return {
    name: "research_seal",
    label: "Seal Research",
    description: "Close a web research result into a User VM Markdown artifact. The next model context contains only the artifact pointer and conclusion.",
    promptSnippet: "Seal a completed web research answer when you want an explicit Markdown checkpoint.",
    parameters: Type.Object({
      responseId: Type.String({ description: "responseId returned by web_search" }),
      conclusion: Type.String({ description: "bounded conclusion to preserve with the sources" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as unknown as { responseId: string; conclusion: string };
      const research = pending.get(input.responseId);
      if (research === undefined) return { content: [{ type: "text", text: `unknown responseId '${input.responseId}'` }], details: { ok: false, code: "unknown" } };
      const sealed = sealResearch(research, input.conclusion, artifactStore, sealedByToolCall, pi, ctx);
      return {
        content: [{ type: "text", text: `${sealed.ref.pointer}\nThe next context projection will retain only this pointer and conclusion.` }],
        details: { ok: true, artifactId: sealed.ref.artifactId, sha256: sealed.ref.sha256, responseId: input.responseId },
      };
    },
  };
}

function sealResearch(
  research: PendingResearch,
  conclusion: string,
  artifactStore: ResearchArtifactStore,
  sealedByToolCall: Map<string, SealedResearch>,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): SealedResearch {
  if (research.sealed !== undefined) return research.sealed;
  // The artifact renderer scrubs independently, but the bounded conclusion is
  // also persisted in Pi's append-only session and sent to the browser. Scrub
  // before either write so a model cannot accidentally echo a credential into
  // the transcript or context projection.
  const safeConclusion = redactSecrets(conclusion).trim().slice(0, 32_000) || "(no conclusion recorded)";
  const ref = artifactStore.seal({
    responseId: research.batch.responseId,
    sessionId: sessionId(ctx),
    queries: research.batch.queries,
    provider: research.batch.provider,
    results: research.batch.results,
    conclusion: safeConclusion,
  });
  const sealed: SealedResearch = { version: 1, responseId: research.batch.responseId, toolCallId: research.toolCallId, conclusion: safeConclusion, ref };
  research.sealed = sealed;
  sealedByToolCall.set(research.toolCallId, sealed);
  pi.appendEntry(SEALED_ENTRY, sealed);
  const sendMessage = (pi as ExtensionAPI & { sendMessage?: ExtensionAPI["sendMessage"] }).sendMessage;
  if (typeof sendMessage === "function") {
    sendMessage.call(pi, {
      customType: "research-sealed",
      content: [{ type: "text", text: `${ref.pointer}\nConclusion: ${safeConclusion.slice(0, 8_000)}` }],
      display: true,
      details: { artifactId: ref.artifactId, sha256: ref.sha256 },
    }, { triggerTurn: false });
  }
  return sealed;
}

function buildResearchTask(batch: WebSearchBatch): string {
  const sources = batch.results.slice(0, 20).map((result, index) => `${index + 1}. ${result.title} — ${result.url}\n${result.snippet}`).join("\n");
  return `You are the bounded research child for PI Coffee. Analyze only these Serper results, do not invent sources, and return a concise evidence brief with caveats.\n\nQueries: ${batch.queries.join(" | ")}\n\n${sources}`.slice(0, 24_000);
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

function finalAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, any> | undefined;
    if (!message || message.role !== "assistant") continue;
    const text = textFromContent(message.content);
    if (text.trim()) return text.trim();
  }
  return undefined;
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

function isDisabled(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function boundedDelegationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 240) || "delegation unavailable";
}

// Kept available to tests and examples without requiring a network or Pi.
export function createMemoryWebExtensionOptions(results: ConstructorParameters<typeof MemorySearchTransport>[0] = []) {
  return { transport: new MemorySearchTransport(results), delegateByDefault: false } satisfies WebExtensionOptions;
}
