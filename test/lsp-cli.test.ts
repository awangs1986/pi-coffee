import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stopLspDaemon,lspDaemonSocket } from "../src/lsp/transport.js";
import { existsSync } from "node:fs";
import { runCoffeeLsp } from "../src/lsp/cli.js";
import { resolvePiSkills } from "../src/pi-skills.js";

describe("coffee-lsp CLI", () => {
  it("uses a project's language server for symbols, navigation, hover and fresh diagnostics", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-cli-"));
    const source = join(root, "src/app.ts");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    writeFileSync(source, "export const target = 1;\nconst value = BAD;\n");
    const env = {
      ...process.env,
      PI_COFFEE_TS_LSP_COMMAND: `${process.execPath}\u0000${resolve("test/fixtures/fake-lsp-server.mjs")}`,
    };
    try {
      const status = await invoke(["status", "--file", source, "--workspace", root], root, env);
      expect(status.code).toBe(0);
      expect(status.json).toMatchObject({ schemaVersion: 1, operation: "status", status: "ok", server: { id: "typescript", state: "available" } });

      const symbols = await invoke(["symbols", "--file", source, "--workspace", root, "--no-daemon"], root, env);
      expect(symbols.json.items).toEqual([expect.objectContaining({ name: "target", location: expect.objectContaining({ line: 1, column: 17 }) })]);

      const definition = await invoke(["definition", "--file", source, "--line", "2", "--column", "15", "--workspace", root, "--no-daemon"], root, env);
      expect(definition.json.items).toEqual([expect.objectContaining({ path: source, location: expect.objectContaining({ line: 1, column: 17 }) })]);

      const references = await invoke(["references", "--file", source, "--line", "1", "--column", "17", "--workspace", root, "--no-daemon"], root, env);
      expect(references.json.items).toEqual([expect.objectContaining({ path: source, location: expect.objectContaining({ line: 2, column: 7 }) })]);

      const hover = await invoke(["hover", "--file", source, "--line", "1", "--column", "17", "--workspace", root, "--no-daemon"], root, env);
      expect(hover.json.items).toEqual([expect.objectContaining({ text: "const target: number" })]);

      const oldHash = symbols.json.items[0].sha256;
      writeFileSync(source, `${readFileSync(source, "utf8")}\n`);
      const stale = await invoke(["hover", "--file", source, "--line", "1", "--column", "17", "--workspace", root, "--expect-sha256", oldHash, "--no-daemon"], root, env);
      expect(stale).toMatchObject({ code: 4, json: { status: "partial", issues: [{ code: "stale_position" }] } });

      const before = await invoke(["diagnostics", "--file", source, "--workspace", root, "--no-daemon"], root, env);
      expect(before.code).toBe(0);
      expect(before.json).toMatchObject({ status: "ok", diagnosticState: "findings", coverage: { requestedFiles: 1, confirmedFiles: 1 } });
      expect(before.json.items).toEqual([expect.objectContaining({ code: "fixture-error", path: source })]);

      writeFileSync(source, readFileSync(source, "utf8").replace("BAD", "target"));
      const after = await invoke(["diagnostics", "--file", source, "--workspace", root, "--no-daemon"], root, env);
      expect(after.code).toBe(0);
      expect(after.json).toMatchObject({ status: "ok", diagnosticState: "clean", coverage: { confirmedFiles: 1 } });
      expect(after.json.items).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("ships one discoverable Pi skill with the built application", () => {
    const [skill] = resolvePiSkills();
    expect(skill).toMatch(/skills[\\/]lsp$/);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("coffee-lsp status");
  });

  it("reuses one language-server process across default CLI calls and stops it for cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-daemon-"));
    const source = join(root, "app.ts");
    const starts = join(root, "starts.txt");
    writeFileSync(source, "export const target = 1;\n");
    writeFileSync(starts, "");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: `test-${process.pid}-${Date.now()}`,
      PI_COFFEE_LSP_IDLE_MS: "200",
      PI_COFFEE_FAKE_LSP_STARTS: starts,
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([process.execPath, resolve("test/fixtures/fake-lsp-server.mjs")]),
    };
    try {
      const cli = resolve("dist/src/lsp/bin.js");
      for (const operation of ["symbols", "hover"]) {
        const args = operation === "hover"
          ? [cli, operation, "--file", source, "--line", "1", "--column", "14", "--workspace", root]
          : [cli, operation, "--file", source, "--workspace", root];
        const output = execFileSync(process.execPath, args, { cwd: process.cwd(), env, encoding: "utf8" });
        expect(JSON.parse(output)).toMatchObject({ status: "ok", server: { id: "typescript", state: "ready" } });
      }
      for (let index = 0; index < 2; index += 1) {
        const output = execFileSync(process.execPath, [cli, "diagnostics", "--file", source, "--workspace", root], { cwd: process.cwd(), env, encoding: "utf8" });
        expect(JSON.parse(output)).toMatchObject({ status: "ok", diagnosticState: "clean" });
      }
      expect(readFileSync(starts, "utf8").trim().split("\n")).toEqual(["start"]);
      await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION,env);
      await expect.poll(()=>existsSync(lspDaemonSocket(env))).toBe(false);
      await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION,env);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});

async function invoke(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number; json: any }> {
  let stdout = "";
  let stderr = "";
  const code = await runCoffeeLsp(args, {
    cwd,
    env,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
  });
  expect(stderr).toBe("");
  return { code, json: JSON.parse(stdout) };
}
