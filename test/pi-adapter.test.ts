import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";

describe("original Pi RPC adapter", () => {
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
    } finally {
      unsubscribe();
      await session.stop();
    }
  }, 10_000);
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
