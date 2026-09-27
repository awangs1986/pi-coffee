import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("finds interface implementations through the packaged CLI", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-port-"));
  writeFileSync(join(root, "app.ts"), "interface Value { get(): number }\n");
  try {
    const { stdout } = await exec(
      process.execPath,
      [
        resolve("dist/src/lsp/bin.js"),
        "implementation",
        "--file",
        join(root, "app.ts"),
        "--line",
        "1",
        "--column",
        "11",
        "--no-daemon",
      ],
      {
        env: {
          ...process.env,
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      items: [expect.objectContaining({ path: join(root, "app.ts") })],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { stopLspDaemon } from "../src/lsp/transport.js";
async function fixture(
  run: (
    q: (op: string, extra?: string[]) => Promise<any>,
    root: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<void>,
  config: NodeJS.ProcessEnv = {},
) {
  const root = mkdtempSync(join(tmpdir(), "coffee port #%?-"));
  writeFileSync(join(root, "app.ts"), "const target = 1;\nconst bad = BAD;\n");
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: root,
    PI_COFFEE_ROOT_SESSION: root,
    PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
      process.execPath,
      resolve("test/fixtures/fake-lsp-server.mjs"),
    ]),
    ...config,
  };
  const q = async (op: string, extra: string[] = []) => {
    const args = [
      resolve("dist/src/lsp/bin.js"),
      op,
      "--file",
      join(root, "app.ts"),
      "--timeout-ms",
      "800",
      ...extra,
    ];
    try {
      const r = await exec(process.execPath, args, {
        cwd: root,
        env,
        timeout: 6000,
      });
      return { code: 0, ...JSON.parse(r.stdout) };
    } catch (e: any) {
      if (!e.stdout) throw e;
      return { code: e.code, ...JSON.parse(e.stdout) };
    }
  };
  try {
    await run(q, root, env);
  } finally {
    await stopLspDaemon(root, env);
    rmSync(root, { recursive: true, force: true });
  }
}
it("retains same-file diagnostics published during a preceding semantic query", async () => {
  await fixture(
    async (q) => {
      expect((await q("symbols")).status).toBe("ok");
      expect(await q("diagnostics")).toMatchObject({
        code: 0,
        diagnosticState: "findings",
        items: [expect.objectContaining({ code: "fixture-error" })],
      });
    },
    { PI_COFFEE_FAKE_LSP_SAME_TEXT: "1" },
  );
});
it("rejects out-of-file positions as a caller error", async () => {
  await fixture(async (q) => {
    expect(
      await q("hover", ["--line", "999", "--column", "999"]),
    ).toMatchObject({
      code: 2,
      issues: [expect.objectContaining({ code: "invalid_arguments" })],
    });
  });
});
it("honors a shorter deadline on a reused server and keeps it usable", async () => {
  await fixture(
    async (q) => {
      expect((await q("symbols")).code).toBe(0);
      expect(
        await q("hover", [
          "--line",
          "1",
          "--column",
          "7",
          "--timeout-ms",
          "150",
        ]),
      ).toMatchObject({
        code: 4,
        issues: [expect.objectContaining({ code: "request_timeout" })],
      });
      expect((await q("hover", ["--line", "1", "--column", "7"])).code).toBe(0);
    },
    { PI_COFFEE_FAKE_LSP_DELAY: "350" },
  );
});
import { spawn } from "node:child_process";
import { lspDaemonSocket } from "../src/lsp/transport.js";
it("ends the owned daemon process when the package consumer stops it", async () => {
  await fixture(async (q, root, env) => {
    const daemon = spawn(
      process.execPath,
      [resolve("dist/src/lsp/bin.js"), "__daemon", lspDaemonSocket(env)],
      { env, stdio: "ignore" },
    );
    try {
      await expect
        .poll(() => requireExists(lspDaemonSocket(env)), { timeout: 2000 })
        .toBe(true);
      expect((await q("symbols")).code).toBe(0);
      await stopLspDaemon(root, env);
      await expect
        .poll(() => daemon.exitCode !== null, { timeout: 1000 })
        .toBe(true);
    } finally {
      daemon.kill("SIGKILL");
    }
  });
});
import { existsSync as requireExists } from "node:fs";

it("updates changed, created and deleted dependencies without restarting the server", async () => {
  await fixture(
    async (q, root) => {
      const hover = () => q("hover", ["--line", "1", "--column", "7"]);
      expect((await hover()).items[0].text).toBe("missing");
      writeFileSync(join(root, "lib.ts"), "one");
      expect((await hover()).items[0].text).toBe("one");
      writeFileSync(join(root, "lib.ts"), "two");
      expect((await hover()).items[0].text).toBe("two");
      rmSync(join(root, "lib.ts"));
      expect((await hover()).items[0].text).toBe("missing");
      expect(
        readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
      ).toHaveLength(1);
    },
    { PI_COFFEE_FAKE_LSP_DEPENDENCY: "1", PI_COFFEE_FAKE_LSP_STARTS: "starts" },
  );
});
it("shares one deadline across initialization and the query", async () => {
  await fixture(
    async (q) => {
      expect(
        await q("hover", [
          "--line",
          "1",
          "--column",
          "7",
          "--timeout-ms",
          "300",
        ]),
      ).toMatchObject({
        code: 4,
        issues: [expect.objectContaining({ code: "request_timeout" })],
      });
    },
    { PI_COFFEE_FAKE_LSP_INIT_DELAY: "150", PI_COFFEE_FAKE_LSP_DELAY: "200" },
  );
});
it("uses dynamically registered hover and pull diagnostics", async () => {
  await fixture(
    async (q) => {
      expect((await q("hover", ["--line", "1", "--column", "7"])).code).toBe(0);
      expect(await q("diagnostics")).toMatchObject({
        code: 0,
        diagnosticState: "findings",
      });
    },
    { PI_COFFEE_FAKE_LSP_DYNAMIC: "1" },
  );
});
it("removes dynamically unregistered capabilities", async () => {
  await fixture(
    async (q) => {
      expect((await q("diagnostics")).code).toBe(0);
      expect((await q("symbols")).code).toBe(0);
      expect(await q("hover", ["--line", "1", "--column", "7"])).toMatchObject({
        code: 3,
      });
      expect(await q("diagnostics")).toMatchObject({
        code: 4,
        diagnosticState: "inconclusive",
      });
    },
    { PI_COFFEE_FAKE_LSP_DYNAMIC: "1", PI_COFFEE_FAKE_LSP_UNREGISTER: "1" },
  );
});
it.each(["STALE", "SILENT", "VERSIONLESS"])(
  "does not claim clean for %s diagnostic evidence",
  async (mode) => {
    await fixture(
      async (q, root) => {
        writeFileSync(join(root, "app.ts"), "const target = 1;\n");
        expect(await q("diagnostics")).toMatchObject({
          code: 4,
          diagnosticState: "inconclusive",
        });
      },
      { ["PI_COFFEE_FAKE_LSP_" + mode]: "1" },
    );
  },
);
it("backs off deterministic initialization failures but retries after configuration changes", async () => {
  await fixture(
    async (q, root) => {
      expect((await q("symbols")).code).toBe(5);
      expect((await q("symbols")).code).toBe(5);
      expect(
        readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
      ).toHaveLength(1);
      writeFileSync(join(root, "coffee-lsp.json"), "{}");
      expect((await q("symbols")).code).toBe(5);
      expect(
        readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
      ).toHaveLength(2);
    },
    { PI_COFFEE_FAKE_LSP_INIT_FAIL: "1", PI_COFFEE_FAKE_LSP_STARTS: "starts" },
  );
});
it("retries temporarily empty references during initial indexing", async () => {
  await fixture(
    async (q) => {
      expect(
        (await q("references", ["--line", "1", "--column", "7"])).items,
      ).toHaveLength(1);
    },
    { PI_COFFEE_FAKE_LSP_REFERENCES: "1" },
  );
});
it("cancels a daemon CLI query without replacing a healthy language server", async () => {
  await fixture(
    async (q, root, env) => {
      expect((await q("symbols")).code).toBe(0);
      const child = spawn(
        process.execPath,
        [
          resolve("dist/src/lsp/bin.js"),
          "hover",
          "--file",
          join(root, "app.ts"),
          "--line",
          "1",
          "--column",
          "7",
        ],
        { cwd: root, env },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try {
        await expect
          .poll(() => requireExists(join(root, "hover-started")), {
            timeout: 2000,
          })
          .toBe(true);
        child.kill("SIGINT");
        expect(await exited).toBe(4);
        expect(JSON.parse(stdout).issues[0].code).toBe("request_cancelled");
        await expect
          .poll(() => requireExists(join(root, "cancelled")))
          .toBe(true);
        expect((await q("symbols")).code).toBe(0);
        expect(
          readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
        ).toHaveLength(1);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
    {
      PI_COFFEE_FAKE_LSP_HOVER_STARTED: "hover-started",
      PI_COFFEE_FAKE_LSP_CANCEL: "cancelled",
      PI_COFFEE_FAKE_LSP_STARTS: "starts",
    },
  );
});
it("retires the process using superseded configuration", async () => {
  await fixture(
    async (q, root) => {
      expect((await q("symbols")).code).toBe(0);
      const oldPid = Number(readFileSync(join(root, "pid"), "utf8"));
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          typescript: { settings: { fixture: { target: "new" } } },
        }),
      );
      expect(
        (await q("hover", ["--line", "1", "--column", "7"])).items[0].text,
      ).toBe("new");
      expect(() => process.kill(oldPid, 0)).toThrow();
      expect(Number(readFileSync(join(root, "pid"), "utf8"))).not.toBe(oldPid);
    },
    { PI_COFFEE_FAKE_LSP_PID: "pid", PI_COFFEE_FAKE_LSP_SETTINGS: "1" },
  );
});
it("retries initialization after a caller-shortened deadline", async () => {
  await fixture(
    async (q) => {
      expect((await q("symbols", ["--timeout-ms", "100"])).code).toBe(4);
      expect((await q("symbols")).code).toBe(0);
    },
    { PI_COFFEE_FAKE_LSP_INIT_DELAY: "200" },
  );
});
it("never treats a failed diagnostic pull as a clean report", async () => {
  await fixture(
    async (q) => {
      expect(await q("diagnostics")).toMatchObject({
        code: 5,
        issues: [expect.objectContaining({ message: "pull failed" })],
      });
    },
    { PI_COFFEE_FAKE_LSP_DYNAMIC: "1", PI_COFFEE_FAKE_LSP_PULL_FAIL: "1" },
  );
});
it("bounds a write when a language server stops reading stdin", async () => {
  await fixture(
    async (q, root) => {
      writeFileSync(
        join(root, "app.ts"),
        "const target = 1;\n" + "// filler\n".repeat(300000),
      );
      const started = Date.now();
      expect((await q("symbols", ["--timeout-ms", "250"])).code).toBe(4);
      expect(Date.now() - started).toBeLessThan(2500);
      const pid = Number(readFileSync(join(root, "pid"), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    },
    { PI_COFFEE_FAKE_LSP_PAUSE: "1", PI_COFFEE_FAKE_LSP_PID: "pid" },
  );
});
it("matches equivalent diagnostic URIs and navigation paths containing special characters", async () => {
  await fixture(
    async (q) => {
      expect(await q("diagnostics")).toMatchObject({
        code: 0,
        diagnosticState: "findings",
      });
      expect(
        (await q("definition", ["--line", "1", "--column", "7"])).code,
      ).toBe(0);
    },
    { PI_COFFEE_FAKE_LSP_RAW_URI: "1" },
  );
});
it("accepts a fresh repair report without sending a duplicate document version", async () => {
  await fixture(
    async (q, root) => {
      expect((await q("diagnostics")).diagnosticState).toBe("findings");
      writeFileSync(join(root, "app.ts"), "const target = 1;\n");
      expect(await q("diagnostics")).toMatchObject({
        code: 0,
        diagnosticState: "clean",
      });
    },
    { PI_COFFEE_FAKE_LSP_SAME_TEXT: "1" },
  );
});
it("keeps diagnostics inconclusive when a backend cannot confirm clean or support the reopen barrier", async () => {
  await fixture(
    async (q, root) => {
      expect((await q("diagnostics")).diagnosticState).toBe("findings");
      writeFileSync(join(root, "app.ts"), "const target = 1;\n");
      expect((await q("diagnostics")).diagnosticState).toBe("clean");
      writeFileSync(join(root, "app.ts"), "const target = 2;\n");
      expect(await q("diagnostics")).toMatchObject({
        code: 4,
        diagnosticState: "inconclusive",
        coverage: { confirmedFiles: 0 },
      });
      expect((await q("hover", ["--line", "1", "--column", "7"])).code).toBe(0);
      expect(
        readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
      ).toHaveLength(1);
    },
    {
      PI_COFFEE_FAKE_LSP_NO_SYMBOLS: "1",
      PI_COFFEE_FAKE_LSP_SUPPRESS_CLEAN: "1",
      PI_COFFEE_FAKE_LSP_STARTS: "starts",
    },
  );
});
it.each(["deadline", "cancel"])(
  "retires a server after a %s interrupts lazy diagnostic reopening",
  async (mode) => {
    await fixture(
      async (q, root, env) => {
        writeFileSync(join(root, "app.ts"), "const target = 1;\n");
        expect((await q("diagnostics")).diagnosticState).toBe("clean");
        writeFileSync(join(root, "lib.ts"), "export const dependency = 1;\n");
        if (mode === "deadline") {
          expect(await q("diagnostics", ["--timeout-ms", "300"])).toMatchObject({
            code: 4,
            diagnosticState: "inconclusive",
          });
        } else {
          const child = spawn(
            process.execPath,
            [
              resolve("dist/src/lsp/bin.js"),
              "diagnostics",
              "--file",
              join(root, "app.ts"),
              "--timeout-ms",
              "3000",
            ],
            { cwd: root, env },
          );
          let stdout = "";
          child.stdout.on("data", (chunk) => (stdout += chunk));
          const exited = new Promise((resolve) => child.once("exit", resolve));
          try {
            await expect
              .poll(() => requireExists(join(root, "barrier-started")), {
                timeout: 2000,
              })
              .toBe(true);
            child.kill("SIGINT");
            expect(await exited).toBe(4);
            expect(JSON.parse(stdout).issues[0].code).toBe("request_cancelled");
          } finally {
            if (child.exitCode === null) child.kill("SIGKILL");
          }
        }
        expect((await q("hover", ["--line", "1", "--column", "7"])).items)
          .toHaveLength(1);
        expect(
          readFileSync(join(root, "starts"), "utf8").trim().split("\n"),
        ).toHaveLength(2);
      },
      {
        PI_COFFEE_FAKE_LSP_BARRIER_HANG: "1",
        PI_COFFEE_FAKE_LSP_BARRIER_STARTED: "barrier-started",
        PI_COFFEE_FAKE_LSP_STARTS: "starts",
      },
    );
  },
);

it("uses the latest full pull even when the saved document version is unchanged", async () => {
  await fixture(
    async (q) => {
      expect((await q("diagnostics")).diagnosticState).toBe("clean");
      expect((await q("diagnostics")).diagnosticState).toBe("findings");
    },
    { PI_COFFEE_FAKE_LSP_DYNAMIC: "1", PI_COFFEE_FAKE_LSP_PULL_SEQUENCE: "1" },
  );
});
it("counts time spent in the daemon queue against the caller deadline", async () => {
  await fixture(
    async (q, root) => {
      expect((await q("symbols")).code).toBe(0);
      const busy = q("hover", [
        "--line",
        "1",
        "--column",
        "7",
        "--timeout-ms",
        "2000",
      ]);
      await expect
        .poll(() => requireExists(join(root, "hover-started")))
        .toBe(true);
      const started = Date.now();
      expect(await q("symbols", ["--timeout-ms", "100"])).toMatchObject({
        code: 4,
        issues: [expect.objectContaining({ code: "request_timeout" })],
      });
      expect(Date.now() - started).toBeLessThan(1000);
      expect((await busy).code).toBe(0);
    },
    {
      PI_COFFEE_FAKE_LSP_DELAY: "1200",
      PI_COFFEE_FAKE_LSP_HOVER_STARTED: "hover-started",
    },
  );
});
it("stops promptly while an owned query is still running", async () => {
  await fixture(
    async (q, root, env) => {
      const busy = q("hover", [
        "--line",
        "1",
        "--column",
        "7",
        "--timeout-ms",
        "3000",
      ]);
      await expect
        .poll(() => requireExists(join(root, "hover-started")))
        .toBe(true);
      const started = Date.now();
      await stopLspDaemon(root, env);
      expect(Date.now() - started).toBeLessThan(1200);
      expect((await busy).code).not.toBe(0);
    },
    {
      PI_COFFEE_FAKE_LSP_DELAY: "2000",
      PI_COFFEE_FAKE_LSP_HOVER_STARTED: "hover-started",
    },
  );
});

it("retains confirmed findings when a later file exhausts the batch budget", async () => {
  await fixture(
    async (q, root) => {
      writeFileSync(join(root, "silent.ts"), "const empty = 1;");
      writeFileSync(join(root, "last.ts"), "const last = 1;");
      expect(
        await q("diagnostics", [
          "--file",
          join(root, "silent.ts"),
          "--file",
          join(root, "last.ts"),
        ]),
      ).toMatchObject({
        code: 4,
        diagnosticState: "inconclusive",
        coverage: { requestedFiles: 3, confirmedFiles: 1 },
        items: [expect.objectContaining({ code: "fixture-error" })],
      });
    },
    { PI_COFFEE_FAKE_LSP_SILENT_FILE: "1" },
  );
});

it('rejects an oversized caller timeout before applying the internal queue budget',async()=>{
  await fixture(async q=>{expect(await q('symbols',['--timeout-ms','70000'])).toMatchObject({code:2,issues:[expect.objectContaining({code:'invalid_arguments'})]});});
});
