import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DELEGATION_CANCEL_EVENT, SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "pi-subagents/delegation";
import { invokeNativeSubagent } from "../src/subagents/delegation.js";

class Events {
  private readonly handlers = new Map<string, Set<(value: unknown) => void>>();

  on(channel: string, handler: (value: unknown) => void): () => void {
    const set = this.handlers.get(channel) ?? new Set<(value: unknown) => void>();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => set.delete(handler);
  }

  emit(channel: string, value: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(value);
  }
}

describe("native pi-subagents delegation adapter", () => {
  it("uses the official request/response event seam with a zero-tool budget", async () => {
    const events = new Events();
    events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (value: any) => {
      expect(value.context).toBe("fresh");
      expect(value.result).toEqual({ kind: "text" });
      expect(value.toolBudget).toEqual({ hard: 0, block: "*" });
      events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
        requestId: value.requestId,
        ownerRunId: value.ownerRunId,
        nodeId: value.nodeId,
        status: "completed",
        result: { kind: "text", text: "brief" },
      });
    });
    const result = await invokeNativeSubagent({ events } as unknown as ExtensionAPI, {
      task: "summarize evidence",
      context: { cwd: "/workspace" } as never,
    });
    expect(result).toBe("brief");
  });

  it("cancels a pending request when its signal aborts", async () => {
    const events = new Events();
    let cancelled = false;
    events.on(SUBAGENT_DELEGATION_CANCEL_EVENT, () => { cancelled = true; });
    const controller = new AbortController();
    const resultPromise = invokeNativeSubagent({ events } as unknown as ExtensionAPI, {
      task: "wait",
      context: { cwd: "/workspace" } as never,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();
    expect(await resultPromise).toBeUndefined();
    expect(cancelled).toBe(true);
  });
});
