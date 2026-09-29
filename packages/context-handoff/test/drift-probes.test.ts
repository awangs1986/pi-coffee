import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintFixture, materialize, scoreDriftProbe, checkCheckpoint } from "../scripts/drift-probes.mjs";

const fixture = JSON.parse(readFileSync("test/fixtures/drift-probes.json", "utf8"));
const item = (id: string) => fixture.items.find((i: any) => i.id.startsWith(id));
const reader = (files: Record<string, string>) => (path: string) => files[path];
const run = (id: string, outputs: Record<string, string | undefined>, extra: any = {}) => {
  const probe = item(id);
  const { files } = materialize(fixture, probe);
  const final = { ...files, ...outputs };
  for (const [path, value] of Object.entries(outputs)) if (value === undefined) delete final[path];
  return scoreDriftProbe({ item: probe, read: reader(final as Record<string, string>), baseline: files, arm: "handoff", ...extra });
};

describe("drift probe fixture", () => {
  it("is structurally valid and never names the mechanism under test", () => {
    expect(lintFixture(fixture)).toEqual([]);
    expect(fixture.items).toHaveLength(13);
  });

  it("materializes deterministic noise and a long paste with the owner note in the middle", () => {
    const a = materialize(fixture, item("D10"));
    const b = materialize(fixture, item("D10"));
    expect(a.turns).toEqual(b.turns);
    expect(a.turns).toHaveLength(7);
    const paste = a.turns[1];
    expect(Buffer.byteLength(paste)).toBeGreaterThan(150000);
    const at = paste.indexOf("OWNER NOTE");
    expect(at / paste.length).toBeGreaterThan(0.4);
    expect(at / paste.length).toBeLessThan(0.6);
    expect(a.turns.join("\n")).not.toContain("{");
    expect(materialize(fixture, item("D02"), { extraNoise: 4 }).turns).toHaveLength(11);
    expect(Object.keys(materialize(fixture, item("D13")).files).length).toBeGreaterThan(2500);
  });
});

describe("drift probe scoring", () => {
  it("passes exact deliverables and accepts set order where declared", () => {
    expect(run("D02", { "deploy.json": '{"region":"ap-southeast-2"}' }).pass).toBe(true);
    expect(run("D09", { "limits.json": '{"status":"uncertain","alternatives":[25,10],"reason":"sources disagree"}' }))
      .toMatchObject({ pass: true, extraKeys: ["limits.json:reason"] });
    expect(run("D13", { "ids.json": '["RX-1","RX-2","RX-3"]' },
      { entries: [{ type: "compaction", details: { plugin: "pi-handoff" } }] }).pass).toBe(true);
  });

  it("fails superseded values, quoted suggestions and modified protected files", () => {
    const leaked = run("D02", { "deploy.json": '{"region":"eu-west-1"}' });
    expect(leaked.pass).toBe(false);
    expect(leaked.leaks).toEqual([{ file: "deploy.json", value: "eu-west-1" }]);
    const quoted = run("D05", { "record.json": '{"identifier":"ZX_729/β","retry_ms":900,"source_version":"4.2.1"}' });
    expect(quoted.fieldsCorrect).toBe(2);
    expect(quoted.pass).toBe(false);
    const audit = run("D01", { "report.json": '{"generated_at":"2026-01-01T19:04:05Z","total_rows":12}', "audit.log": "edited" });
    expect(audit.invariantFailures).toEqual([{ type: "unchanged", path: "audit.log" }]);
  });

  it("scores value fidelity separately from JSON number/string formatting", () => {
    const result = run("D10", { "service.json": '{"port":"8443"}' });
    expect(result).toMatchObject({ pass: true, typeMismatches: 1 });
  });

  it("checks behavior, rejected approaches, replay and revocation", () => {
    const split = "module.exports={parseDate:s=>{const [y,m,d]=s.split('-').map(Number);return {y,m,d};}};";
    const regex = "module.exports={parseDate:s=>{const [,y,m,d]=s.match(/(\\d+)-(\\d+)-(\\d+)/).map(Number);return {y,m,d};}};";
    expect(run("D04", { "src/date.js": split }).pass).toBe(true);
    expect(run("D04", { "src/date.js": regex }).invariantFailures).toEqual([{ type: "noRegex", path: "src/date.js" }]);
    const ledger = (lines: string[]) => lines.join("\n") + "\n";
    expect(run("D07", { "ledger.txt": ledger(["step1 done", "step2 done", "step3 done", "step4 done", "step5 done"]) }).pass).toBe(true);
    expect(run("D07", { "ledger.txt": ledger(["step1 done", "step2 done", "step3 done", "step3 done", "step4 done", "step5 done"]) }).pass).toBe(false);
    expect(run("D03", { VERSION: "1.4.0\n", "CHANGELOG.md": "## 1.4.0" }).invariantFailures)
      .toEqual([{ type: "absent", path: "CHANGELOG.md" }]);
    expect(run("D11", { "fixtures/a.json": '{"id":"a"}', "done.txt": "idle\n" }).pass).toBe(true);
    expect(run("D12", { "invoice.json": '{"customer_id":"KH-2026-甲07","amount":12.34}' }).pass).toBe(false);
  });

  it("invalidates a run whose setup checkpoint failed and reports engineering failures", () => {
    const probe = item("D07");
    expect(checkCheckpoint(probe.checkpoints[0], reader({ "ledger.txt": "step1 done\nstep2 done\n" }))).toBe(false);
    const invalid = run("D07", { "ledger.txt": "step1 done\nstep2 done\nstep3 done\nstep4 done\nstep5 done\n" },
      { checkpointResults: [false] });
    expect(invalid).toMatchObject({ validSetup: false, pass: false });
    const noHandoff = run("D13", { "ids.json": '["RX-1","RX-2","RX-3"]' }, {
      entries: [{ type: "compaction", details: {} }, { customType: "pi-handoff-error",
        content: "Handoff failed: x. Used one native compaction instead" }],
    });
    expect(noHandoff.engineeringFailures).toEqual(["handoff_not_installed", "fallback_notice"]);
  });
});
