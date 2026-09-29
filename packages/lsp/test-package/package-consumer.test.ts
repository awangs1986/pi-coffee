import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("installs the LSP-only tarball and uses its public helpers and real CLI", () => {
  const consumer = mkdtempSync(join(tmpdir(), "coffee-lsp-package-"));
  try {
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", consumer], { encoding: "utf8" }));
    const files = pack.files.map((file: { path: string }) => file.path);
    expect(files).toEqual(expect.arrayContaining([
      "dist/src/runtime.js", "dist/src/runtime.d.ts", "dist/src/lsp/bin.js",
      "dist/src/extension/index.js", "dist/bin/coffee-lsp", "dist/skills/lsp/SKILL.md",
      "dist/third_party/oh-my-pi/LICENSE", "dist/third_party/oh-my-pi/README.md",
    ]));
    expect(files.filter((path: string) => /(^|\/)(host|web|harness|subagents|context|relay)(\/|$)/.test(path))).toEqual([]);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", join(consumer, pack.filename), "typescript@5.9.3"], { cwd: consumer, stdio: "pipe", timeout: 120000 });
    const manifest = JSON.parse(readFileSync(join(consumer, "node_modules/pi-coffee-lsp/package.json"), "utf8"));
    expect(execFileSync(process.execPath, [join(consumer, "node_modules/pi-coffee-lsp/dist/src/lsp/bin.js"), "--version"], { cwd: consumer, encoding: "utf8" }).trim()).toBe(`pi-coffee-lsp ${manifest.version}`);
    // Standard Pi package: `pi` manifest, gallery keyword, host packages only as peers.
    expect(manifest.pi).toEqual({ extensions: ["./dist/src/extension/index.js"], skills: ["./dist/skills/lsp"] });
    expect(manifest.keywords).toEqual(expect.arrayContaining(["pi-package", "pi-extension"]));
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["pyright", "typescript-language-server"]);
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@earendil-works/pi-coding-agent", "typebox"]);
    expect(existsSync(join(consumer, "node_modules/@earendil-works"))).toBe(false);
    expect(manifest.private).toBeUndefined();
    writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["app.ts"] }));
    writeFileSync(join(consumer, "app.ts"), "export const value: number = 'wrong';\n");
    const script = `
      import assert from 'node:assert/strict';
      import { execFileSync } from 'node:child_process';
      import { existsSync, readFileSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { resolvePiSkills, withCoffeeLspPath, stopLspDaemon } from 'pi-coffee-lsp';
      const env = {...process.env, ...withCoffeeLspPath(process.env), PI_COFFEE_ROOT_SESSION: process.cwd()};
      const skills = resolvePiSkills(env);
      assert.equal(skills.length, 1);
      assert.ok(existsSync(join(skills[0], 'SKILL.md')));
      const q = operation => JSON.parse(execFileSync('coffee-lsp', [operation, '--file', 'app.ts', '--timeout-ms', '15000'], {env, encoding:'utf8', timeout:20000}));
      try {
        assert.equal(q('status').server.state, 'available');
        assert.ok(q('symbols').items.length);
        assert.equal(q('diagnostics').diagnosticState, 'findings');
        writeFileSync('app.ts', 'export const value: number = 42;\\n');
        assert.equal(q('diagnostics').diagnosticState, 'clean');
        writeFileSync('app.ts', 'export const value: number = 43;\\n');
        const clean = q('diagnostics');
        assert.equal(clean.diagnosticState, 'clean');
        assert.equal(clean.coverage.confirmedFiles, 1);
      } finally { await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION, env); }
    `;
    writeFileSync(join(consumer, "check.mjs"), script);
    execFileSync(process.execPath, ["check.mjs"], { cwd: consumer, stdio: "pipe", timeout: 65000 });
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}, 180000);
