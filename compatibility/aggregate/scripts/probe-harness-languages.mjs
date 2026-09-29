import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { execFileSync, execFile } from "node:child_process";
import assert from "node:assert/strict";
import { promisify } from "node:util";
const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../dist/src/lsp/bin.js");
import { stopLspDaemon } from "../dist/src/lsp/transport.js";
import { createLanguageFixture } from "./harness-language-fixtures.mjs";

const report = [];
for (const language of (
  process.env.COFFEE_PROBE_LANGUAGES || "typescript,python,csharp,cpp,rust,go"
).split(",")) {
  const root = mkdtempSync(join(tmpdir(), `coffee-real-${language}-`));
  const fixture = createLanguageFixture(language, root);
  const env = {
    ...process.env,
    PI_COFFEE_ROOT_SESSION: `probe-${language}-${Date.now()}`,
  };
  const results = [];
  async function query(operation, file = fixture.file, position) {
    const args = [
      operation,
      "--file",
      file,
      "--workspace",
      root,
      "--timeout-ms",
      "30000",
      ...(position
        ? ["--line", String(position[0]), "--column", String(position[1])]
        : []),
    ];
    let code = 0,
      stdout,
      stderr;
    try {
      ({ stdout, stderr } = await exec(process.execPath, [cli, ...args], {
        cwd: root,
        env,
        timeout: 40000,
      }));
    } catch (error) {
      ({ stdout, stderr } = error);
      code = error.code;
      if (!stdout) throw error;
    }
    const value = JSON.parse(stdout);
    results.push({ args, code, stderr, ...value });
    console.log(
      language,
      operation,
      code,
      JSON.stringify(value.items ?? value.issues).slice(0, 800),
    );
    return value;
  }
  try {
    assert.equal((await query("status")).server.state, "available");
    assert.ok((await query("symbols")).items.length > 0);
    assert.equal(
      (await query("hover", fixture.file, [999, 999])).issues[0].code,
      "invalid_arguments",
    );
    const before = await query("diagnostics");
    assert.equal(before.diagnosticState, "findings");
    const definition = await query(
      "definition",
      fixture.file,
      fixture.definition,
    );
    assert.ok(
      definition.items.some((item) => basename(item.path) === fixture.library),
    );
    const hover = await query("hover", fixture.file, fixture.definition);
    assert.ok(hover.items.some((item) => item.text.includes(fixture.symbol)));
    const refs = await query("references", fixture.file, fixture.definition);
    assert.ok(refs.items.length > 0);
    if (fixture.implementation) {
      const p = fixture.implementation;
      const impl = await query("implementation", p.file, [p.line, p.column]);
      if (p.unsupported)
        assert.equal(impl.issues[0].code, "unsupported_operation");
      else assert.ok(impl.items.length > 0);
    }
    let failed = false;
    try {
      execFileSync(fixture.check[0], fixture.check[1], {
        cwd: root,
        env,
        timeout: 90000,
        stdio: "pipe",
      });
    } catch (error) {
      assert.equal(typeof error.status, "number");
      failed = error.status !== 0;
    }
    assert.equal(
      failed,
      true,
      "the independent project check must reject the bad fixture",
    );
    writeFileSync(fixture.file, fixture.good);
    const after = await query("diagnostics");
    assert.equal(after.diagnosticState, "clean");
    execFileSync(fixture.check[0], fixture.check[1], {
      cwd: root,
      env,
      timeout: 90000,
      stdio: "pipe",
    });
    report.push({
      language,
      ok: true,
      independentCheck: fixture.check,
      results,
    });
  } catch (error) {
    report.push({ language, ok: false, error: error.message, results });
    process.exitCode = 1;
  } finally {
    await stopLspDaemon(env.PI_COFFEE_ROOT_SESSION, env);
    rmSync(root, { recursive: true, force: true });
  }
}
writeFileSync(
  process.env.COFFEE_PROBE_REPORT || "/tmp/coffee-language-probe.json",
  JSON.stringify(report, null, 2),
);
