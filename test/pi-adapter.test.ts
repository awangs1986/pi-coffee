import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appendExtensionArgs, projectHistory, RpcPiSessionFactory } from "../src/host/pi-adapter.js";

describe("original Pi RPC adapter", () => {
  it("adds configured Pi extensions once while preserving explicit CLI args", () => {
    expect(appendExtensionArgs(["--extension", "./existing.js"], ["./existing.js", "./harness.js", ""])).toEqual([
      "--extension",
      "./existing.js",
      "--extension",
      "./harness.js",
    ]);
  });

  it("maps the documented RPC client to the PI Coffee PiSession seam", async () => {
    const factory = new RpcPiSessionFactory({
      cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"),
      cwd: process.cwd(),
      sessionDir: resolve(".tmp-test-sessions"),
    });
    const session = await factory.create({ sessionId: "adapter-test" });
    const events: unknown[] = [];
    const unsubscribe = session.onEvent((event) => events.push(event));
    try {
      expect(await session.getState()).toMatchObject({ isStreaming: false, messageCount: 0 });
      await session.prompt("hello from adapter");
      await waitFor(() => events.some((event) => isEvent(event, "agent_settled")));
      expect(events).toEqual(
        expect.arrayContaining([
          { type: "agent_start" },
          expect.objectContaining({ type: "message_update" }),
          { type: "agent_settled" },
        ]),
      );
      // History comes from the RPC process's durable entries (get_entries).
      const history = await session.getHistory();
      expect(history.entries).toEqual([
        expect.objectContaining({ kind: "user", text: "hello from adapter" }),
        expect.objectContaining({ kind: "assistant", text: "echo: hello from adapter" }),
      ]);
      expect(history.leafId).toBe(history.entries.at(-1)?.id);
    } finally {
      unsubscribe();
      await session.stop();
    }
  }, 10_000);

  it("resumes a conversation that already exists in the session store instead of creating a new one", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-coffee-resume-"));
    const id = "11111111-2222-4333-8444-555555555555";
    // A minimal Pi v3 session file, as Pi itself writes them.
    writeFileSync(
      join(sessionDir, `2026-09-03T00-00-00-000Z_${id}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-09-03T00:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-09-03T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "earlier question" }] } }),
        JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-09-03T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "earlier answer" }] } }),
        "",
      ].join("\n"),
    );
    const factory = new RpcPiSessionFactory({
      cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"),
      cwd: process.cwd(),
      sessionDir,
    });
    try {
      const listed = await factory.list();
      expect(listed).toEqual([
        expect.objectContaining({ id, messageCount: 2, preview: "earlier question" }),
      ]);
      expect(JSON.stringify(listed)).not.toContain(sessionDir); // VM paths never leave the adapter

      const session = await factory.create({ sessionId: id });
      try {
        // The fake CLI seeds a "resumed from <path>" exchange only when it was
        // started with --session <path>, which is how the adapter must resume.
        const history = await session.getHistory();
        expect(history.entries[0]).toMatchObject({ kind: "user", text: expect.stringMatching(/^resumed from .*\.jsonl$/) });
      } finally {
        await session.stop();
      }
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("history projection", () => {
  it("follows the active branch and pairs tool calls with their results", () => {
    const entries = [
      { type: "model_change", id: "x0", parentId: null, provider: "cpa", modelId: "m" },
      { type: "message", id: "u1", parentId: "x0", timestamp: "t1", message: { role: "user", content: "list files" } },
      {
        type: "message", id: "a1", parentId: "u1", timestamp: "t2",
        message: { role: "assistant", content: [{ type: "text", text: "Sure." }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }] },
      },
      { type: "message", id: "r1", parentId: "a1", timestamp: "t3", message: { role: "toolResult", toolCallId: "call-1", isError: false, content: [{ type: "text", text: "a.txt\nb.txt" }] } },
      { type: "message", id: "a2", parentId: "r1", timestamp: "t4", message: { role: "assistant", content: [{ type: "text", text: "Two files." }] } },
      // Abandoned branch off u1: must not appear when the leaf is a2.
      { type: "message", id: "alt", parentId: "u1", timestamp: "t5", message: { role: "assistant", content: [{ type: "text", text: "abandoned" }] } },
      { type: "compaction", id: "c1", parentId: "a2", timestamp: "t6", summary: "…" },
      { type: "message", id: "u2", parentId: "c1", timestamp: "t7", message: { role: "user", content: [{ type: "text", text: "thanks" }, { type: "image", data: "…", mimeType: "image/png" }] } },
    ];
    const history = projectHistory(entries, "u2");
    expect(history.entries).toEqual([
      { kind: "user", id: "u1", at: "t1", text: "list files" },
      { kind: "assistant", id: "a1", at: "t2", text: "Sure." },
      { kind: "tool", id: "call-1", at: "t2", name: "bash", args: { command: "ls" }, result: "a.txt\nb.txt", isError: false },
      { kind: "assistant", id: "a2", at: "t4", text: "Two files." },
      expect.objectContaining({ kind: "note", id: "c1" }),
      { kind: "user", id: "u2", at: "t7", text: "thanks", imageCount: 1 },
    ]);
    expect(JSON.stringify(history.entries)).not.toContain("abandoned");
  });

  it("falls back to append order when there is no leaf", () => {
    const entries = [
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "hi" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ];
    expect(projectHistory(entries, null).entries.map((entry) => entry.text)).toEqual(["hi", "hello"]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for fake Pi event");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

function isEvent(value: unknown, type: string): boolean {
  return typeof value === "object" && value !== null && "type" in value && value.type === type;
}
