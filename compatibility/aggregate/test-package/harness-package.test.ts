import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("packs Harness independently without bundled optional engines or private package imports", () => {
  const cwd = "packages/pi-coffee-harness";
  const manifest = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
  expect(manifest.name).toBe("pi-coffee-harness");
  expect(manifest.pi.extensions).toEqual(["./dist/harness/extension.js"]);
  expect(Object.keys(manifest.dependencies)).toEqual(["typebox"]);
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd, encoding: "utf8" }));
  const files: string[] = pack.files.map((file: { path: string }) => file.path);
  expect(files).toContain("dist/harness/prompts/software-development.md");
  expect(files).toContain("dist/harness/public.d.ts");
  expect(files.some(path => /\/(host|lsp|context|subagents)\//.test(path))).toBe(false);
  for (const file of files.filter(path => path.endsWith(".js"))) {
    const code = readFileSync(`${cwd}/${file}`, "utf8");
    expect(code).not.toMatch(/from ["'](?:pi-coffee|pi-web-access|pi-subagents|pi-coffee-lsp)\//);
    expect(code).not.toMatch(/createJiti|createRequire/);
  }
});
