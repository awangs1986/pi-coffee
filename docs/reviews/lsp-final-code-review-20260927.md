# Final LSP code review and corrections, 2026-09-27

Reviewed `git diff 1c9b31a...e5bb700` in the Pi-only repository, with
`docs/spec/lsp-middle-layer.md`, HARNESS-P3/P4 in Issue #67, `AGENTS.md`,
and the OMP provenance notice as the contract. Standards and Spec were reviewed
independently; a separate security pass checked the local socket, process,
configuration and protocol boundaries. Corrections below are local working-tree
changes on top of `e5bb700`; they have not been published or deployed.

## Standards

**One P2 correctness finding, repaired.** Snapshot source matching was
case-sensitive even though profile routing accepts uppercase extensions.
An uppercase C++ header was absent from fingerprints and watched-file updates,
allowing stale warm-server results and missing a concurrent-edit rejection.
Both snapshot filters now match extensions case-insensitively. Public CLI tests
cover creation, modification and deletion on one reused server, plus a dependency
edit after the semantic request has started. Both tests failed before the fix.
Independent re-review found those tests protect the observed failure.

No separate documented-standard violation or actionable smell finding was raised.

## Spec

**Two P2 implementation findings, repaired; one P2 acceptance gap remains.**

- Initialization crashes were cached for three minutes, although the current
  contract only permits backoff for deterministic initialization failures and
  requires a subsequent read-only query to recover after a crash. The client
  now distinguishes process exit and broken writable transport so the pool
  permits a fresh attempt. The CLI
  regression kills the server during initialization, observes failure, then
  requires successful restart and two recorded starts. Existing deterministic
  initialization-rejection and shortened-deadline regressions remain required.
  Re-review exposed an additional ordering within the same defect: `EPIPE` can
  arrive before process exit and become the cached error. A second CLI regression
  closes the server's input during initialization, verifies the transport error,
  and requires the next query to launch the healthy replacement. It also failed
  before the transport-error correction.
- C++ root discovery omitted `build/compile_commands.json`, despite accepting
  it as a valid prerequisite and tracking it for configuration changes. Discovery
  now selects the nearest project with that database. The CLI regression invokes
  a nested project from its outer directory and verifies the server's working
  directory through its semantic response. It failed with missing configuration
  before the fix.
- Autonomous model acceptance remains unclosed. The historical strict result
  is 0/9, versus the SPEC requirement of at least 2/3 successful autonomous
  sessions per semantic scenario. The final directed model replay demonstrates
  explicitly requested LSP use, not autonomous discovery. No natural-goal model
  sessions were rerun for these code corrections, and no prompting or framework
  changes were introduced to alter that score.

No OMP Agent/TUI/mux, Host/Web, or editor-mutation scope was added. Pi remains
0.87.1.

## Security

No new actionable security finding: block 0, fix-before-ship 0, note 0.
The review checked secrets, socket permissions, workspace bounds, argv-based
process creation, bounded protocol framing, read-only rejection of server edits,
and dependency changes. This is a local same-user tool, not a sandbox for hostile
language servers.

## Verification evidence

Local sanitized logs are under `/tmp/verify-20260927-omp-port/`:

| Check | Result | Artifact |
| --- | --- | --- |
| Uppercase-source regressions before repair | 2 expected failures | `review-source-case-red.log` |
| Nested C++ root before repair | Expected failure, exit 3 | `review-cpp-root-red.log` |
| Initialization crash before repair | Expected failure, retry exits 5 | `review-init-crash-red.log` |
| Initialization broken pipe before repair | Expected failure, retry repeats transport error | `review-init-pipe-red.log` |
| Targeted CLI regressions after repair | 56 passed | `review-targeted-final.log` |
| Complete build, runtime and package checks | 164 runtime tests + 1 package test passed | `review-complete-check.log` |
| Real C++ seven-operation and saved-repair probe | Passed, including independent compiler check | `review-cpp-real.json` |
| Real TypeScript crash, cancellation, reuse and shutdown | Passed | `review-lifecycle-real.json` |

These temporary paths are local evidence, not durable CI artifacts. Existing
six-family, fresh-clone and packed-consumer evidence applies to the earlier
revisions explicitly named in [the port report](omp-lsp-port-20260927.md).
The package test above validates this working-tree build; no new fresh-clone
release acceptance or publication is claimed.

An intermediate complete check caught two new report phrases under the existing
documentation vocabulary gate. The prose and log citation were corrected before
the final check; no runtime failure was involved. Independent re-review also
confirmed both transport-error paths preserve retry and deterministic backoff.

## Remaining model acceptance procedure

The existing temporary `model-acceptance.mjs` harness must not be rerun unchanged:
it targets the old port worktree and skips scenario IDs already in its report.
A follow-up must target the final candidate, use a fresh evidence directory and
record its source identity. Preserve the natural task prompts and run three
sessions each for cross-file repair, impact analysis and signature repair, plus
the documentation control, with the requested Muse model and high thinking.
Preserve provider failures separately from valid model outcomes.

Before judging success, improve sanitized observation of Skill reads,
model-initiated project checks, CLI `items`, diagnostic freshness/coverage and
the final claim. Harness-initiated `tsc` and merely calling diagnostics cannot
establish that the model completed the required validation. Keep autonomous use
rate and strict end-to-end pass rate separate; directed controls cannot close
the autonomous criterion.

`docs/agents/issue-tracker.md` is absent. `/setup-matt-pocock-skills` can record
the tracker workflow later; the known Issue and checked-in SPEC were sufficient
for this review.

Final axis totals: Standards 1 repaired; Spec 2 implementation defects repaired,
1 acceptance gap open. The remaining Spec gap is autonomous model acceptance.
