import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCoffeeLsp } from "../src/lsp/cli.js";
import { stopLspDaemon } from "../src/lsp/transport.js";
const exec = promisify(execFile);

describe("coffee-lsp real server profiles", () => {
  it("confirms saved clean-to-clean edits and unchanged rewrites on the warm TypeScript server", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-ts-warm-"));
    const source = join(root, "src/app.ts");
    const dependent = join(root, "src/dependent.ts");
    const env = {
      ...process.env,
      PI_COFFEE_ROOT_SESSION: root,
      XDG_RUNTIME_DIR: root,
    };
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: ["src/**/*.ts"],
      }),
    );
    writeFileSync(source, "export const value: number = 1;\n");
    writeFileSync(
      dependent,
      'import { value } from "./app";\nexport const doubled: number = value * 2;\n',
    );
    const query = async (timeoutMs: number, file = source) => {
      const args = [
        fileURLToPath(new URL("../dist/src/lsp/bin.js", import.meta.url)),
        "diagnostics",
        "--file",
        file,
        "--timeout-ms",
        String(timeoutMs),
      ];
      try {
        const { stdout, stderr } = await exec(process.execPath, args, {
          cwd: root,
          env,
        });
        expect(stderr).toBe("");
        return { code: 0, json: JSON.parse(stdout) };
      } catch (error: any) {
        if (!error.stdout) throw error;
        return { code: error.code, json: JSON.parse(error.stdout) };
      }
    };
    try {
      expect(await query(15000)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean" },
      });
      expect(await query(4000, dependent)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
      writeFileSync(source, "export const value: number = 2;\n");
      expect(await query(4000)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
      expect(await query(4000, dependent)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
      writeFileSync(source, 'export const value: string = "wrong";\n');
      expect(await query(4000, dependent)).toMatchObject({
        code: 0,
        json: {
          diagnosticState: "findings",
          items: [expect.objectContaining({ code: 2362 })],
        },
      });
      writeFileSync(source, "export const value: number = 2;\n");
      expect(await query(4000, dependent)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
      writeFileSync(source, "export const value: number = 'wrong';\n");
      expect(await query(4000)).toMatchObject({
        code: 0,
        json: {
          diagnosticState: "findings",
          items: [expect.objectContaining({ code: 2322 })],
        },
      });
      writeFileSync(source, "export const value: number = 3;\n");
      expect(await query(4000)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
      writeFileSync(source, "export const value: number = 3;\n");
      utimesSync(source, new Date(), new Date(Date.now() + 2000));
      expect(await query(3000)).toMatchObject({
        code: 0,
        json: { diagnosticState: "clean", coverage: { confirmedFiles: 1 } },
      });
    } finally {
      await stopLspDaemon(root, env);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("finds and clears a real TypeScript error and honors Unicode code-point columns", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-ts-"));
    const source = join(root, "src/app.ts");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", noEmit: true }, include: ["src/**/*.ts"] }));
    const broken = "const emoji = \"😀\";\nexport function greet(name: string): string { return name; }\nconst result: number = greet(\"world\");\nconsole.log(emoji, result);\n";
    writeFileSync(source, broken);
    try {
      const before = await invoke(["diagnostics", "--file", source, "--timeout-ms", "15000", "--no-daemon"], root);
      expect(before.code).toBe(0);
      expect(before.json).toMatchObject({ projectRoot: root, diagnosticState: "findings" });
      expect(before.json.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2322 })]));

      const line = broken.split("\n")[2];
      const column = Array.from(line.slice(0, line.indexOf("greet"))).length + 1;
      const hover = await invoke(["hover", "--file", source, "--line", "3", "--column", String(column), "--no-daemon"], root);
      expect(hover.json.items[0]?.text).toContain("greet");

      writeFileSync(source, broken.replace("result: number", "result: string"));
      const after = await invoke(["diagnostics", "--file", source, "--timeout-ms", "15000", "--no-daemon"], root);
      expect(after).toMatchObject({ code: 0, json: { diagnosticState: "clean", items: [] } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("uses Pyright for diagnostics and cross-file navigation", async () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-python-"));
    const app = join(root, "app.py");
    const library = join(root, "lib.py");
    writeFileSync(join(root, "pyproject.toml"), "[tool.pyright]\ntypeCheckingMode = \"strict\"\n");
    writeFileSync(library, "def greet(name: str) -> str:\n    return f\"hello {name}\"\n");
    writeFileSync(app, "from lib import greet\nresult: int = greet(\"world\")\n");
    try {
      const diagnostics = await invoke(["diagnostics", "--file", app, "--timeout-ms", "15000", "--no-daemon"], root);
      expect(diagnostics).toMatchObject({ code: 0, json: { server: { id: "python" }, diagnosticState: "findings", items: [expect.objectContaining({ code: "reportAssignmentType" })] } });

      const definition = await invoke(["definition", "--file", app, "--line", "2", "--column", "15", "--timeout-ms", "15000", "--no-daemon"], root);
      expect(basename(definition.json.items[0]?.path ?? "")).toBe("lib.py");

      writeFileSync(app, readFileSync(app, "utf8").replace("result: int", "result: str"));
      const clean = await invoke(["diagnostics", "--file", app, "--timeout-ms", "15000", "--no-daemon"], root);
      expect(clean).toMatchObject({ code: 0, json: { diagnosticState: "clean", items: [] } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

async function invoke(args: string[], cwd: string): Promise<{ code: number; json: any }> {
  let stdout = "";
  let stderr = "";
  const code = await runCoffeeLsp(args, {
    cwd,
    env: process.env,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
  });
  expect(stderr).toBe("");
  return { code, json: JSON.parse(stdout) };
}
