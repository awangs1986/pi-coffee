import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("ships installable Pi runtime entries and Skills without Host or Web implementation", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { encoding: "utf8" }));
  const files = pack.files.map((file: { path: string }) => file.path) as string[];
  expect(pack.name).toBe("pi-coffee");
  expect(files).toEqual(expect.arrayContaining([
    "dist/src/runtime.js", "dist/src/runtime.d.ts", "dist/src/pi-extension.js",
    "dist/src/harness/prompts/software-development.md", "dist/src/subagents/launch.py",
    "dist/bin/coffee-lsp", "dist/skills/lsp/SKILL.md",
    "dist/third_party/oh-my-pi/LICENSE", "dist/third_party/oh-my-pi/README.md",
  ]));
  expect(files.filter(path => /(^|\/)(host|web|relay|public|deploy)(\/|$)/.test(path))).toEqual([]);
  for (const path of ["src/host", "src/web", "src/relay", "public", "src/main.ts"]) {
    expect(existsSync(resolve(path)), path).toBe(false);
  }
});
