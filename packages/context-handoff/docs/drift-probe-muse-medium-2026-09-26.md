# D01–D13 live Pi comparison: Muse medium (2026-09-26)

Status: **complete for this frozen D01–D13 cohort**. All 78 planned runs (39 pairs) finished. This is a new comparison, not a continuation of the interrupted Gemini cohort.

## Frozen setup

GitHub main commit `63a85b83fe06178a2b2540c0922d3edf20765eb6`, fixture blob `034ac9b8e2a77b6d489e055d4b48d63027ea8ca0`, plugin extension blob `30ff69be46b4fc5be87c716ea49fa41b54d622f3`. Pi 0.87.1 ran in isolated workspaces and sessions. Both arms used CommandCode `meta/muse-spark-1.3-contributor` at `medium`, the same eight tools, the same seven original user turns and final request, and the same manual compaction boundaries. Native targeted `NNNNNNN`; Handoff targeted `NNNHNNN`. Both arms loaded this plugin; the native arm set its Handoff limit to 100. Order was balanced across pairs.

All 78 sessions kept the same session identity. All 3,181 captured requests named the frozen model and `medium`; the saved prompts and answer key remained separated. All required checkpoints passed. Raw synthetic requests, responses, events, file snapshots, scores and saved workspaces are outside Git under the external evaluation artifact directory for this cohort.

## Outcomes

| Measure | Native / 39 | Handoff / 39 |
| --- | ---: | ---: |
| Final task and process correct | 32 | 30 |
| Strict whole-conversation acceptance | 32 | 25 |
| Planned seven-boundary sequence | 37 | 27 |
| Provider-reported input tokens | 7,654,045 | 9,270,400 |
| Provider-reported output tokens | 1,121,092 | 1,411,179 |
| Sum of per-run elapsed time | 3.17 h | 4.10 h |

Eleven Handoff runs used visible native fallback at least once, across 20 boundaries. Five of those runs still delivered a correct final task. The full 39-pair task matrix was 27 both successful, 3 Handoff only, 5 native only, and 4 both failed. This includes budget limits, fallback and incomplete runs; it is not a clean compression-fidelity estimate.

**Twenty-five pairs** met both planned schedules without setup, run, model or provider errors. Of those, 23 succeeded in both arms, **none** succeeded only with Handoff, one succeeded only with native (D06 repetition 3), and one failed in both (D07 repetition 3). Median per-run elapsed time in this subset was 256 seconds native and 313 seconds Handoff. On these 25 pairs, provider-reported input tokens totaled 3,891,927 native and 5,129,017 Handoff. The clean subset shows no fidelity advantage for Handoff on this bank and model; it is too small and synthetic to establish a general disadvantage.

| Item | Native task / 3 | Handoff task / 3 | Native strict / 3 | Handoff strict / 3 |
| --- | ---: | ---: | ---: | ---: |
| D01 | 3 | 3 | 3 | 3 |
| D02 | 1 | 3 | 1 | 1 |
| D03 | 3 | 3 | 3 | 3 |
| D04 | 3 | 3 | 3 | 3 |
| D05 | 3 | 3 | 3 | 1 |
| D06 | 3 | 2 | 3 | 1 |
| D07 | 0 | 0 | 0 | 0 |
| D08 | 3 | 3 | 3 | 3 |
| D09 | 3 | 3 | 3 | 3 |
| D10 | 2 | 1 | 2 | 1 |
| D11 | 2 | 1 | 2 | 1 |
| D12 | 3 | 2 | 3 | 2 |
| D13 | 3 | 3 | 3 | 3 |

## Findings that change the next work

- **D06, repetition 3 is a clean native-only result.** Both arms followed their planned schedules and had no model/provider/run error. Native wrote `config.json` with limit 25 and kept `tests/` intact. Handoff kept `tests/` intact but never wrote `config.json`.
- **D07 failed in every run.** Checkpoints confirmed the first three ordered steps. Native runs ended with only four of five ledger lines; Handoff runs ended with only three. No replay or out-of-order step was seen. This test currently exposes unfinished work, not a measured compression advantage.
- **D10 remains fragile.** Repetition 1 passed in both arms after original-history search/read found port 8443. Repetition 2 native did not deliver; Handoff fell back three times and timed out. Repetition 3 native wrote 8443, while Handoff fell back at all four eligible boundaries and wrote decoy port 8080. The third Handoff run did not install a Handoff, so its wrong value cannot be attributed to an installed Task State.
- **D13 passed all three repetitions in both arms.** Handoff installed at boundary 4 in each 2,500-file workspace. Large-project degradation did not block these runs.
- **Preparation reliability is the largest observed Handoff issue.** Fallback reasons included exact-value quote validation, step target/action validation, invalid supersession, malformed JSON and repair deadlines. The fallback kept sessions running but reduced strict acceptance from 30 correct final tasks to 25 accepted whole conversations.

One D11 Handoff run created `fixtures/b.json` prematurely in turn 1, before the later cancellation, and kept it. It is a process failure, but happened before the would-Handoff boundary and is not evidence that the Handoff caused the action.

## Scoring audit and limits

Uniform rescore version 2 preserved the first runner scores as `score-runner.json`. It corrected unresolved-state notices being counted as native fallback, checked D07/D11 process evidence, and corrected D03 repetition 3: a single `rm -f CHANGELOG.md` in the revocation turn was deletion of a file made before revocation, not a new post-revocation creation. The earlier version-1 aggregate and affected score remain saved outside Git. The D03 prompt said the change log was planned for the end; whether creating it early should be a separate failure needs a **predeclared** future case, not a post-hoc score change.

The driver's initial `progress.json` also marked 74 scored runs as `missing_score` because of a derived-field bug. Its original is preserved as `progress-runner.json`; the current progress file was reconciled from the canonical scores. The aggregate uses scores, not that erroneous field. The driver source has been corrected for future runs.

There were 3,176 HTTP 200 requests, one upstream 520, three locally aborted requests and one local request-budget rejection. Nine requests lacked provider usage; the token totals are reported usage, not a complete bill. Currency cost is unknown. No quota 403 occurred in this cohort.

After the report and scorer correction, `npm run check` passed with the available Node/npm runtime: TypeScript build and 77 tests across seven files. An initial attempt with a runtime lacking `node`/`npm` on `PATH` failed to start Pi test children; it was an environment failure and was rerun successfully.

These manually forced seven-boundary probes do not test automatic threshold triggering, two successive Handoffs, production context size, or automatic continuation without a new user turn. C01–C08 in the acceptance sheet remain separate. The detailed aggregate, audit and per-run evidence are in the external artifact directory.
