import { registerPolicy } from "./config.js";
import { HANDOFF_REQUEST, HANDOFF_VERSION } from "./protocol.js";
import {
  load,
  save,
  confirmCommit,
  hasCommit,
  historyFingerprint,
} from "./journal.js";
import { registerEvidence } from "./evidence.js";
import { projectSnapshot } from "./project.js";
import { randomUUID } from "node:crypto";
import {
  sources,
  validate,
  bytes,
  digest,
  synthesisPrompt,
  selectSources,
  evidenceIndex,
} from "./task-state.js";
import { repairTaskState } from "./state-repair.js";
import { registerOrderGuard } from "./order-guard.js";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Preparation must be cancelled; the caller decides whether and when to retry. */
class Deferral extends Error {}

export default function handoff(pi: ExtensionAPI) {
  registerEvidence(pi);
  const retiredOrderSources = registerOrderGuard(pi);
  const policy = registerPolicy(pi);
  pi.registerCommand("handoff", {
    description: `Experimental manual Handoff ${HANDOFF_VERSION}; /handoff version reports the installed version`,
    handler: async (args, ctx) => {
      if (args.trim() === "version") { ctx.ui.notify(`Context-handoff ${HANDOFF_VERSION}`, "info"); return; }
      if (args.trim()) { ctx.ui.notify("Usage: /handoff [version]", "error"); return; }
      if (!ctx.isIdle()) { ctx.ui.notify("Wait for active work to settle before Handoff.", "warning"); return; }
      if (!await ctx.ui.confirm("交接压缩（实验性功能）", "交接压缩将重建当前任务上下文，不保证避免上下文漂移。同一会话、原始历史和项目文件保留。是否继续？")) return;
      ctx.compact({ customInstructions: HANDOFF_REQUEST });
    },
  });
  let inputEpoch = 0;
  let recoveryBlocked = false;
  let unsafePersistence = false;
  let currentContext: ExtensionContext | undefined;
  const report = (error: unknown, prefix = "Handoff stopped") => {
    const message = `${prefix}: ${String(error).slice(0, 500)}`;
    if (unsafePersistence) {
      currentContext?.ui.notify(message, "error");
      return;
    }
    pi.sendMessage(
      { customType: "pi-handoff-error", content: message, display: true },
      { triggerTurn: false },
    );
  };
  pi.on("session_start", (_event, ctx) => {
    recoveryBlocked = false;
    unsafePersistence = false;
    currentContext = ctx;
    try {
      const journal = load(ctx);
      if (!journal) {
        const inherited = ctx.sessionManager
          .getBranch()
          .filter(
            (e: any) =>
              e.type === "compaction" && e.details?.plugin === "pi-handoff",
          )
          .at(-1) as any;
        if (inherited) {
          if (_event.reason !== "fork")
            throw new Error("Required Handoff journal missing");
          const summaryHash = digest(inherited.summary);
          confirmCommit(ctx, summaryHash);
          save(ctx, {
            version: 1,
            session: ctx.sessionManager.getSessionId(),
            summaryHash,
            phase: "installed",
            continuation: "none",
          });
        }
        return;
      }
      if (journal.phase === "prepared") {
        if (hasCommit(ctx, journal.summaryHash)) {
          confirmCommit(ctx, journal.summaryHash);
          save(ctx, { ...journal, phase: "installed", continuation: "none" });
          report(
            "Recovered installed context; automatic continuation not replayed. Inspect pending work.",
          );
        } else {
          report(
            "Interrupted preparation; previous context retained. No action replayed.",
          );
        }
      } else {
        confirmCommit(ctx, journal.summaryHash);
        if (journal.continuation === "claimed")
          report(
            "Continuation outcome uncertain after interruption. Inspect results before continuing; no action replayed.",
          );
      }
    } catch (error) {
      recoveryBlocked = true;
      report(error);
    }
  });
  const activeTools = new Set<string>();
  pi.on("tool_execution_start", (e) => {
    activeTools.add(e.toolCallId);
  });
  pi.on("tool_execution_end", (e) => {
    activeTools.delete(e.toolCallId);
  });
  pi.events.on("pi-handoff:work", (data: unknown) => {
    const d = data as any;
    if (
      d &&
      typeof d.id === "string" &&
      typeof d.tool === "string" &&
      ["running", "settled", "unknown"].includes(d.status)
    )
      pi.appendEntry("pi-handoff-work", {
        id: d.id,
        tool: d.tool,
        status: d.status,
      });
  });
  const assertSettled = (entries: any[]) => {
    if (activeTools.size) throw new Deferral("Tools have not settled; Handoff deferred");
    const work = new Map<string, any>();
    const known = new Set([
      "read",
      "write",
      "edit",
      "bash",
      // Coffee Git and discovery finish before returning; delegates still require settlement.
      "git",
      "search_tools",
      "handoff_evidence",
      "handoff_evidence_search",
      "handoff_evidence_read",
      "handoff_reconcile",
    ]);
    for (const e of entries)
      if (e.type === "custom" && e.customType === "pi-handoff-work") {
        work.set(e.data.id, e.data);
        known.add(e.data.tool);
      }
    if ([...work.values()].some((d) => d.status !== "settled"))
      throw new Deferral("Delegated work has not settled; Handoff deferred");
    for (const e of entries)
      if (
        e.type === "message" &&
        e.message.role === "assistant" &&
        Array.isArray(e.message.content)
      )
        for (const c of e.message.content)
          if (c.type === "toolCall" && !known.has(c.name))
            throw new Error(
              "Unknown delegated-work state; extension must report settlement",
            );
  };
  pi.on("input", () => {
    inputEpoch++;
    if (recoveryBlocked) {
      report("Repair Handoff state before submitting new work");
      return { action: "handled" };
    }
  });
  pi.on("session_before_compact", async (event, ctx) => {
    const explicit = event.reason === "manual" && event.customInstructions === HANDOFF_REQUEST;
    // Invocation policy belongs to the caller (Host); native boundaries stay Pi-owned.
    if (!explicit) return;
    if (recoveryBlocked) {
      report("Repair Handoff state before compacting");
      return { cancel: true };
    }
    try {
      assertSettled(ctx.sessionManager.getBranch());
      const epoch = inputEpoch,
        leaf = ctx.sessionManager.getLeafId(),
        model = ctx.model,
        tools = JSON.stringify(pi.getActiveTools());
      if (ctx.hasPendingMessages())
        throw new Deferral("New input is waiting; Handoff deferred");
      if (!ctx.model) throw new Error("Selected model unavailable");
      const generation = policy.generation(ctx.model);
      const history = historyFingerprint(ctx);
      const conversation = sources(event.branchEntries);
      const hints = conversation.map((source) => source.text);
      const project = projectSnapshot(ctx.cwd, hints);
      const originals = [...conversation, ...project.sources];
      const selection = selectSources(
        originals,
        Math.min(
          94000,
          ctx.model.contextWindow - bytes(synthesisPrompt) - generation.outputTokens - 12000,
        ),
      );
      const retiredOrders = retiredOrderSources(ctx);
      const input = JSON.stringify({
        retiredEvidenceOrderSources: [...retiredOrders],
        coverage: selection.coverage,
        sources: selection.selected,
        project: {
          revision: project.revision,
          observedAt: project.observedAt,
          verification: project.verification,
          inventory: project.inventory,
        },
      });
      if (
        bytes(input) > 98304 ||
        bytes(input) + bytes(synthesisPrompt) + generation.outputTokens + 8192 > ctx.model.contextWindow
      )
        throw new Error("Original-source coverage exceeds preparation budget");
      const signal = AbortSignal.any([
        event.signal,
        AbortSignal.timeout(generation.timeoutMs),
      ]);
      const response = await ctx.modelRegistry
        .streamSimple(
          ctx.model,
          {
            systemPrompt: synthesisPrompt,
            messages: [{ role: "user", content: input, timestamp: Date.now() }],
          },
          { maxTokens: generation.outputTokens, reasoning: generation.reasoning, signal },
        )
        .result();
      if (signal.aborted) {
        if (event.signal.aborted) throw new Error("Handoff cancelled");
        throw new Error(`Synthesis deadline exceeded (${generation.timeoutMs} ms)`);
      }
      if (response.stopReason === "length")
        throw new Error(`Synthesis output truncated (${generation.outputTokens} token budget)`);
      if (response.stopReason !== "stop")
        throw new Error(`Synthesis provider failure: ${response.errorMessage ?? response.stopReason}`);
      const generated = JSON.parse(
        response.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(""),
      );
      let state;
      try {
        state = validate(structuredClone(generated), originals);
      } catch (error) {
        try {
          state = await repairTaskState(generated, originals, error, ctx, generation, signal);
        } catch (repairError) {
          if (signal.aborted) throw repairError;
          throw new Error(`${error instanceof Error ? error.message : String(error)}; field repair failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`);
        }
      }
      signal.throwIfAborted();
      assertSettled(ctx.sessionManager.getBranch());
      if (inputEpoch !== epoch || ctx.hasPendingMessages())
        throw new Deferral("New input arrived during Handoff; pending input retained");
      if (
        ctx.sessionManager.getLeafId() !== leaf ||
        ctx.model !== model ||
        pi.getThinkingLevel() !== generation.thinking ||
        JSON.stringify(pi.getActiveTools()) !== tools
      )
        throw new Error("Conversation changed during Handoff");
      if (historyFingerprint(ctx) !== history)
        throw new Error("Original history changed during Handoff");
      if (projectSnapshot(ctx.cwd).fingerprint !== project.fingerprint)
        throw new Error("Project changed during Handoff");

      const summary = JSON.stringify({
        recovery:
          "Use state.exactValues.value without its label; narrative claims do not override exact values. Follow state.steps in order and retain required before/after timing. Completion evidence is historical observation, not proof of semantic success. Use handoff_evidence search for missing details and read verified anchors. Original history remains authoritative.",
        handoff: randomUUID(),
        project: {
          revision: project.revision, observedAt: project.observedAt,
          verification: "Read-only observation; historical test passes are not current verification.",
          recovery: "Read current workspace files for current facts. Search handoff_evidence for recorded historical project snapshots.",
        },
        state,
        ...(selection.truncated.length ? {
          coverage: {
            excerptedOwnerMessages: selection.truncated.slice(0, 16).map(({ id, originalBytes }) => ({
              anchor: `${ctx.sessionManager.getSessionId()}/${id}/${originals.find(o => o.id === id)!.hash}`,
              bytes: originalBytes,
            })),
            note: "These original user messages were excerpted during preparation. Read them with handoff_evidence_read before relying on details absent from this state.",
          },
        } : {}),
        provenance:
          "Source identities verified by program; supplied quotations checked literally. Claim meanings remain model interpretations.",
        evidence: evidenceIndex(
          originals,
          ctx.sessionManager.getSessionId(),
          state.claims,
        ),
      });
      const cut = event.branchEntries.findIndex(
        (e) => e.id === event.preparation.firstKeptEntryId,
      );
      if (cut < 0) throw new Error("Retained context cut point is unavailable");
      const retained = event.branchEntries
        .slice(cut)
        .filter((e) => e.type === "message");
      const schemas = pi
        .getAllTools()
        .filter((t) => pi.getActiveTools().includes(t.name));
      const requestUpperEstimate =
        bytes(summary) +
        bytes(ctx.getSystemPrompt()) +
        bytes(retained) +
        bytes(schemas) +
        8192;
      if (requestUpperEstimate > ctx.model.contextWindow)
        throw new Error("Replacement cannot preserve request/output headroom");
      if (bytes(summary) > 24576)
        throw new Error("Installed context exceeds 24 KiB budget");
      save(ctx, {
        version: 1,
        session: ctx.sessionManager.getSessionId(),
        summaryHash: digest(summary),
        phase: "prepared",
        continuation: "none",
      });
      return {
        compaction: {
          summary,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: {
            plugin: "pi-handoff",
            pluginVersion: HANDOFF_VERSION,
            trigger: "manual",
            version: 1,
            state,
            generation: { ...generation, usage: response.usage },
            evidenceRecord: {
              historyHash: history,
              sources: originals.map(({ id, role, hash, timestamp }) => ({
                id, role, hash, timestamp,
              })),
              project,
            },
          },
        },
      };
    } catch (error) {
      report(error);
      return { cancel: true };
    }
  });
  pi.on("session_compact_failed", (event, ctx) => {
    if (event.fromExtension && !event.aborted) {
      recoveryBlocked = true;
      unsafePersistence = true;
      ctx.abort();
      report(
        "Native context persistence failed; restart and inspect recovery state before executing work",
      );
    }
  });
  pi.on("session_compact", (event, ctx) => {
    const d = event.compactionEntry.details as any;
    if (d?.plugin !== "pi-handoff") return;
    try {
      const journal = load(ctx);
      if (
        !journal ||
        journal.summaryHash !== digest(event.compactionEntry.summary)
      )
        throw new Error("Uncertain Handoff commit");
      confirmCommit(ctx, journal.summaryHash);
      save(ctx, {
        ...journal,
        phase: "installed",
        continuation: "none",
      });
      if (d.state.status === "uncertain")
        report(
          "Task state is unresolved. Inspect the attributed uncertainty before continuing.",
        );
    } catch (error) {
      recoveryBlocked = true;
      ctx.abort();
      report(error);
    }
  });
}
