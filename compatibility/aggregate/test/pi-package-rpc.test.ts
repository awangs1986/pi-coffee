import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { execFileSync } from "node:child_process";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("loads the native package entry and exposes its bundled integration resources", async () => {
  // Use Node's actual package exports resolution, outside the test bundler.
  const resources = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import * as runtime from "pi-coffee";
    console.log(JSON.stringify({skills: runtime.resolvePiSkills({}), disabled: runtime.resolvePiExtensions({PI_COFFEE_EXTENSIONS:"off"}), path: runtime.withCoffeeLspPath({PATH:"/fixture"}).PATH, stop: typeof runtime.stopLspDaemon}));
  `], { encoding: "utf8" }));
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const root = await mkdtemp(join(tmpdir(), "coffee-package-rpc-"));
  const errors: unknown[] = [];
  const client = new RpcClient({
    cliPath: resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), cwd: root,
    env: { PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_COFFEE_SCHEDULER_DIR: join(root, "admission") },
    args: ["--offline", "--no-session", "--extension", resolve(manifest.pi.extensions[0]),
      ...resources.skills.flatMap((path: string) => ["--skill", path])],
  });
  const unsubscribe = client.onEvent(event => { if (event.type === "extension_error") errors.push(event); });
  try {
    await client.start();
    const commands = (await client.getCommands()).map(command => command.name);
    expect(commands).toEqual(expect.arrayContaining(["chat", "work", "harness", "context-recovery", "websearch", "curator", "skill:lsp"]));
    expect(errors).toEqual([]);
    expect(resources.disabled).toEqual([]);
    const bin = resources.path.split(delimiter)[0];
    expect(await readFile(join(bin, "coffee-lsp"), "utf8")).toContain("src/lsp/bin.js");
    expect(resources.stop).toBe("function");
  } finally {
    unsubscribe(); await client.stop(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
