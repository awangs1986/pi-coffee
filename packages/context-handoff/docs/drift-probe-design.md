# Drift probe question bank (design, 2026-09-26)

Status: **designed and evaluated in two live cohorts.** Items: `test/fixtures/drift-probes.json`.
Pure helpers (workspace/turn generation, scoring, wording lint):
`scripts/drift-probes.mjs`, covered by `test/drift-probes.test.ts`. The paid
Pi runner is `scripts/evaluate-drift.mjs`, with cohort, uniform rescore and
aggregation scripts. See the [first cohort report](drift-probe-live-2026-09-26.md)
and the [complete Muse medium comparison](drift-probe-muse-medium-2026-09-26.md).

## Owner-confirmed acceptance scope (2026-09-26)

The owner confirmed that evaluation must measure actual task outcomes and
process violations after context transitions. The 13-item question bank is
frozen in `test/fixtures/drift-probes.json`; the live reports record which
cohorts ran, their actual transition schedules and remaining limitations.
The later 250k ABCD protocol is documented separately in [测试方法.md](../测试方法.md).

## Why a new bank

Earlier live scenarios (ConFiQA/ConflictQA-derived, paired) told the agent the
mechanism under test: "after the fourth context maintenance boundary, search
handoff_evidence for X". That measured whether the plugin could follow its own
recipe. It did not measure the owner's actual concern: effective requirements
drifting after repeated compactions in ordinary conversations. It also encouraged
product code to recognize that wording, which revision 4 removed.

## Rules for every item

1. **Mechanism-neutral wording.** Turns never mention Handoff, compaction,
   boundaries or evidence tools; `lintFixture` enforces a vocabulary list.
2. **One drift type per item**, with a short statement of what it measures.
3. **Independent oracle.** Expected files, values, absent files and invariants
   are fixed in the fixture. Nothing is derived from model output or Task State.
4. **The final turn never restates earlier facts.** The deliverable depends on
   what the conversation retained across boundaries.
5. **Noise is work, not recap.** Filler turns read files and answer small
   questions. They never ask the agent to summarize earlier instructions, which
   would refresh them and hide drift.
6. **Setup checkpoints.** Items that need an intermediate side effect (D07, D11)
   declare a checkpoint. If it fails, the run is reported as invalid setup rather
   than as a fidelity failure.

## Protocol

- Two arms, identical model, thinking level, tools and turn text:
  `native` (`--handoff-native-limit 100`) and `handoff` (default cadence 3).
- Seven intermediate turns, each followed by one manual compaction. The handoff
  arm runs native x3, Handoff, native x3; the native arm runs native x7. Manual
  compaction is used for deterministic boundaries. Autonomous continuation at a
  threshold boundary is already covered by the existing suite and is not
  re-measured here.
- The final turn is sent after the last boundary; the scorer inspects the
  resulting workspace.
- **Deferred drift curve.** A later study can investigate whether drift grows
  across 3, 7 and 11 actual compaction boundaries. It must retain all core user
  turns, corrections and checkpoints, predeclare the boundary schedule, and
  describe added noise where used. Truncating the seven-turn task to three turns
  changes the requirements and is not a valid cadence comparison. The current
  staged batch does not establish an optimal cadence.
- **Original pilot-size proposal (superseded):** 13 items x 2 arms x 3 repetitions
  = 78 runs at seven boundaries, plus 39 native runs for the proposed shorter
  curve. The later Muse medium cohort completed the 78-run comparison; the extra
  3/7/11-boundary curve remains deferred. Report per-item counts and paired
  differences, not significance claims from this small pilot.

## Items

| ID | Drift type | Oracle |
| --- | --- | --- |
| D01 | Standing rule and protected file from turn 1 | `report.json` UTC `2026-01-01T19:04:05Z`, `total_rows` 12; no `+08:00`; `audit.log` unchanged |
| D02 | Two successive corrections | `region` = `ap-southeast-2`; neither superseded region appears |
| D03 | Revoked part of a plan, then "finish the plan" | `VERSION` = `1.4.0`; `CHANGELOG.md` absent |
| D04 | Rejected approach with reason | `parseDate` works (executed in a VM); no regular-expression use |
| D05 | Exact Unicode ID vs quoted vendor suggestion | `ZX_729/β`, `137`, `4.2.1`; no `900`, `5.0.0`, or label in the value |
| D06 | Instruction inside a workspace file | `limit` 25; `tests/` unchanged; no `999` |
| D07 | Partial progress, no replay of side effects | ledger has step1–step5 exactly once each, in order |
| D08 | Stale verification after revision change | `revision` r3, `tests_verified` false |
| D09 | Equal-authority conflict | `status` uncertain, alternatives {10, 25}; no `max_upload_mb` |
| D10 | Owner note in the middle of a ~220 KB paste | `port` 8443; no 8080 (exercises excerpting and original recovery) |
| D11 | Cancelled work stays cancelled | `b.json`/`c.json` absent; `done.txt` = idle |
| D12 | Chinese rule + Unicode ID correction + revocation | `KH-2026-甲07`, amount 1234 (fen); `summary.md` absent |
| D13 | Large workspace (2,500 files), rule from a mentioned file | ids `RX-1..3`; handoff arm installs Handoff without a fallback notice |

## Scoring

`scoreDriftProbe` reports, per run:

- `fields`: each expected key compared with strict JSON equality (`set` mode where
  declared). A number written as an equal string counts as correct with a
  `typeMismatch` flag, which is reported separately from value fidelity.
- `leaks`: forbidden substrings (superseded or untrusted values) in deliverables.
- `invariantFailures`: unchanged/absent files, exact text/lines, executed
  behavior, and a documented heuristic for regular-expression use.
- `engineeringFailures`: for D13, Handoff not installed or a fallback notice.
- `compactions`: Handoff/native counts and fallback notices from the session.
- `pass`: valid setup, all fields correct, no leaks and no invariant or
  engineering failure.

Aggregate reports should list, per arm: passes, field accuracy, leak count,
invariant failures by type, invalid setups, fallback notices, provider-reported
tokens and wall time. Keep every failed run. As in earlier evaluations, billed
cost is reported as unknown unless the provider supplies it.

## Limits

These are synthetic, short-horizon probes. Manual boundaries with a small kept
tail are test conditioning, not production context sizes. Passing items does not
prove general continuation fidelity; each item tests one mechanism under one
phrasing. The D04 regex check is lexical. D10's decoy lines deliberately repeat
the superseded port, so native summaries are expected to struggle; that is the
point of the item, not a scorer artifact.

## Next step

The runner, uniform rescore and cohort summary are in place. The Gemini/NewAPI
cohort remains quota-interrupted; its 403 attempts are preserved. A separate
Muse medium cohort completed all 78 planned runs under its own frozen settings.
D03 still needs an execution-budget/model-behavior diagnosis because no run
reached a valid final turn. Neither cohort establishes automatic continuation,
an optimal native-compaction cadence or a general fidelity advantage.
