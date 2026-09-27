import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { stopLspDaemon } from "../src/lsp/transport.js";

const exec = promisify(execFile);

it("retries a server killed during initialization without failure backoff", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-lsp-init-recovery-"));
  const pidFile = join(root, "server-pid");
  const startsFile = join(root, "server-starts");
  const source = join(root, "app.ts");
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(source, "export const target = 1;\n");
  const env = {
    ...process.env,
    PI_COFFEE_ROOT_SESSION: root,
    XDG_RUNTIME_DIR: root,
    PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
      process.execPath,
      fileURLToPath(new URL("./fixtures/fake-lsp-server.mjs", import.meta.url)),
    ]),
    PI_COFFEE_FAKE_LSP_PID: pidFile,
    PI_COFFEE_FAKE_LSP_STARTS: startsFile,
    PI_COFFEE_FAKE_LSP_INIT_DELAY: "1000",
  };
  const query = async () => {
    const args = [
      fileURLToPath(new URL("../dist/src/lsp/bin.js", import.meta.url)),
      "symbols", "--file", source, "--timeout-ms", "5000",
    ];
    try {
      const result = await exec(process.execPath, args, { cwd: root, env });
      return { code: 0, json: JSON.parse(result.stdout) };
    } catch (error: any) {
      if (!error.stdout) throw error;
      return { code: error.code, json: JSON.parse(error.stdout) };
    }
  };
  try {
    const firstQuery = query();
    const deadline = Date.now() + 4000;
    while (!existsSync(pidFile) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(pidFile)).toBe(true);
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
    expect(await firstQuery).toMatchObject({ code: 5 });

    expect(await query()).toMatchObject({
      code: 0,
      json: { status: "ok", items: [expect.objectContaining({ name: "target" })] },
    });
    expect(readFileSync(startsFile, "utf8").trim().split("\n")).toHaveLength(2);
  } finally {
    await stopLspDaemon(root, env);
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

it("retries after initialization loses its writable transport before process exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-lsp-init-pipe-"));
  const project = join(root, "project");
  mkdirSync(project);
  const source = join(project, "app.ts");
  const startsFile = join(root, "starts");
  const server = join(root, "close-stdin-once.mjs");
  const healthyServer = fileURLToPath(
    new URL("./fixtures/fake-lsp-server.mjs", import.meta.url),
  );
  writeFileSync(join(project, "tsconfig.json"), "{}");
  writeFileSync(source, "export const target = 1;\n");
  writeFileSync(join(project, "coffee-lsp.json"), JSON.stringify({
    typescript: { initializationOptions: { payload: "x".repeat(60000) } },
  }));
  writeFileSync(server, [
    "import { existsSync, writeFileSync, appendFileSync, closeSync } from 'node:fs';",
    "if (existsSync(process.env.COFFEE_TEST_FAILED_ONCE)) {",
    "  await import(" + JSON.stringify(healthyServer) + ");",
    "} else {",
    "  writeFileSync(process.env.COFFEE_TEST_FAILED_ONCE, '1');",
    "  appendFileSync(process.env.PI_COFFEE_FAKE_LSP_STARTS, 'start\\n');",
    "  let input = Buffer.alloc(0);",
    "  process.stdin.on('data', chunk => {",
    "    input = Buffer.concat([input, chunk]);",
    "    const headerEnd = input.indexOf('\\r\\n\\r\\n');",
    "    if (headerEnd < 0) return;",
    "    const length = Number(input.subarray(0, headerEnd).toString().match(/Content-Length: (\\d+)/)[1]);",
    "    if (input.length < headerEnd + 4 + length) return;",
    "    const request = JSON.parse(input.subarray(headerEnd + 4, headerEnd + 4 + length));",
    "    closeSync(0);",
    "    setTimeout(() => {",
    "      const body = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { capabilities: { documentSymbolProvider: true } } });",
    "      process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);",
    "    }, 50);",
    "  });",
    "  setInterval(() => {}, 1000);",
    "}",
  ].join("\n"));
  const env = {
    ...process.env,
    PI_COFFEE_ROOT_SESSION: root,
    XDG_RUNTIME_DIR: root,
    PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([process.execPath, server]),
    PI_COFFEE_FAKE_LSP_STARTS: startsFile,
    COFFEE_TEST_FAILED_ONCE: join(root, "failed-once"),
  };
  const args = [
    fileURLToPath(new URL("../dist/src/lsp/bin.js", import.meta.url)),
    "symbols", "--file", source, "--timeout-ms", "5000",
  ];
  try {
    const first = await exec(process.execPath, args, { cwd: project, env })
      .then(() => { throw new Error("Broken transport unexpectedly succeeded"); },
        (error: any) => ({ code: error.code, json: JSON.parse(error.stdout) }));
    expect(first).toMatchObject({ code: 5 });
    expect(first.json.issues[0].message).toMatch(/EPIPE|ECONNRESET/);
    const second = await exec(process.execPath, args, { cwd: project, env }).then(
      ({ stdout }) => ({ code: 0, json: JSON.parse(stdout) }),
      (error: any) => ({ code: error.code, json: JSON.parse(error.stdout) }),
    );
    expect(second).toMatchObject({
      code: 0,
      json: { status: "ok", items: [expect.objectContaining({ name: "target" })] },
    });
    expect(readFileSync(startsFile, "utf8").trim().split("\n")).toHaveLength(2);
  } finally {
    await stopLspDaemon(root, env);
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
