import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each([
  "evaluate-live", "evaluate-paired", "evaluate-drift", "evaluate-abcd",
  "evaluate-confiqa", "evaluate-conflictqa", "evaluate-followup", "evaluate-conflictqa-followup",
])(
  "%s rejects its obsolete cadence contract before starting a model evaluation",
  (script) => {
    const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], {
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: process.env.PATH, PI_OFFLINE: "1" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Historical cadence evaluator");
    expect(result.stderr).toContain("Host-owned Handoff");
  },
);
