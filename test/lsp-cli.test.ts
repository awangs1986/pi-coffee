import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stopLspDaemon, lspDaemonSocket } from "../src/lsp/transport.js";
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
      const status = await invoke(
        ["status", "--file", source, "--workspace", root],
        root,
        env,
      );
      expect(status.code).toBe(0);
      expect(status.json).toMatchObject({
        schemaVersion: 1,
        operation: "status",
        status: "ok",
        server: { id: "typescript", state: "available" },
      });

      const symbols = await invoke(
        ["symbols", "--file", source, "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(symbols.json.items).toEqual([
        expect.objectContaining({
          name: "target",
          location: expect.objectContaining({ line: 1, column: 17 }),
        }),
      ]);

      const definition = await invoke(
        [
          "definition",
          "--file",
          source,
          "--line",
          "2",
          "--column",
          "15",
          "--workspace",
          root,
          "--no-daemon",
        ],
        root,
        env,
      );
      expect(definition.json.items).toEqual([
        expect.objectContaining({
          path: source,
          location: expect.objectContaining({ line: 1, column: 17 }),
        }),
      ]);

      const references = await invoke(
        [
          "references",
          "--file",
          source,
          "--line",
          "1",
          "--column",
          "17",
          "--workspace",
          root,
          "--no-daemon",
        ],
        root,
        env,
      );
      expect(references.json.items).toEqual([
        expect.objectContaining({
          path: source,
          location: expect.objectContaining({ line: 2, column: 7 }),
        }),
      ]);

      const hover = await invoke(
        [
          "hover",
          "--file",
          source,
          "--line",
          "1",
          "--column",
          "17",
          "--workspace",
          root,
          "--no-daemon",
        ],
        root,
        env,
      );
      expect(hover.json.items).toEqual([
        expect.objectContaining({ text: "const target: number" }),
      ]);

      const oldHash = symbols.json.items[0].sha256;
      writeFileSync(source, `${readFileSync(source, "utf8")}\n`);
      const stale = await invoke(
        [
          "hover",
          "--file",
          source,
          "--line",
          "1",
          "--column",
          "17",
          "--workspace",
          root,
          "--expect-sha256",
          oldHash,
          "--no-daemon",
        ],
        root,
        env,
      );
      expect(stale).toMatchObject({
        code: 4,
        json: { status: "partial", issues: [{ code: "stale_position" }] },
      });

      const before = await invoke(
        ["diagnostics", "--file", source, "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(before.code).toBe(0);
      expect(before.json).toMatchObject({
        status: "ok",
        diagnosticState: "findings",
        coverage: { requestedFiles: 1, confirmedFiles: 1 },
      });
      expect(before.json.items).toEqual([
        expect.objectContaining({ code: "fixture-error", path: source }),
      ]);

      writeFileSync(
        source,
        readFileSync(source, "utf8").replace("BAD", "target"),
      );
      const after = await invoke(
        ["diagnostics", "--file", source, "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(after.code).toBe(0);
      expect(after.json).toMatchObject({
        status: "ok",
        diagnosticState: "clean",
        coverage: { confirmedFiles: 1 },
      });
      expect(after.json.items).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("finds an interface implementation through the public CLI", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-implementation-"));
    const file = join(root, "app.ts");
    writeFileSync(file, "export function target() {}\n");
    try {
      const result = await invoke(
        [
          "implementation",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "17",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 0,
        json: {
          operation: "implementation",
          items: [
            expect.objectContaining({
              path: file,
              location: expect.objectContaining({ line: 1, column: 17 }),
            }),
          ],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers from server startup noise without losing a valid semantic response", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-noise-"));
    const file = join(root, "app.ts");
    writeFileSync(file, "export const target = 1;\n");
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "17",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_NOISE: "1",
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 0,
        json: {
          items: [expect.objectContaining({ text: "const target: number" })],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("explicitly declines a server-initiated edit while answering a semantic query", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-readonly-"));
    const file = join(root, "app.ts");
    writeFileSync(file, "export const target = 1;\n");
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "17",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_APPLY: "1",
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 0,
        json: {
          items: [expect.objectContaining({ text: "server edit declined" })],
        },
      });
      expect(readFileSync(file, "utf8")).toBe("export const target = 1;\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cancels a timed-out request before closing the language server", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-cancel-"));
    const file = join(root, "app.ts");
    const record = join(root, "cancelled");
    writeFileSync(file, "const target = 1;\n");
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
          "--timeout-ms",
          "150",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_CANCEL: record,
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 4,
        json: { issues: [{ code: "request_timeout" }] },
      });
      expect(existsSync(record)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reaps a server that never completes initialization", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-init-"));
    const file = join(root, "app.ts");
    const record = join(root, "pid");
    writeFileSync(file, "const target = 1;\n");
    let pid: number | undefined;
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
          "--timeout-ms",
          "150",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_INIT_HANG: record,
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result.code).toBe(4);
      pid = Number(readFileSync(record, "utf8"));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid!, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 2500 },
        )
        .toBe(false);
    } finally {
      if (pid) {
        try {
          process.kill(pid);
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an active daemon request alive beyond the idle timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-busy-"));
    const file = join(root, "app.ts");
    writeFileSync(file, "const target = 1;\n");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: root,
      PI_COFFEE_LSP_IDLE_MS: "100",
      PI_COFFEE_FAKE_LSP_DELAY: "500",
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    try {
      const execution = await promisify(execFile)(
        process.execPath,
        [
          resolve("dist/src/lsp/bin.js"),
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
        ],
        { cwd: root, env },
      );
      const result = { code: 0, json: JSON.parse(execution.stdout) };
      expect(result).toMatchObject({
        code: 0,
        json: {
          items: [expect.objectContaining({ text: "const target: number" })],
        },
      });
    } finally {
      await stopLspDaemon(root, env).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes a warm project's semantic state after a dependency changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-refresh-"));
    const file = join(root, "app.ts");
    const dependency = join(root, "lib.ts");
    const starts = join(root, "starts");
    writeFileSync(file, "const target = 1;\n");
    writeFileSync(dependency, "export const value = 1;\n");
    writeFileSync(starts, "");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: root,
      PI_COFFEE_FAKE_LSP_STARTS: starts,
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    try {
      const query = () =>
        promisify(execFile)(
          process.execPath,
          [
            resolve("dist/src/lsp/bin.js"),
            "hover",
            "--file",
            file,
            "--line",
            "1",
            "--column",
            "7",
          ],
          { cwd: root, env },
        );
      await query();
      writeFileSync(dependency, "export const value = 'changed';\n");
      await query();
      expect(readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(1);
    } finally {
      await stopLspDaemon(root, env).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not claim C++ diagnostics without a compilation context", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-no-project-"));
    const file = join(root, "main.cpp");
    writeFileSync(file, "int main() {}\n");
    try {
      const result = await invoke(
        ["diagnostics", "--file", file, "--no-daemon"],
        root,
        {
          ...process.env,
          PI_COFFEE_CPP_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 3,
        json: {
          status: "unavailable",
          issues: [{ code: "project_configuration_missing" }],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cancels only the caller's in-flight query", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-abort-"));
    const file = join(root, "app.ts"),
      record = join(root, "cancelled");
    writeFileSync(file, "const target = 1;\n");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    try {
      let output = "";
      const code = await runCoffeeLsp(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
          "--timeout-ms",
          "1500",
          "--no-daemon",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            PI_COFFEE_FAKE_LSP_CANCEL: record,
            PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
              process.execPath,
              resolve("test/fixtures/fake-lsp-server.mjs"),
            ]),
          },
          signal: controller.signal,
          stdout: (text) => (output += text),
          stderr: () => {},
        },
      );
      expect(code).toBe(4);
      expect(JSON.parse(output).issues[0].code).toBe("request_cancelled");
      expect(Date.now() - started).toBeLessThan(1200);
      expect(existsSync(record)).toBe(true);
    } finally {
      clearTimeout(timer);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("delivers project settings to server configuration requests", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-settings-"));
    const file = join(root, "app.ts");
    writeFileSync(file, "const target = 1;\n");
    writeFileSync(
      join(root, "coffee-lsp.json"),
      JSON.stringify({
        typescript: { settings: { fixture: { target: "custom-target" } } },
      }),
    );
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_SETTINGS: "1",
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result.json.items[0].text).toBe("custom-target");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a diagnostic batch spanning different language projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-mixed-"));
    const ts = join(root, "app.ts"),
      py = join(root, "app.py");
    writeFileSync(ts, "const target = 1;\n");
    writeFileSync(py, "target = 1\n");
    try {
      const result = await invoke(
        ["diagnostics", "--file", ts, "--file", py, "--no-daemon"],
        root,
        {
          ...process.env,
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 2,
        json: { issues: [{ code: "invalid_arguments" }] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers a warm query after its server exits", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-crash-"));
    const file = join(root, "app.ts"),
      record = join(root, "pid");
    writeFileSync(file, "const target = 1;\n");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: root,
      PI_COFFEE_FAKE_LSP_PID: record,
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    try {
      const query = () =>
        promisify(execFile)(
          process.execPath,
          [
            resolve("dist/src/lsp/bin.js"),
            "hover",
            "--file",
            file,
            "--line",
            "1",
            "--column",
            "7",
          ],
          { cwd: root, env },
        );
      await query();
      process.kill(Number(readFileSync(record, "utf8")), "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(JSON.parse((await query()).stdout).items[0].text).toBe(
        "const target: number",
      );
    } finally {
      await stopLspDaemon(root, env).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an ambiguous C# solution unless a backend solution is explicitly selected", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-ambiguous-"));
    const file = join(root, "Program.cs");
    writeFileSync(file, "class Program {}\n");
    writeFileSync(join(root, "One.sln"), "");
    writeFileSync(join(root, "Two.sln"), "");
    try {
      const result = await invoke(
        ["symbols", "--file", file, "--no-daemon"],
        root,
        {
          ...process.env,
          PI_COFFEE_CSHARP_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 3,
        json: { issues: [{ code: "ambiguous_project" }] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers a nested C++ project with only a build compilation database", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-cpp-root-"));
    const project = join(root, "packages/native");
    mkdirSync(join(project, "src"), { recursive: true });
    mkdirSync(join(project, "build"));
    const file = join(project, "src/main.cpp");
    writeFileSync(file, "int target = 1;\n");
    writeFileSync(join(project, "build/compile_commands.json"), "[]");
    writeFileSync(join(project, "lib.hpp"), "nested-project");
    try {
      const result = await invoke(
        ["hover", "--file", file, "--line", "1", "--column", "5", "--no-daemon"],
        root,
        {
          ...process.env,
          PI_COFFEE_CPP_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
          PI_COFFEE_FAKE_LSP_DEPENDENCY: "1",
          PI_COFFEE_FAKE_LSP_DEPENDENCY_FILE: "lib.hpp",
        },
      );
      expect(result).toMatchObject({
        code: 0,
        json: { status: "ok", items: [{ text: "nested-project" }] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks semantic output stale when a dependency changes during the query", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-race-"));
    const file = join(root, "app.ts"),
      dependency = join(root, "lib.ts");
    writeFileSync(file, "const target = 1;\n");
    writeFileSync(dependency, "export const value = 1;");
    const timer = setTimeout(
      () => writeFileSync(dependency, "export const value = 2;"),
      200,
    );
    try {
      const result = await invoke(
        [
          "hover",
          "--file",
          file,
          "--line",
          "1",
          "--column",
          "7",
          "--no-daemon",
        ],
        root,
        {
          ...process.env,
          PI_COFFEE_FAKE_LSP_DELAY: "500",
          PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
            process.execPath,
            resolve("test/fixtures/fake-lsp-server.mjs"),
          ]),
        },
      );
      expect(result).toMatchObject({
        code: 4,
        json: { issues: [{ code: "stale_snapshot" }] },
      });
    } finally {
      clearTimeout(timer);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("starts one daemon when simultaneous callers recover a stale socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-start-"));
    const file = join(root, "app.ts"),
      starts = join(root, "starts");
    writeFileSync(file, "const target = 1;\n");
    writeFileSync(starts, "");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: root,
      PI_COFFEE_FAKE_LSP_STARTS: starts,
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    writeFileSync(lspDaemonSocket(env), "stale");
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          promisify(execFile)(
            process.execPath,
            [
              resolve("dist/src/lsp/bin.js"),
              "hover",
              "--file",
              file,
              "--line",
              "1",
              "--column",
              "7",
            ],
            { cwd: root, env },
          ).catch((error) => {
            throw new Error(
              `${error.message}\n${error.stdout}\n${error.stderr}`,
            );
          }),
        ),
      );
      expect(
        results.every((result) => JSON.parse(result.stdout).status === "ok"),
      ).toBe(true);
      expect(readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(1);
    } finally {
      await stopLspDaemon(root, env).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["csharp", "Program.cs", "App.csproj", "PI_COFFEE_CSHARP_LSP_COMMAND"],
    ["cpp", "main.cpp", "compile_commands.json", "PI_COFFEE_CPP_LSP_COMMAND"],
    ["rust", "lib.rs", "Cargo.toml", "PI_COFFEE_RUST_LSP_COMMAND"],
    ["go", "main.go", "go.mod", "PI_COFFEE_GO_LSP_COMMAND"],
  ])(
    "routes %s to its language project without starting the server for status",
    async (id, name, marker, variable) => {
      const root = mkdtempSync(join(tmpdir(), "coffee-lsp-profile-"));
      const project = join(root, "nested");
      mkdirSync(project);
      const file = join(project, name);
      writeFileSync(file, "");
      writeFileSync(join(project, marker), "");
      try {
        const result = await invoke(
          ["status", "--file", file, "--workspace", root],
          root,
          {
            ...process.env,
            [variable]: JSON.stringify([
              process.execPath,
              resolve("test/fixtures/fake-lsp-server.mjs"),
            ]),
          },
        );
        expect(result).toMatchObject({
          code: 0,
          json: {
            projectRoot: project,
            server: { id, state: "available" },
            capabilityState: "not_negotiated",
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("ships one discoverable Pi skill with the built application", () => {
    const [skill] = resolvePiSkills();
    expect(skill).toMatch(/skills[\\/]lsp$/);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain(
      "coffee-lsp status",
    );
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
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    try {
      const cli = resolve("dist/src/lsp/bin.js");
      for (const operation of ["symbols", "hover"]) {
        const args =
          operation === "hover"
            ? [
                cli,
                operation,
                "--file",
                source,
                "--line",
                "1",
                "--column",
                "14",
                "--workspace",
                root,
              ]
            : [cli, operation, "--file", source, "--workspace", root];
        const output = execFileSync(process.execPath, args, {
          cwd: process.cwd(),
          env,
          encoding: "utf8",
        });
        expect(JSON.parse(output)).toMatchObject({
          status: "ok",
          server: { id: "typescript", state: "ready" },
        });
      }
      for (let index = 0; index < 2; index += 1) {
        const output = execFileSync(
          process.execPath,
          [cli, "diagnostics", "--file", source, "--workspace", root],
          { cwd: process.cwd(), env, encoding: "utf8" },
        );
        expect(JSON.parse(output)).toMatchObject({
          status: "ok",
          diagnosticState: "clean",
        });
      }
      expect(readFileSync(starts, "utf8").trim().split("\n")).toEqual([
        "start",
      ]);
      await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION, env);
      await expect.poll(() => existsSync(lspDaemonSocket(env))).toBe(false);
      await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION, env);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("reports new errors in the other open files after a change, once", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-related-"));
    const app = join(root, "app.ts");
    const lib = join(root, "lib.ts");
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    writeFileSync(app, "export const target = 1;\nconst value = 2;\n");
    writeFileSync(lib, "export const helper = 1;\nconst other = 2;\n");
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      PI_COFFEE_ROOT_SESSION: `related-${process.pid}-${Date.now()}`,
      PI_COFFEE_FAKE_LSP_CASCADE: "1",
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    // The daemon is the built artifact; in-process calls would spawn src/lsp/bin.js.
    const cli = resolve("dist/src/lsp/bin.js");
    const invoke = async (args: string[]) => {
      const run = promisify(execFile)(process.execPath, [cli, ...args], { cwd: root, env });
      const { stdout, code } = await run.then(
        (result) => ({ stdout: result.stdout, code: 0 }),
        (error) => ({ stdout: error.stdout as string, code: error.code as number }),
      );
      return { code, json: JSON.parse(stdout) };
    };
    try {
      // lib.ts joins the open set through a navigation query, like a read does in Pi.
      expect((await invoke(["symbols", "--file", lib, "--workspace", root])).code).toBe(0);
      const alone = await invoke(["diagnostics", "--file", app, "--workspace", root]);
      expect(alone.json).toMatchObject({
        diagnosticState: "clean",
        related: [],
        coverage: { relatedFiles: 1 },
      });

      // Breaking app.ts breaks lib.ts in this fixture; the fallout is reported...
      writeFileSync(app, "export const target = 1;\nconst value = BAD;\n");
      const broken = await invoke(["diagnostics", "--file", app, "--workspace", root]);
      expect(broken.json).toMatchObject({
        diagnosticState: "findings",
        items: [expect.objectContaining({ path: app, code: "fixture-error" })],
        related: [
          expect.objectContaining({
            path: lib,
            code: "fixture-error",
            location: expect.objectContaining({ line: 2, column: 7 }),
          }),
        ],
        coverage: { requestedFiles: 1, confirmedFiles: 1, relatedFiles: 1 },
      });

      // ...and not repeated while it merely persists.
      writeFileSync(app, "export const target = 1;\nconst value = BAD;\nconst more = 3;\n");
      const again = await invoke(["diagnostics", "--file", app, "--workspace", root]);
      expect(again.json).toMatchObject({ diagnosticState: "findings", related: [] });

      // Querying lib.ts directly always lists its current diagnostics.
      const direct = await invoke(["diagnostics", "--file", lib, "--workspace", root]);
      expect(direct.json).toMatchObject({
        diagnosticState: "findings",
        items: [expect.objectContaining({ path: lib })],
        coverage: { relatedFiles: 1 },
      });

      // A one-shot server has no neighbours.
      const single = await invoke([
        "diagnostics",
        "--file",
        app,
        "--workspace",
        root,
        "--no-daemon",
      ]);
      expect(single.json.coverage.relatedFiles).toBe(0);
    } finally {
      await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION, env).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("locates navigation positions by symbol name and refuses oversized documents", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-symbol-"));
    const source = join(root, "app.ts");
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    writeFileSync(
      source,
      "export const target = 1;\nconst value = target + target;\nconst targeted = target;\n",
    );
    const env = {
      ...process.env,
      PI_COFFEE_TS_LSP_COMMAND: JSON.stringify([
        process.execPath,
        resolve("test/fixtures/fake-lsp-server.mjs"),
      ]),
    };
    const base = ["--file", source, "--workspace", root, "--no-daemon"];
    try {
      const first = await invoke(["definition", ...base, "--symbol", "target"], root, env);
      expect(first.json).toMatchObject({ status: "ok", position: { line: 1, column: 14 } });
      // Whole words only: `targeted` on line 3 is never counted.
      const third = await invoke(["hover", ...base, "--symbol", "target#3"], root, env);
      expect(third.json.position).toEqual({ line: 2, column: 24 });
      const onLine = await invoke(
        ["hover", ...base, "--symbol", "target", "--line", "3"],
        root,
        env,
      );
      expect(onLine.json.position).toEqual({ line: 3, column: 18 });
      const fifth = await invoke(["hover", ...base, "--symbol", "target#5"], root, env);
      expect(fifth).toMatchObject({
        code: 2,
        json: { issues: [{ code: "symbol_not_found" }] },
      });
      const missing = await invoke(
        ["hover", ...base, "--symbol", "nowhere", "--line", "2"],
        root,
        env,
      );
      expect(missing.json.issues[0].message).toContain("on line 2");
      const conflicting = await invoke(
        ["hover", ...base, "--symbol", "target", "--column", "3"],
        root,
        env,
      );
      expect(conflicting.json.issues[0]).toMatchObject({ code: "invalid_arguments" });

      const bundle = join(root, "bundle.js");
      writeFileSync(bundle, "x".repeat(2 * 1024 * 1024 + 1));
      const large = await invoke(
        ["diagnostics", "--file", bundle, "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(large).toMatchObject({
        code: 3,
        json: { status: "unavailable", issues: [{ code: "file_too_large" }] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("connects to a TCP language server such as Godot's and explains a closed port", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-tcp-"));
    const script = join(root, "player.gd");
    const ready = join(root, "ready");
    writeFileSync(join(root, "project.godot"), "[application]\n");
    writeFileSync(script, "extends Node\nvar x = BAD\n");
    const port = 20000 + (process.pid % 20000);
    writeFileSync(
      join(root, "coffee-lsp.json"),
      JSON.stringify({ servers: { gdscript: { port } } }),
    );
    const env = { ...process.env };
    const server = spawn(
      process.execPath,
      [resolve("test/fixtures/fake-lsp-server.mjs")],
      {
        env: {
          ...env,
          PI_COFFEE_FAKE_LSP_TCP_PORT: String(port),
          PI_COFFEE_FAKE_LSP_TCP_READY: ready,
        },
        stdio: "ignore",
      },
    );
    try {
      await expect.poll(() => existsSync(ready), { timeout: 5000 }).toBe(true);
      const status = await invoke(["status", "--file", script, "--workspace", root], root, env);
      expect(status.json).toMatchObject({
        status: "ok",
        server: { id: "gdscript", command: `tcp://127.0.0.1:${port}`, source: "tcp" },
      });
      const diagnostics = await invoke(
        ["diagnostics", "--file", script, "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(diagnostics.json).toMatchObject({
        status: "ok",
        server: { id: "gdscript" },
        diagnosticState: "findings",
        items: [expect.objectContaining({ code: "fixture-error", path: script })],
      });
      const listing = await invoke(["servers", "--file", script, "--workspace", root], root, env);
      expect(listing.json.items.find((item: any) => item.id === "gdscript")).toMatchObject({
        status: "available",
        appliesToFile: true,
        source: "tcp",
      });
    } finally {
      server.kill();
      await new Promise((done) => server.once("exit", done));
    }
    try {
      // Nothing listens any more: status says so, queries fail with the hint.
      const closed = await invoke(["status", "--file", script, "--workspace", root], root, env);
      expect(closed).toMatchObject({
        code: 3,
        json: { status: "unavailable", issues: [{ code: "missing_server" }] },
      });
      expect(closed.json.issues[0].message).toContain(`not listening on 127.0.0.1:${port}`);
      const failed = await invoke(
        ["hover", "--file", script, "--symbol", "x", "--workspace", root, "--no-daemon"],
        root,
        env,
      );
      expect(failed).toMatchObject({ code: 5, json: { issues: [{ code: "server_failed" }] } });
      expect(failed.json.issues[0].message).toContain("not reachable at 127.0.0.1");
      expect(failed.json.issues[0].message).toContain("Godot editor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});

async function invoke(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; json: any }> {
  let stdout = "";
  let stderr = "";
  const code = await runCoffeeLsp(args, {
    cwd,
    env,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  expect(stderr).toBe("");
  return { code, json: JSON.parse(stdout) };
}
