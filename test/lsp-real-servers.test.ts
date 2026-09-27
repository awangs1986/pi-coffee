import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCoffeeLsp } from "../src/lsp/cli.js";

describe("coffee-lsp real server profiles", () => {
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
