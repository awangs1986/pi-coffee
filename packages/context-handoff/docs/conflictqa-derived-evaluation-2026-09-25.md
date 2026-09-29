# ConflictQA-derived Pi conversation evaluation (2026-09-25)

This method extends the ConFiQA correction test with a different failure mode:
two original user-supplied sources have equal authority and disagree. A sound
Handoff must retain **both** claims and the owner's instruction to report an
unresolved conflict. The test does not ask the agent to decide the real-world
answer from its prior knowledge. It is a derived Pi conversation test, **not**
an official ConflictQA score.

## Source and independent oracle

The source is item 0 of the OSU-NLP-Group
[`ConflictQA-popQA-chatgpt` JSONL](https://github.com/OSU-NLP-Group/LLM-Knowledge-Conflict),
whose full file has SHA-256
`835f7d80d009d10b077551779c0decfae6ede4ef7cfcfdc0c5148eda30516a2f`.
Source text remains outside Git. The item supplies two conflicting occupation
claims and their supporting passages. Our Pi protocol explicitly says those
two user sources have equal authority and that the later turn is not a
correction. The expected deliverable is an uncertainty report copying both
claims exactly. This oracle comes from the test's user instruction, not from
the benchmark's world-truth label.

## Complete-conversation protocol

`scripts/evaluate-conflictqa.mjs` sends three checkpoint turns and one RELEASE
turn to Pi with `gemini-3.8-flash` at `high` reasoning. Each checkpoint must
trigger a real automatic native summary compaction. RELEASE must trigger the
fourth automatic threshold boundary. In the Handoff arm that boundary must
install Task State in the same session and continue without a fifth user turn;
in the native arm it must remain a native compaction. Both arms use the same
source item, turn text, model, thinking level and active tools.

After the fourth boundary, the agent must search each source marker separately,
read a verified original user anchor returned by each search, then write
`answer.json`. The file must contain only `status`, `alternatives` and `reason`:
`status` must be `uncertain`, `alternatives` must equal the two original claims
(in either order), and `reason` must state that they conflict. A protected file
must stay unchanged. The score also requires four successful threshold events,
one stable session, exactly four user messages, no provider errors and no
hidden follow-up prompt.

`scripts/score-conflict-procedure.mjs` scores actual successful tool results,
not just proposed calls. It requires both result chains to finish before the
first successful answer write. Blocked attempts are recorded separately.
Synthetic traces check a valid chain, a premature write after one source and
an unverified second source. Raw requests, responses and session entries are
saved outside Git. Evaluation is opt-in and paid; credentials come only from
`PI_HANDOFF_EVAL_API_KEY`.

## Results

The first full real-provider Handoff run finished with **failure** under the
predeclared score. Three native threshold compactions succeeded. At the fourth
boundary, a Handoff synthesis request returned, but Task State validation
rejected exact-value records whose label contained the delimiter while
`separator` was empty. Pi cancelled the fourth compaction. The agent later
searched and read original history and wrote the correct uncertainty report,
including both exact alternatives, **before any fourth boundary committed**.
The score therefore reports 3 committed boundaries, no post-boundary evidence
chain and no Handoff. It used 17 real model requests with no provider transport
errors, reporting 105,634 input and 31,584 output tokens. A correct answer is
not counted as successful Handoff.

Inspection of the rejected state found a second problem: it contained pending
read and write steps but omitted the user's explicit requirement to search
again **after** Handoff. A pre-Handoff search had already happened. The
original validator checks steps that are present, so it did not catch the
missing search step; the exact-value error happened to reject this state
first. An isolated public Pi lifecycle test reproduced the omission and
showed that the experimental plugin would otherwise install it. A narrow
independent obligation check now rejects a state with no pending post-Handoff
search when an original user source explicitly requires one. This is an
experimental fail-closed diagnosis, not yet an automatic repair or a default
product behavior.

The first isolated split-tool and indexed-repair run on the same item reached a
committed fourth Handoff. Its state included the required pending search, and
the repair request completed. The automatic continuation then received an
HTTP 200 stream containing an explicit provider error frame. Pi recorded an
empty assistant turn and produced no answer. The original scorer missed this
because it checked HTTP status and transport exceptions, but not `data.error`
inside the stream. A new stream inspector, synthetic regression test and
versioned rescore now classify this run as a provider failure (request 11),
separate from semantic or procedure failure. The failed trace is retained.

A retry with stream-error detection also failed at the first continuation
request; its failure is classified separately in the frozen diagnosis below.
Keep failed and timed-out runs in the comparison; one item cannot estimate
population-level fidelity or establish superiority over native compaction.

## Frozen continuation diagnosis

The first prototype continuation request failed with a stream-level provider
error. The retry again committed Handoff and returned the **same** error on
its first continuation request, now recorded correctly. Replaying that exact
captured request byte-for-byte produced the same HTTP 200 error frame a third
time (request SHA-256
`98ed6c5372a294a4bb4225e43d0a5a549b97502e03bd1ea991a70bae561a127b`).
The two live requests were different, but both asked the model to search for
two markers in one next action.

In a controlled frozen-request variant, only the final hidden continuation
message changed: it asked for the first marker's search alone and deferred the
second marker. This request completed in 4.2 seconds with a real
`handoff_evidence_search` call for `CONFLICT-A-0000`, `finish_reason: tool_calls`
and reported usage. The variant request SHA-256 was
`31caf184978eb4e47abfdac0ceffd3ae07e7bdff490f8d10e7edbe05c4e5649c`.
This isolates a request-shape sensitivity; it does not prove the provider's
internal cause or establish a full-session gain.

The isolated prototype now splits a source-authorized pending
`Search handoff_evidence for A and B` step into two atomic read-only search
steps, preserving both original markers and authorization. A public Pi
lifecycle test failed before this change and passed after it. In the full
ConflictQA-derived session with this candidate, the fourth Handoff committed,
the first continuation request completed normally, and the agent wrote the
correct uncertainty report with no provider errors. The strict result still
failed: it searched Source B after Handoff, but read Source A from a
**pre-Handoff** search result; its required post-Handoff Source A search and
read occurred only after `answer.json` was written. The score was
`recovered: [false, true]` across 22 requests, with reported totals of
164,130 input and 35,910 output tokens. This is a concrete limit of atomic next actions:
they improved the provider request but did not enforce the full procedure.

The isolated order guard now tracks both required markers separately and
allows an answer write only after each has a post-Handoff search result and a
verified original user read. A scripted public Pi conversation reproduced the
pre-Handoff anchor misuse and premature write, then passed after the guard
blocked both attempts. In the first real-provider run of this combined
candidate, the fourth Handoff and continuation completed without provider
errors. The guard blocked a pre-Handoff Source A anchor read, and the agent
then searched A after Handoff. It still wrote the correct report before
reading Source A's exact occupation claim: its default 1,024-byte read
contained the marker but not the claim later in the 3,719-byte original.
The strict procedure score remained `recovered: [false, true]` across 22
requests, with reported totals of 158,648 input and 25,906 output tokens.

The guard's source-read condition now also checks any program-validated exact
values attributed to that source. A scripted full Pi conversation first
failed because a short read skipped `VALUE_A`; after the change it blocked
the attempted write until a wider verified read included the exact value.
In the first real-provider run with this condition, the Handoff committed and
the guard blocked an old Source A anchor read. The model then searched A but
used the default 1,024-byte read, which contained the marker without the
claim. It repeated short search/read actions; RELEASE reached the evaluator's
300-second limit with no answer write. Request 16 was aborted during cleanup,
so this run is a timeout, not a successful uncertainty report. The guard
prevented premature completion but its initial block reason did not explain
that the read range was too short.

The guard now explicitly says that an exact source value is missing and asks
for a wider read (`limit: 4096`) or paged ranges. A scripted Pi lifecycle test
checks this feedback and correct recovery. Both arms' RELEASE wait has been
raised to 600 seconds for the next bounded comparison. Another real-provider
run finished after 22 provider requests without a provider error. It committed
the fourth Handoff in the same session and wrote the correct uncertainty report.
The original score said `recovered: [false, true]` because it required the A
marker and exact claim in one read result. The agent actually read the same
verified A anchor at byte ranges 0–1024 and 950–1450 before writing. The ranges
overlap, and their union contains both the complete A marker and exact claim.
After a red-first regression test, the scorer now joins consistent overlapping
verified ranges from the same searched original anchor, only before the first
successful answer write. Independent rescore `score-rescored-v2.json` preserves
the original `score.json` and reports `recovered: [true, true]`, `pass: true`.
This run used 22 requests, with provider-reported totals of 143,532 input and
57,505 output tokens; its elapsed time was 671 seconds. It is a successful
single-item prototype observation, not a claim of population-level superiority.
The guard has not been merged into the default plugin; restart, interruption,
coverage of other step types and general wording remain open.

## Same-item native comparison

The native arm used the same source bytes, four user turns, model
`gemini-3.8-flash`, `high` reasoning, Pi context settings, split evidence tools,
and 600-second RELEASE deadline as the successful prototype arm. The Handoff
limit alone changed from three to 100. Both saved sessions were rescored with
the same `score-rescored-v2.json` procedure revision; original scores remain
untouched.

| Measure | Isolated Handoff prototype | Native fourth compaction |
| --- | ---: | ---: |
| Automatic threshold boundaries | 4 (3 native + Handoff) | 4 native |
| Same session; user turns | Yes; 4 | Yes; 4 |
| Post-boundary verified source recovery | A and B | Neither |
| Correct uncertainty report written | Yes | No |
| Strict autonomous-conversation pass | Yes | No |
| Provider requests | 22 | 11 |
| Provider-reported input / output tokens | 143,532 / 57,505 | 17,740 / 27,901 |
| Elapsed time | 671 s | 172 s |
| Provider errors | 0 | 0 |

The native run's fourth threshold compaction committed, then Pi ended that
turn. There was no post-compaction assistant action, no evidence call and no
`answer.json`; its failure is a continuation failure under this protocol.
The prototype's post-Handoff automatic continuation let it complete the task,
at substantially higher request and token cost. This pair demonstrates one
complete-conversation success of the experimental mechanism. It does **not**
isolate semantic memory fidelity: a common fifth user prompt would be required
to compare what each saved context remembers when both are made to continue.
Neither outcome is an official ConflictQA benchmark score. The sample size is
one item and one attempt per arm.

## Same-session fifth-turn diagnostic

To separate automatic continuation from retained-context recovery, a new
`evaluate-conflictqa-followup.mjs` method resumes copies of both saved sessions
with the **same fifth user instruction**. It asks for a new
`diagnostic-answer.json`, without supplying either marker or claim, and
requires fresh original-history search, verified reads of both user sources,
then the exact uncertainty report. The scorer begins at the fifth user
message: prior Handoff searches, reads and answer writes earn no credit.
The original `answer.json` remains in the Handoff copy, so the test also
requires new verified reads rather than accepting a copied old file. No
additional compaction is allowed. This is a prompted diagnostic, separate from
the strict four-turn autonomous score.

Pi stores the workspace path in the session header. An initial cloned-native
attempt copied the session file without changing that header. Pi wrote the
correct diagnostic report and performed both fresh evidence chains, but wrote
to the original run's workspace while the harness inspected the clone. Its
`score.json` is retained as an **invalid harness result**, not a native-arm
semantic failure. The two generated files were preserved in that diagnostic
directory and removed from the original workspace, restoring the original
run. The corrected method rewrites only the cloned session header's workspace
path, retains the same session ID and source history, and checks that the
original workspace's relevant files remain byte-identical.

The corrected fifth-turn pair used the same prototype extension, split evidence
tools, model, `high` reasoning, prompt, and 600-second deadline.
The runner takes the saved arm directory and a new output directory, with
`PI_HANDOFF_EVAL_PLUGIN_ROOT` pointing to the isolated prototype checkout.
That prototype is not activated or merged by this evaluation. Credentials are
passed only through `PI_HANDOFF_EVAL_API_KEY`; session copies, requests and
scores remain outside Git.

Both arms passed the independent fifth-turn procedure and exact answer checks:

| Measure | Native saved session | Handoff saved session |
| --- | ---: | ---: |
| Fresh post-prompt verified A/B recovery | Both | Both |
| Exact uncertainty report | Correct | Correct |
| Fifth-turn strict pass | Yes | Yes |
| Provider requests | 11 | 8 |
| Provider-reported input / output tokens | 84,801 / 4,187 | 90,411 / 1,684 |
| Elapsed time | 58 s | 38 s |
| Original workspace unchanged; provider errors | Yes; 0 | Yes; 0 |

This pair does not show a semantic-retention advantage for Handoff. The native
session retained enough information to search and recover both originals when
prompted. Handoff reduced tool/model turns here, but consumed 92,095 reported
tokens versus 88,988 for native in the fifth turn; one run cannot establish a
cost or latency advantage. The directly observed product gain is successful
automatic continuation at the fourth boundary in this run. The split
search/read tools,
atomic next actions, multi-source order guard, and actionable read-range
feedback are promising prototype changes because they addressed concrete
failed traces. The restart failure below must be fixed, then interruption and
cancellation must be validated before merging into the default plugin. More
items and repetitions are needed before choosing a fidelity policy.

## Restart gate for the experimental order guard

A controlled public Pi lifecycle test took the isolated prototype through a
manual Handoff with pending `search → read → write` steps, stopped Pi, reopened
the same saved session, and asked it to continue. The scripted provider proposed
`write answer.json` before any new search or read. The write succeeded and the
file contained the deliberately premature value. This is a **product behavior
failure** for the candidate, not a scorer artifact. The test is retained as an
expected failure in the isolated experiment, so its check suite distinguishes
the known failure from passing acceptance tests.

The current guard builds its obligation state only from the live
`session_compact` event. It does not reconstruct that state on `session_start`,
and its `input` handler clears the state. A restart followed by the user's
ordinary “continue” input therefore bypasses the guard. The next product
change should persist or replay source-bound obligations from the committed
Handoff and successful tool receipts, then reconcile new user corrections and
cancellation without silently discarding unfinished obligations. Validate
restart, interruption, new input and cancellation through the same public Pi
conversation seam before enabling this guard by default. The currently
successful uninterrupted ConflictQA run does not pass this lifecycle gate.
The isolated candidate and expected-failure test are preserved at
[`experiment-field-repair` commit `7875565`](http://192.168.100.1:3000/awangs/Context-handoff/src/commit/7875565),
separate from the default-plugin implementation branch. Its complete check
reports 45 passing tests and one expected failure.


## Later implementation resolution (2026-09-25)

The failed restart result above remains the outcome at `7875565`. Subsequent
repair work at experiment commit `6c49c99` replaced transient guard state with
active-branch replay and converted the expected failure to a normal passing test.
The implementation branch now integrates that source change, paged recovery,
latest-user reconciliation and bounded field repair without overwriting the
newer evaluation scripts or rescoring the old live runs.

The regression also exposed a second lifecycle defect: a valid user replacement
survived restart but the next Handoff revived the old missing-search check. A
failing public-conversation test was followed by persisted receipt propagation
into later synthesis. The same subsequent-boundary test now covers completed
paged recovery. A cancelled-task regression separately prevents revival of old
search ordering. A bounded timing-patch regression distinguishes a missing search
from an existing search whose phase/status needs repair. See plugin-acceptance.md for the final integrated check.
These are deterministic Pi RPC tests, not a new paid model comparison; the
single-run live outcomes and comparative limits above remain unchanged.

## Real-model rerun after durable-order repair (2026-09-25)

The entire predeclared paired cohort was run again after the restart/paging/order
repairs and after updating the independent evaluator for the split search/read API.
Provider: the owner's NewAPI endpoint, model `gemini-3.8-flash`, thinking `high`
on every captured request. Both scenarios, two repetitions, both arms, and the
same fifth prompt for every saved session completed. Exact request bodies were
forwarded unchanged. Local context compaction settings remained intentionally
small so Pi reached four actual automatic boundaries. Synthetic workspaces,
records, and answers only. Raw requests, responses, sessions, and progress logs
are outside Git in `work/paired-eval-after-durable-fix-01`.

| Arm | Autonomous strict passes | Fields correct (mean / 9) | Post-boundary search | Search then read | Mean reported tokens / run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native | 0/4 | 2.25 | 0/4 | 0/4 | 58,383 |
| Handoff | 1/4 | 6.75 | 3/4 | 2/4 | 543,194 |

All four native fourth summaries occurred, but three sessions made no autonomous
post-boundary agent request. One continued and got all fields right, but did not
meet post-boundary search/read ordering. Handoff installed three states; one
synthesis returned parseable-provider HTTP 200 with `stop`, but its fourth
compaction was aborted before a state was committed. Of the other three, one
passed fully. Another found the required source but exhausted the 42-request
per-run budget before producing the answer. The fourth read after searching but
still failed the complete-conversation oracle. Handoff performed 24 verified
reads across its four runs, with repeated reads contributing to high usage.

Every Handoff run used more reported tokens than its matched native run. Total
autonomous usage was 2,172,776 reported tokens for Handoff versus 233,530 for
native (about 9.3×). This is a token proxy, not a verified currency charge.
The Handoff 42-request cap was reached in two runs; it bounds this test and is
not a product runtime cap.

With the identical fifth user prompt, native passed 3/4; one additional native
attempt had an incomplete provider response and no usable answer. Handoff passed
2/4. All four Handoff follow-up answers had 9/9 expected fields, but two failed
the required fresh-search-then-read procedure. Follow-up usage was 998,203 tokens
for Handoff and 296,608 for native (about 3.4×); one Handoff recovery alone used
885,624 input tokens. Reported costs in USD remain unavailable.

The rerun shows a repeatable difference in this small workload: native compaction
does not autonomously resume, while Handoff sometimes does. It does **not** show
a broad fidelity or efficiency win. Autonomous Handoff passed only once in four
runs, suffered a synthesis/validation abort, and made many duplicate recovery
calls. When explicitly prompted later, native recovery passed at least as often
and used fewer reported tokens in these samples. The validated restart guard and
paging behavior are deterministic engineering evidence; these stochastic live
outcomes do not establish that a model will consistently respect those controls
or that the current Handoff prompt is ready for production.

The updated scorer recognizes both `handoff_evidence` actions and the distinct
`handoff_evidence_search` / `handoff_evidence_read` calls, while still requiring
the search after boundary four and a later read. Its two regression cases and the
full **66-test** suite passed before this live rerun. Earlier raw evaluations and
their scores remain preserved as dated records.
