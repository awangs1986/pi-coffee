import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { stopLspDaemon } from "../src/lsp/transport.js";

const exec = promisify(execFile);

async function fixture(
  run: (query: () => Promise<any>, root: string) => Promise<void>,
  config: NodeJS.ProcessEnv,
) {
  const root = mkdtempSync(join(tmpdir(), "coffee-lsp-source-case-"));
  writeFileSync(join(root, "app.CPP"), "int target = 1;\n");
  writeFileSync(join(root, "compile_commands.json"), "[]");
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: root,
    PI_COFFEE_ROOT_SESSION: root,
    PI_COFFEE_CPP_LSP_COMMAND: JSON.stringify([
      process.execPath,
      resolve("test/fixtures/fake-lsp-server.mjs"),
    ]),
    ...config,
  };
  const query = async () => {
    try {
      const { stdout } = await exec(process.execPath, [
        resolve("dist/src/lsp/bin.js"), "hover", "--file", "app.CPP",
        "--line", "1", "--column", "5", "--timeout-ms", "3000",
      ], { cwd: root, env, timeout: 6000 });
      return { code: 0, ...JSON.parse(stdout) };
    } catch (error: any) {
      if (!error.stdout) throw error;
      return { code: error.code, ...JSON.parse(error.stdout) };
    }
  };
  try {
    await run(query, root);
  } finally {
    await stopLspDaemon(root, env);
    rmSync(root, { recursive: true, force: true });
  }
}

it("updates uppercase C++ dependencies on a warm server after creation, edit and deletion", async () => {
  await fixture(async (query, root) => {
    expect((await query()).items[0].text).toBe("missing");
    writeFileSync(join(root, "lib.HPP"), "one");
    expect((await query()).items[0].text).toBe("one");
    writeFileSync(join(root, "lib.HPP"), "changed");
    expect((await query()).items[0].text).toBe("changed");
    rmSync(join(root, "lib.HPP"));
    expect((await query()).items[0].text).toBe("missing");
    expect(readFileSync(join(root, "starts"), "utf8").trim().split("\n")).toHaveLength(1);
  }, {
    PI_COFFEE_FAKE_LSP_DEPENDENCY: "1",
    PI_COFFEE_FAKE_LSP_DEPENDENCY_FILE: "lib.HPP",
    PI_COFFEE_FAKE_LSP_STARTS: "starts",
  });
});

it("rejects semantic output when an uppercase dependency changes during a query", async () => {
  await fixture(async (query, root) => {
    writeFileSync(join(root, "lib.HPP"), "one");
    const result = query();
    await expect.poll(() => existsSync(join(root, "hover-started")), { timeout: 2500 }).toBe(true);
    writeFileSync(join(root, "lib.HPP"), "changed");
    expect(await result).toMatchObject({
      code: 4,
      issues: [expect.objectContaining({ code: "stale_snapshot" })],
    });
  }, {
    PI_COFFEE_FAKE_LSP_HOVER_STARTED: "hover-started",
    PI_COFFEE_FAKE_LSP_DELAY: "700",
  });
});
