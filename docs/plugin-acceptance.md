# Context-handoff acceptance

## Historical SPEC revision 2 acceptance

Date: 2026-09-24. Scope: PH-01–PH-08 (Gitea child issues #2–#9).
The owner authorized TDD at the whole Pi conversation seam. The parent issue #1
is not modified or closed by this implementation.

## Reproduction

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

Use Node >=22.19.0; the recorded environment uses Node 22.23.2, npm and Linux.
The lockfile pins Pi 0.87.1 and package dependencies. No production credentials,
real model calls, deployed default changes or public registry publication are used.
Provider fixtures bind to loopback, run the real Pi RPC process, capture actual
outgoing requests and use isolated workspaces/session stores. Fault tests use real
filesystem permissions, cancellation and process termination. Run the permission
cases as an ordinary user, as in the recorded environment.

**Recorded result:** `npm run check` passed: TypeScript build and **30 tests in
2 files** (63.97 seconds). This includes **26 new plugin conversation cases** and
four unchanged historical packet cases. The latter are reported separately and
are not plugin acceptance. A clean clone at `9b4fea5`, restored with `npm ci
--ignore-scripts --no-audit --no-fund` (267 packages), independently passed the
same 30 tests in 64.16 seconds. A subsequent recovery-guard regression test also
passed; final-head verification is recorded with the delivery PR.
`git diff --check` also passed.

## Ticket evidence

| Ticket | Accepted engineering behavior | Conversation evidence |
| --- | --- | --- |
| PH-01 / #2 | New plugin; native successes 1–3; next boundary Handoff; automatic continuation in one Conversation | Stable session ID, original user history, actual continuing provider request; shipped scenario performs a real `read` tool action |
| PH-02 / #3 | Success ledger survives failures/restart/model selection/fork; repeated cycles; manual and auto counting | Two cycles, failures excluded, explicit forks before and after Handoff, three actual automatic native compactions |
| PH-03 / #4 | Original requirements, old corrections, quoted provenance, supersession, bounded generation | Older later-paragraph constraint retained; fake source rejected; tool observation cannot create owner authority; next action needs its own original authorization; oversized history has explicit omissions; stalled provider times out |
| PH-04 / #5 | Current project observations and exact facts; stale verification remains historical; changes invalidate | Current `protected.txt` content and exact `E_CASE_42` enter synthesis; modifying checkout or original history during synthesis prevents commit |
| PH-05 / #6 | Single bounded original search/read tool across two Handoffs | Narrative omits a rare fact, search finds it, exact read restores it; foreign and changed anchors and split UTF-8 reads are rejected; later requests retain valid tool pairing |
| PH-06 / #7 | New input, cancellation, settlement and one continuation | Concurrent correction arrives once; cancellation during preparation and after commit; completed task suppresses threshold/overflow continuation; delegated work must settle |
| PH-07 / #8 | Coherent local commit and conservative recovery | Journal directory denial; native session-file denial; hard process exit after commit; corrupt journal; recovered installed context cannot be mislabeled as the old context when journal update fails |
| PH-08 / #9 | Installable Pi package and assembled contract | Tarball loaded by Pi package discovery in a clean agent environment, two cycles and actual file read; source checkout works without `dist`; original admitted image and instructions retained; request/output headroom checked |

## Preserved red → green observations

Tests were added incrementally against the public seam. Representative failures
that drove implementation, preserved here instead of discarding them:

1. Missing new extension: `Extension path does not exist`.
2. Fourth-boundary baseline: expected one Handoff, received zero.
3. Older corrections: continuing request lacked `Never publish credentials.`.
4. Current project facts: synthesis lacked `CURRENT_REVISION ... E_CASE_42`.
5. Original recovery: Pi returned `Tool handoff_evidence ...` rather than evidence.
6. Concurrent input: expected no stale Handoff, received one committed Handoff.
7. Delegated work: compaction resolved while the independent operation was running.
8. Journal write failure: compaction incorrectly resolved rather than rejecting.
9. Corrupt journal: new input was appended instead of being blocked for repair.
10. Long observation history: compaction cancelled rather than selecting bounded
    optional observations while retaining all owner constraints.
11. Valid tool quotation promoted into authority: compaction incorrectly resolved.
12. Unattributed next action: an active destructive next action incorrectly passed.
13. Fork after Handoff: valid inherited history was reported as a missing journal.
14. Original transcript changed during preparation: stale context still committed.
15. Overflow after a completed task: an extra provider request occurred.
16. Native append failure: writing a subsequent error produced an orphan history
    chain; restored active messages contained errors but lost `Continue inspection.`.
    Reporting via Pi UI instead preserved the previous committed active context.
17. Cancel after commit: the next user input caused 12 total requests instead of 11,
    exposing an old queued continuation. Moving continuation to Pi's public
    `agent_before_settle` draft interface removed the leftover queued work.
18. Full request headroom: a replacement was accepted despite oversized real
    instructions; the installed-context budget now includes instructions/tools/tail.
19. Source installation: package discovery found no Handoff without `dist`.
    The Pi manifest now points to the shipped TypeScript entry.
20. Recovery journal still unwritable: an installed checkpoint was incorrectly
    reported as "previous context retained". Recovery now distinguishes absent
    commit from failure updating the journal after a verified installed commit.
21. Corrupt required state still allowed a manual native compaction before the
    third-count check. The recovery guard now precedes cadence handling.

Some acceptance cases already passed through an earlier vertical slice (for
example initial persistent counting); they were retained as regression evidence,
not presented as additional red cycles. Fixture corrections are also distinct
from product fixes: Pi rejects immediate re-compaction of an unchanged compacted
session; pressure must be on the final assistant response rather than a preceding
tool call; a malformed PNG was rejected at Pi ingress and was replaced by a valid
synthetic image. The tests preserve **admitted** media, never resurrect rejected
media. No historical Coffee test result was substituted for these cases.

## Meaning of the result

The suite demonstrates deterministic orchestration, lifecycle boundaries, source
identity/quotation checks, packaging and conservative failure handling through the
real supported Pi public interfaces. It does not establish that a real model always
understands goals, quotations, supersession or completion correctly. In particular,
source hashing and scripted synthesis are not evidence of improved semantic
fidelity over native compaction. A separately authorized real-model evaluation
with independent expected outcomes remains necessary for that claim.

See [design and limits](plugin-design.md) for exact budgets, supported synchronous
work and the delegated-work adapter contract. Unknown asynchronous host state,
other Pi versions, remote filesystem durability and other provider protocols are
not silently advertised as tested. Original history beyond the bounded scan or
mandatory requirements beyond the preparation budget causes an explicit stop.


## SPEC revision 3 — 2026-09-25

The owner authorized four corrections and real-provider evaluation at the public
Pi RPC conversation seam. No Pi core changes or production deployment were made.

### Changes and regression evidence

- Native success cadence is configurable (0–100, default 3). Tests distinguish the
  configured next boundary from immediate switching after the preceding success.
- Concise source references replace model-generated quotation/metadata copying.
  The program binds hashes/timestamps, records bounded project observations in
  native compaction details, and exposes historical snapshot recovery separately
  from current workspace facts.
- Synthesis inherits the active reasoning level, uses model-bounded output capacity
  (reasoning default 16384) and a reasoning default deadline of 120 seconds.
  Cases cover overrides, model capacity clamping, invalid configuration and safe
  deadline failure without a silent native fallback.
- The live script exercises actual automatic thresholds and hidden continuation.
  It forwards precisely the request bytes it records and leaves responses unchanged.
- A real run exposed repeated alternating evidence reads: earlier evidence was
  evicted after every assistant tool call. A new public conversation test failed
  because two recovered sources could not coexist, then passed after retaining
  evidence within the current user turn under a 32 KiB content window. New input
  expires previous-turn evidence; original history and tool pairing remain intact.

New RED observations included unknown cadence/budget CLI options, concise source
references failing installation, and loss of the first evidence result after the
second recovery call. These are distinct from provider/model output variability.

Final `npm run check`: TypeScript build and **38 tests passed** in 2 files
(67.97 seconds): 34 Pi conversation cases and 4 unchanged historical cases.
`git diff --check` passed.

### Live methodology and preserved findings

Provider: the owner's NewAPI endpoint; model `gemini-3.8-flash`, thinking `high`.
The endpoint's available models were used rather than claiming the originally
requested OpenRouter model had been tested here. Credentials and raw transcripts
remain outside Git. The opt-in script is `scripts/evaluate-live.mjs`.

The synthetic combined scenario covers an owner correction (90 → 17), conservative
mode, a rejected approach, current revision r3 versus historical tests at r1,
`E_PARSE_42`, a UTF-8 identifier, original retry 137ms versus an untrusted 900ms
suggestion, version 4.2.1, and a protected audit file. Expected results are fixed
independently of synthesis output.

The local provider declaration uses context 131072, reserve 131071 and retained
recent tail 128 to reach automatic boundaries cheaply. This is an orchestration
acceptance setup, not a full-production-context workload. Checkpoint responses
supply enough fresh text for Pi to prepare compaction. The script never calls the
manual compact RPC. It disables additional compaction after the fourth event to
bound the evaluation. Exactly four user messages are sent, with no fifth prompt
or manual continuation after Handoff.

`revision3-live-01`: PASS, three automatic native compactions plus one automatic
Handoff, same session, autonomous completion, original search and scoped read,
9/9 exact output fields and protected audit file unchanged. Synthesis actually sent
high / 16384, returned HTTP 200 / stop in 9.594 seconds, with 5205 input and 2350
completion tokens reported by the provider. The run used 33 model requests and
20 evidence calls (2 search, 18 read); eventual correctness did not excuse the
repeated-read defect described above.

Earlier testing had a measurement defect: one proxy modified the parsed
`reasoning_effort` for its saved record but forwarded the unchanged request bytes.
That run does not prove high was sent for synthesis. Separate direct budget probes
really sent high: 4096 and 8192 ended at length; 16384 produced parseable JSON in
58.39 seconds. Parseable JSON alone was never semantic/plugin acceptance. The new
script captures and forwards the same bytes, fixing that measurement problem.

These samples establish bounded successful continuation, not a universal fidelity
improvement over native-only compaction, nor an optimal cadence of three. Wider
paired workloads and repeated cycles remain necessary for those comparative claims.


`revision3-live-02` (after the evidence-lifetime fix): **FAIL** against the unchanged
strict oracle. The automatic 3+1 chain, same session, four user messages, autonomous
continuation, original scoped reads and protected file all passed. Output fields
were 8/9 correct: identifier was `Résumé-ID: ZX_729/β` instead of `ZX_729/β`.
The wrong prefix was already present in synthesis claim c6 and survived original
reads. Search happened before Handoff because the model called the tool in its
release response despite the no-tools instruction; the required post-Handoff
search was absent. This is a preserved behavior/semantic failure, not a network
failure, and the expected output was not relaxed to make it pass.

This run used 22 model requests and 7 evidence calls. Synthesis sent high / 16384,
returned HTTP 200 / stop in 9.600 seconds, with 6375 input and 1512 completion
tokens. Fewer evidence calls in one stochastic rerun are not a controlled speedup
claim; the deterministic regression establishes the evidence-lifetime correction.
All four engineering changes are implemented, but strict real-model acceptance
on the final implementation is **not fully passed**. Further semantic work should
address exact-value interpretation and preservation of pending procedural
requirements, retaining this sample as a regression workload.


## Follow-up: fixed failure samples and grounded records

Scope: only the owner's first two requested next steps. No paid real-model rerun,
comparative evaluation or changed live oracle is included in this follow-up.
`test/fixtures/semantic-regressions.json` contains synthetic, independently expected
reproductions of the two failures, not raw runtime transcripts. The identifier
expectation remains `ZX_729/β`; a search before the upcoming Handoff does not
satisfy a required search afterward.

At the previously approved public Pi conversation seam:

1. RED: compaction wrongly resolved with `Résumé-ID: ZX_729/β` in the declared
   value field. GREEN: the inconsistent labeled mapping is rejected without
   installing a Handoff; a corrected mapping installs the exact value, original
   quote and program-owned hash/timestamp into the continuing context.
2. RED: compaction wrongly resolved with an `after_handoff` search already marked
   completed by a real earlier tool result. GREEN: the premature completion is
   rejected; a pending step commits and reaches automatic continuation with its
   original authorization and timing intact.
3. Additional regression: assistant assertions and failed reads cannot establish
   completed steps; done status with pending work is rejected; a real successful
   read may complete the first step while the subsequent write remains pending.

These are deterministic provider-response fixtures through the real Pi RPC
process. They validate program checks and transmission of grounded state, not
real-model adoption, recall of every requirement or correctness of final output.
The prior final-version live failure remains recorded above.

Final follow-up verification: `npm run check` passed the TypeScript build and
**41 tests in 2 files** (69.74 seconds): 37 Pi conversation cases and 4 unchanged
historical cases. `git diff --check` passed.

## Paired semantic evaluation protocol

The next evaluation uses two predeclared synthetic cases in
`test/fixtures/paired-evaluation.json`: an owner correction with a labeled UTF-8
identifier, and a changed revision with a conflicting quoted suggestion. Each
case runs twice for each arm. Both arms use the same model, high reasoning,
tools, task text, compactable checkpoint format and local context settings.
The native arm keeps the evidence tool and sets the Handoff threshold above the
four measured compactions; the Handoff arm uses the default threshold of three.
No user message is added between the fourth compaction and the first score.

The first score checks actual outgoing requests and Pi entries: three initial
automatic native compactions, the fourth boundary type, autonomous continuation,
installed state if present, final exact fields, source search/read timing relative
to the fourth boundary, duplicated tool calls, wall time and provider-reported
tokens. A structured state can fail even when a later answer is correct, because
that state must guide other possible continuations. Conversely, a sound state
does not excuse a wrong final answer. The scorer records the first failing stage.

After preserving that no-prompt result, reopen each original session and send
the **same fifth user message** to both arms. Automatic compaction is disabled
during this follow-up so the comparison focuses on the retained context. The
follow-up score is reported separately; it does not retroactively turn a failed
autonomous result into a pass. Saved request bodies are forwarded unchanged,
with no proxy editing of reasoning level or usage. Raw traces and credentials
remain outside Git. Token counts are a cost proxy; actual billed currency is
unknown without the provider's verified price and billing data.

`scripts/evaluate-paired.mjs`, `scripts/evaluate-followup.mjs`,
`scripts/score-evaluation.mjs`, `scripts/rescore-paired.mjs` and
`scripts/aggregate-paired.mjs` implement this protocol. Rescoring all saved raw
traces with one scorer version avoids mixed interpretations if a scoring mistake
is found during the pilot. The aggregate includes every predeclared run, including
missing results and failures.

### Completed paired pilot (2026-09-25)

Model: `gemini-3.8-flash` through the owner's NewAPI endpoint, with `high` on
every captured model request. Handoff synthesis requested 16384 output tokens.
The eight predeclared runs were completed (two scenarios × two repetitions × two
arms), then the same fifth prompt was sent to each saved conversation. The proxy
forwarded each captured request body unchanged. Four user messages belong to
the autonomous phase, five to the prompted phase. An intentionally low local
reserve threshold exercised real automatic Pi compaction without filling a
production-sized context. The raw run is `paired-eval-01` outside Git.

| Scenario / repeat | Native without fifth prompt | Handoff without fifth prompt | Native after common prompt | Handoff after common prompt |
| --- | --- | --- | --- | --- |
| Correction / 1 | No automatic resume | Pass: 9/9 fields and search → read | Provider `response_format_error`; no usable output | Pass; repeated reads added cost |
| Correction / 2 | No automatic resume | Pass: 9/9 fields and search → read | 9/9 fields, but no required read after search | Pass |
| Revision / 1 | No automatic resume | 9/9 fields; state correct, execution read happened before the required search | Pass: 9/9 fields and search → read | 9/9 fields; procedural order remained wrong |
| Revision / 2 | No automatic resume | Synthesis ended at output length; no Handoff committed, old context later produced 9/9 fields | Provider `response_format_error`; no usable output | 9/9 fields; no committed Handoff or valid post-boundary recovery |

The scorer initially matched only the step's narrative text for the search
identifier. A valid step used a generic text and put the exact identifier in its
quoted authorization. All eight raw traces were rescored under the corrected
rule; the earlier score is preserved in `score.json` and the consistent result
in `score-rescored.json`. A second scorer correction distinguished the final
run's real synthesis `length` stop from a boundary that never triggered. It
requested 16384 tokens and returned 16308 completion tokens in 65.316 seconds.
The failed Handoff conservatively cancelled compaction rather than silently
falling back to native. These are methodology corrections, not product fixes.

Autonomous strict pass rates: native **0/4**, Handoff **2/4**. Native's four fourth
compactions completed, but Pi made no next agent request without a fifth user
message. Handoff's three installed states all had the correct exact identifier,
a pending post-Handoff search step, and a matching next action. Two of those
continued correctly; one violated search/read order after installation. A fourth
state was never installed because synthesis was truncated. All four Handoff arm
final files had 9/9 expected fields, including the one completed on the retained
old context after failed Handoff. That field count alone is not a Handoff pass.

Across the no-prompt phase, native used a mean **141.64 s**, **11** model requests
and **53,291** reported input+output tokens per run. Handoff used **233.65 s**,
**22.75** requests and **202,703** tokens per run (about **3.8×** the reported
tokens). Handoff had one duplicate exact tool call across four runs; native had
none because it did not continue. Provider usage is a cost proxy. Verified USD
prices and billed amounts are unavailable, so no currency saving is claimed.

After the identical fifth prompt, Handoff passed **2/4** and used **706,167**
additional reported tokens across four runs; its added duplicate calls totaled
**17**. Native passed **1/4** on first attempts and used **303,339** additional
reported tokens, but two of those four requests returned HTTP 200 containing
an SSE `response_format_error` and no usage/final content. Therefore native's
first-attempt mean token use and 4.5/9 mean correct fields are materially
confounded by provider errors. Of the two usable native first attempts, both
had 9/9 correct fields and one met the strict search → read requirement.

The two provider-error sessions were replayed once from their pre-fifth-message
states as a separately labeled sensitivity check. An initial replay with an
uncorrected copied session `cwd` was invalid and excluded; its synthetic write
was preserved separately and the original workspace was restored. In isolated
replays with the correct session workspace, both native continuations passed
strictly with 9/9 fields and search → read. These replacements do not alter the
predeclared first-attempt rates. They indicate that native summaries retained
enough facts for prompted recovery in these samples. All four native fourth
summaries contained the tested identifier, corrected mode/limit, rejected
approach and a lexical recovery cue; these presence checks do not prove complete
semantic understanding.

This pilot supports the same-session autonomous continuation capability in two
of four Handoff runs and identifies concrete failure stages: post-installation
execution order, synthesis output truncation, and provider response formatting.
It does **not** establish a general semantic fidelity advantage over native
compaction. The sample is small, scenario values were given explicitly, the
native arm required a fifth prompt to resume, and high-cost repeated evidence
reads were observed. No production activation or model change followed.

## Evaluation-driven implementation follow-up (2026-09-25)

Integrated the source changes from experiment `7875565` and its restart repair
`6c49c99` into the implementation branch, preserving the newer main-branch
ConflictQA/ConFiQA scorers, independent scorer tests and historical results.
Experimental runtime fault injection and file names were removed; the new
modules and evidence-tool adapter participate in strict TypeScript compilation.

The public Pi RPC provider fixtures cover:

- Required search → verified original read before an answer write, including
  two distinct sources, failed/wrong reads and short-range feedback.
- Normalization of an authorized combined search; an omitted required search
  still prevents installation rather than being invented by a repair.
- Restart with unfinished recovery: premature answer writes remain blocked.
  New unrelated tasks can proceed. A replacement must quote the latest user
  input; quoting the old task fails, and the valid receipt survives restart.
- Separate evidence pages jointly satisfy source-bound exact values; restart
  does not require completed reads again. Current user corrections enter actual
  outgoing provider requests.
- A subsequent native compaction and Handoff retain both completed recovery and
  latest-user replacement. Both initially failed by reviving the historical
  missing-search check; branch replay now carries retired ordering forward.
- A stopped task does not revive an old evidence-search requirement.
- One label/separator patch can correct an invalid exact-value split while a
  patch attempting to change the value fails without committing a Handoff.
- A prematurely completed read-only search can be repaired to pending after the
  upcoming Handoff. The request inherits `high`, uses a bounded output budget,
  and no answer-write side effect occurs during repair. Before the fix this was
  incorrectly classified as an entirely omitted search and never reached repair.

The old `it.fails` restart case is now an ordinary passing assertion. Original
live failures remain in their dated reports. This follow-up uses the real Pi
process with deterministic provider responses, not a new paid model evaluation.
It verifies supported lifecycle behavior and validator enforcement, not that a
live model will always choose the correct quote, step or final answer. The scoped
guard and semantic reconciliation limits are described in plugin-design.md.

Final integrated verification: `npm run check` passed the strict TypeScript build
and **64 tests in 5 files** (78.37 seconds): 47 Pi conversation cases, 13 evaluator
regressions and 4 unchanged historical packet cases. No expected-failure cases
remain in this suite. `git diff --check` passed. No production installation,
package publication or fresh paid model comparison was performed in this update.

A follow-on evaluator regression adds two scorer tests for the new split search and
read tool names. The paired evaluator now credits a search only after the fourth
boundary and still requires the read to follow that search. It rejects a read
without a post-boundary search even when an earlier search exists. The integrated
suite after this scorer update passed **66 tests in 6 files** (78.67 seconds).
A fresh full paired live comparison was subsequently completed; see the latest
rerun section in `conflictqa-derived-evaluation-2026-09-25.md`. Earlier scores
remain unchanged.

## Revision 4 acceptance (2026-09-26)

Scope: owner decisions in SPEC revision 4 (visible native fallback, budget
degradation, structured step actions) and the drift-probe question bank.

**Recorded result:** `npm run check` passed: TypeScript build and **77 tests in
7 files** (~94 seconds): 51 Pi conversation cases, 4 unchanged historical packet
cases, 15 evaluator cases and 7 drift-probe fixture/scorer cases.

| Change | Conversation evidence |
| --- | --- |
| Visible native fallback | Invalid state, unrepairable patch, tool-authority promotion, missing next-action authorization, deadline, stalled provider, headroom, journal storage failure and history/project change each produce exactly one native compaction plus a `Handoff failed … Used one native compaction` notice; the next boundary installs Handoff. Cancellation, invalid flags, unsettled delegated work, arriving input and corrupt journal still cancel. |
| Project budget degradation | 1,100-file workspace hands off; the mentioned file is inline, unmentioned files are absent from synthesis input and listed by the inventory. |
| Owner excerpting | ~216 KB owner message hands off; synthesis input ≤ 96 KiB with an `[EXCERPT: …]` marker; a quotation from the omitted middle validates against the full original; the omitted middle is read through the installed coverage anchor. |
| Structured steps | Chinese instruction with `search_evidence`/`read_evidence`/`write` steps blocks a premature write, then allows it after search and verified read; a search target absent from the authorizing message is rejected. Existing guard, restart, paged-read and reconcile cases pass with structured fields. |

Removed cases: "does not install a Task State that omits an explicitly required
post-Handoff search" and "installs one evidence search per marker when the pending
action combines two searches". They tested English lexical recognition, which
revision 4 removed by owner decision. Omitted or misclassified steps are now
measured by evaluation rather than detected by the program.

No real-model run was made for revision 4. Earlier live results remain historical
evidence for revision 3 behavior.

Robustness follow-up (same day):

| Change | Conversation evidence |
| --- | --- |
| Streaming commit confirmation | After a committed Handoff, a 9 MiB malformed line and a torn trailing line are appended; reopening confirms the commit without an error and accepts the next prompt. The previous implementation blocked recovery here. |
| Incremental order guard | After search, verified read and write, an extension command navigates back to the Handoff entry; the next write to the protected path is blocked again. A mutation that kept stale state on branch change failed this case. |
| Exact search | A differently cased query returns no user match and the exact-and-case-sensitive hint; the exact query matches, and a preview beginning next to an emoji does not start with a lone surrogate. |
