import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("packs Harness independently without bundled optional engines or private package imports", () => {
  const cwd = ".";
  const manifest = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
  expect(manifest.name).toBe("pi-coffee-harness");
  expect(manifest.pi.extensions).toContain("./dist/harness/extension.js");
  expect(manifest.pi.extensions).toContain("./dist/harness/integration.js");
  expect(Object.keys(manifest.dependencies)).toEqual(["js-tiktoken"]);
  expect(manifest.peerDependencies.typebox).toBe("*");
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd, encoding: "utf8" }));
  const files: string[] = pack.files.map((file: { path: string }) => file.path);
  expect(files).toContain("dist/harness/prompts/software-development.md");
  expect(files).toContain("dist/harness/prompts/subagents.md");
  expect(files).toContain("dist/harness/prompts/recall-folded.md");
  expect(files).toContain("dist/harness/prompts/lsp.md");
  expect(files).toContain("dist/harness/public.d.ts");
  expect(files.some(path => /\/(host|lsp|subagents)\//.test(path))).toBe(false);
  for (const file of files.filter(path => path.endsWith(".js"))) {
    const code = readFileSync(`${cwd}/${file}`, "utf8");
    expect(code).not.toMatch(/from ["'](?:pi-coffee|pi-web-access|pi-subagents|pi-coffee-lsp)\//);
    expect(code).not.toMatch(/createJiti|createRequire/);
  }
});
