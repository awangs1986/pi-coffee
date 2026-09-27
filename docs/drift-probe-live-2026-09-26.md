# D01–D13 live Pi evaluation (2026-09-26)

Status: **partially complete; model-provider quota still blocks repetition 3 after two pair-preserving resume attempts**. This is evidence from the real Pi RPC conversation lifecycle, not a scripted-provider test.

## Fixed inputs and execution

The bank is GitHub main commit `63a85b83fe06178a2b2540c0922d3edf20765eb6`, fixture blob `034ac9b8e2a77b6d489e055d4b48d63027ea8ca0`. Pi 0.87.1 ran each original seven-turn item in a fresh, isolated workspace, compacted after each turn, and sent the original final request. Both arms used NewAPI `gemini-3.8-flash` at `high` with identical tools. The native arm targeted `NNNNNNN`, the Handoff arm `NNNHNNN`. The model could not access future turns or the independent answer key. Raw synthetic requests, responses, session events, file snapshots, checkpoints and per-run scores are outside Git.

The originally selected Eidolon `gpt-5.6-terra` returned `INSUFFICIENT_BALANCE` in preflight, before formal runs. The previously used NewAPI model was frozen for this cohort. A full sandboxed D02 preflight reached `NNNHNNN` and produced the correct deploy file.

## Result before quota failure

Repetitions 1 and 2 completed 26 pairs. Final task/process success was 18/26 native and 21/26 Handoff. Strict whole-conversation acceptance was 18/26 native and 15/26 Handoff, reflecting Handoff fallback and model/provider errors separately from final files. Only 13 pairs met the planned schedule without setup, model or provider errors. **Both arms passed all 13**; the clean subset does not show a fidelity advantage for either strategy.

| Item | Native task / 2 | Handoff task / 2 | Main limitation or finding |
| --- | ---: | ---: | --- |
| D01 | 2 | 2 | Standing rule survived both. |
| D02 | 1 | 2 | Native request budget and Handoff model-format errors affected one run each. |
| D03 | 0 | 0 | No complete valid final turn; model repeatedly inspected runtime details. |
| D04 | 0 | 2 | Native request budget prevented final delivery; one Handoff run also had a final model error. |
| D05 | 2 | 2 | Exact values survived both. |
| D06 | 2 | 2 | One Handoff run needed two visible native fallbacks. |
| D07 | 1 | 2 | One Handoff run fell back; correct runs kept ordered, once-only steps. |
| D08 | 2 | 2 | One Handoff run fell back twice; final verification status remained correct. |
| D09 | 2 | 2 | Unresolved conflict was correctly explicit; its warning is not a fallback. |
| D10 | 2 | 1 | Handoff timeout/fallback led to decoy port 8080 in one run. |
| D11 | 1 | 1 | Opposite arms hit the request cap in separate repetitions. |
| D12 | 1 | 1 | Both first runs hit the request cap; both second runs passed. |
| D13 | 2 | 2 | Both 2,500-file Handoff runs installed at boundary 4 without fallback. |

D10 gives the clearest semantic failure: after the fourth-boundary synthesis exceeded 120 seconds, the plugin visibly used a native compaction and retried Handoff at the fifth boundary. The installed Task State omitted the owner note `8443` from the middle of a 263,845-byte message. The final agent read only its first 500 bytes and wrote `8080`. Another Handoff run also omitted `8443` in Task State, but explicitly read the original around byte 130,000 and wrote `8443`. Searchability did not guarantee the relevant original would be found.

Four of 26 Handoff runs in the first two repetitions used at least one visible native fallback. Reasons included exact-value validation, step authorization validation, invalid Task State and synthesis timeout. These correctly continued under SPEC revision 4, but they do not count as successful fourth-boundary Handoffs.

## Interruption and reproducibility

The first cohort attempted all 78 scheduled runs, but 23 repetition-3 attempts received NewAPI `403 insufficient_user_quota`. They cannot be interpreted as model fidelity failures. A later minimal API request succeeded, but three fresh, full Pi retries received the same 403 and the corrected driver halted, leaving 21 of its 24 retry targets unstarted. The quota-repair selection reruns both arms for D02–D13 in repetition 3, preserving pair comparability; D01 repetition 3 had completed before the outage. Both D01 third-run deliverables were correct, but Handoff fell back at boundary 4, so that pair does not add to the clean planned-schedule subset.

After the owner reported sufficient Gemini quota, a second resume used the same frozen commit, fixture, NewAPI endpoint, `gemini-3.8-flash` and `high` settings. It stopped after three first-turn requests: D02 Handoff, D03 native and D04 Handoff each received `403 insufficient_user_quota`; 21 of 24 targets were not started. A separate sequential replay of D02's exact 8,262-byte provider request (including `high`, eight tools and `max_completion_tokens: 32768`) also received the same 403. Thus concurrency alone does not explain the block. All four responses and the three Pi attempts are preserved outside Git in `main-63a85b8-gemini38-high-20260926-resume-02`. No new complete pair or fidelity verdict was produced. The original first-two-repetition results and 13 clean-pair ties remain unchanged.

At the owner's request, one additional large-request probe replayed an existing synthetic D10 provider request directly, without starting another Pi run. The unchanged body was 276,261 bytes, with `gemini-3.8-flash`, `high`, eight tools and `max_completion_tokens: 32768`. NewAPI again returned `403 insufficient_user_quota`. Its request identity, status and response are outside Git in `quota-large-probe-20260926-01`; this probe is not a scored pair.

The owner's OpenRouter credential allowed only Meta providers, so the same Gemini model returned 404 there. A `meta/muse-spark-1.3-contributor` high preflight was a different model and installed Handoff only at boundary 7 after three visible fallbacks; it cannot substitute for the frozen comparison.

A later owner-directed one-shot OpenRouter probe changed only the model ID and reasoning setting of the synthetic 276 KB D10 request to `meta/muse-spark-1.3-contributor` and `medium`. OpenRouter returned HTTP 200, a complete streamed response with tool calls, no embedded error, and reported 95,556 prompt / 624 completion tokens. This establishes that the alternate route can serve a large request; it is not a Pi conversation result and cannot fill missing Gemini pairs. A Muse fidelity comparison would require a newly frozen, full paired cohort using that model and setting in both arms.

The scripts are `scripts/evaluate-drift.mjs`, `scripts/run-drift.mjs`, `scripts/rescore-drift.mjs`, and `scripts/aggregate-drift.mjs`. The rescore preserves each first derived score as `score-runner.json` and uniformly corrects schedule classification and D07/D11 process checks. The local full report and raw artifacts remain outside Git under the evaluation directory. Nothing here establishes automatic continuation, an optimal native-compaction count, or a general fidelity advantage.
