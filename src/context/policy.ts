import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { boundSubagentResult } from "../subagents/result-artifact.js";
import { redactSecrets } from "../web/research-artifact.js";

// Parent-facing subagent output is always bounded, including failure details.
const BOUNDED_TOOLS = new Set(["read", "bash", "grep", "find", "ls", "git", "verify", "fetch_content", "source_check", "get_search_content"]);
const MAX_RESULT_BYTES = 12_000;

/** Wrap the upstream deterministic compaction hook; never silently request a model summary. */
export function protectLocalCompaction(
  handler: (event: any, context: any) => any,
): (event: any, context: any) => Promise<any> {
  return async (event, ctx) => {
    try {
      const result = await handler(event, ctx);
      if (result?.compaction?.summary?.trim()) return result;
    } catch { /* Keep errors and credentials out of notices. */ }
    try { ctx.ui.notify("Local compaction failed or is disabled. No model summary was requested. Check VM storage and context-fold configuration, then retry locally.", "error"); } catch { /* cancellation must still reach Pi */ }
    return { cancel: true };
  };
}

/** Limits at the public Pi seam, without changing tool permissions or the original session store. */
export function installContextPolicy(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (["subagent", "bg_wait"].includes(event.toolName)) {
      const bounded = boundSubagentResult(event.content, event.details);
      return { ...bounded, isError: event.isError || bounded.details.isError === true };
    }
    if (!BOUNDED_TOOLS.has(event.toolName)) return;
    const serialized = JSON.stringify({ content: event.content, details: event.details });
    if (Buffer.byteLength(serialized, "utf8") <= MAX_RESULT_BYTES) return;
    try {
      // A separate artifact is evidence, not conversational history. Write before returning a pointer.
      const safe = redactSecrets(serialized);
      const dir = join(ctx.sessionManager.getSessionDir(), "tool-artifacts");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const digest = createHash("sha256").update(safe).digest("hex");
      const path = join(dir, `${digest}.json`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, safe, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(() => undefined); }
      const text = event.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      const preview = redactSecrets(text).slice(0, 4000);
      return {
        content: [{ type: "text" as const, text: `${preview}\n[Large result archived; preview is incomplete]\nArtifact: ${path}\nRead a specific range or rerun a narrower query; do not load the entire archive.` }],
        details: { artifactPath: path, sha256: digest, bytes: Buffer.byteLength(safe), truncated: true },
        isError: event.isError,
      };
    } catch {
      return { content: [{ type: "text" as const, text: "Large tool result not saved: VM artifact write failed. Output omitted to avoid context overflow. The operation may already have run; inspect state before retrying." }],
        details: { code: "artifact_write_failed" }, isError: true };
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    // This is a conservative wire-size estimate, NOT a tokenizer or supplier guarantee.
    // It covers system text, schemas, messages and encoded media in the final payload.
    const window = ctx.model?.contextWindow;
    if (!window || !Number.isFinite(window)) {
      ctx.abort();
      ctx.ui.notify("context_budget_unknown: model context window is missing. Correct model configuration before retrying.", "error");
      return;
    }
    const estimate = Math.ceil(Buffer.byteLength(JSON.stringify(event.payload) ?? "", "utf8") / 2);
    const outputReserve = Math.min(ctx.model?.maxTokens ?? 8192, Math.floor(window / 4));
    const limit = Math.floor((window - outputReserve) * 0.85);
    if (estimate > limit) {
      // Pi catches hook exceptions, so throwing would NOT stop the request. Abort its signal instead.
      ctx.abort();
      ctx.ui.notify(`context_budget_exceeded: estimated request ${estimate} tokens exceeds conservative input budget ${limit}. Use local compaction, shorten the current input, or select a correctly configured larger model. No automatic replay.`, "error");
    }
  });
}
