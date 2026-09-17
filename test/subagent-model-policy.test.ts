import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGlobalSubagentModel,
  installSubagentModelPolicy,
  readGlobalSubagentModel,
  setGlobalSubagentModel,
} from "../src/subagents/model-policy.js";

const cleanup: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function settingsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-coffee-subagents-"));
  cleanup.push(dir);
  return join(dir, "settings.json");
}

describe("global subagent model policy", () => {
  it("preserves settings and writes a global default atomically", async () => {
    const path = await settingsPath();
    await writeFile(path, JSON.stringify({ defaultModel: "parent/model", packages: ["x"] }));

    await setGlobalSubagentModel(" openai/gpt-5.6-luna:low ", path);

    expect(await readGlobalSubagentModel(path)).toBe("openai/gpt-5.6-luna:low");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      defaultModel: "parent/model",
      packages: ["x"],
      subagents: { defaultModel: "openai/gpt-5.6-luna:low" },
    });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    }
  });

  it("clears only the global default model", async () => {
    const path = await settingsPath();
    await writeFile(path, JSON.stringify({ subagents: { defaultModel: "x", defaultThinking: "low" } }));

    await clearGlobalSubagentModel(path);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ subagents: { defaultThinking: "low" } });
  });

  it("registers show, set, and off command actions", async () => {
    const path = await settingsPath();
    const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
    const notify = vi.fn();
    const pi = { registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) { commands.set(name, command.handler); } };
    installSubagentModelPolicy(pi as never, { settingsPath: path });
    const handler = commands.get("subagents-model");
    expect(handler).toBeDefined();

    await handler!("openai/gpt-5.6-luna", { ui: { notify } });
    await handler!("", { ui: { notify } });
    expect(notify).toHaveBeenLastCalledWith("global subagent model: openai/gpt-5.6-luna", "info");
    await handler!("off", { ui: { notify } });
    expect(await readGlobalSubagentModel(path)).toBeUndefined();
  });

  it("rejects empty and control-character model values", async () => {
    const path = await settingsPath();
    await expect(setGlobalSubagentModel("   ", path)).rejects.toThrow("non-empty");
    await expect(setGlobalSubagentModel("openai/\nmodel", path)).rejects.toThrow("control");
  });
});
