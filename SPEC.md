# Context-handoff

Revision 4 — 2026-09-26. Status: implemented on the implementation branch; see docs/plugin-acceptance.md for bounded engineering evidence and remaining semantic limits.
Revision 4 adds three owner decisions (visible native fallback, budget degradation instead of stopping, structured step actions); see [Revision 4 owner decisions](#revision-4-owner-decisions-2026-09-26). Where they conflict with earlier text, revision 4 governs.
This revision implements the owner's four requested corrections: configurable cadence, concise model state with program-owned evidence, model-aware generation, and automatic conversation acceptance. Revision 1's adaptation/import plan remains superseded.
Tracking: [Issue #1](http://192.168.100.1:3000/awangs/Context-handoff/issues/1) (`ready-for-agent`).

## Problem Statement

During long Pi tasks, native model-generated summary compaction can omit effective
requirements, owner corrections, decision rationale and evidence. Repeated
summarization can preserve or compound those errors. The owner wants the agent
focused on the current authorized task without having to create a new conversation,
prepare a handoff manually, resend instructions or tell the agent to continue.

Original bytes remaining on disk do not establish correct continuation: an agent
may not know what it has forgotten or which original source to retrieve. Handoff
must preserve task meaning and make the relevant evidence discoverable.

This is a new Pi plugin project. Previously imported Coffee packet/Host code is
historical reference only. It is neither the architecture nor an implementation
baseline, and its test results do not satisfy this specification.

## Solution

Provide a Pi plugin that defaults to three successful native summary compactions. The cadence is configurable (1–100 native successes); three is an initial policy, not an empirically optimal or safe bound.
When the next compaction would begin, perform an automatic Handoff instead of the
next native summary compaction (the fourth with default settings). Do not hand off immediately after the third
success. If the task finishes before another compaction is needed, finish normally.

The user remains in the same visible Conversation with continuous history,
Workspace, attachments and task identity. Handoff is an internal operation: no
new visible conversation, command, confirmation, copied brief, or required
"continue" message. If authorized work remains active, the agent resumes it
automatically after a successful Handoff. A finished, stopped or cancelled task
must not be restarted by that mechanism. An unrecoverable failure is visible.

Build the new active context from attributed Task State and a compact evidence
index. Preserve original requirements and corrections, distinguish effective and
superseded decisions, reconcile progress with current project facts, and retrieve
original details only when needed. Learn selectively from context-fold and
billion-context-pi. The goal is higher continuation fidelity; zero drift is not
claimed, and three compactions is a policy choice rather than a proven safe bound.

## User Stories

1. As a Pi user, I want to install a plugin, so that automatic Handoff is provided by the runtime without invoking a Skill.
2. As a Pi user, I want the first three successful native summary compactions to proceed normally, so that the agreed recovery cadence is predictable.
3. As a Pi user, I want the next compaction to invoke Handoff instead of another native summary, so that repeated summary cycles are bounded.
4. As a Pi user, I want no immediate switch after the third success, so that a task can finish without an unnecessary Handoff.
5. As a Pi user, I want failed and cancelled compaction attempts excluded from the count, so that recovery is not triggered by unsuccessful work.
6. As a Pi user, I want successful manual compactions included in the same count, so that manual and automatic recovery cannot create contradictory histories.
7. As a Pi user, I want the count to survive resume, restart and model changes, so that lifecycle events cannot accidentally reset the policy.
8. As a Pi user, I want branch navigation to restore that branch's effective count and Task State, so that unrelated history is not mixed into my task.
9. As a Pi user, I want a committed Handoff to start a new counting cycle, so that continued long work follows the same policy.
10. As a Pi user, I want to stay in one visible Conversation, so that I never have to locate a replacement conversation.
11. As a Pi user, I want earlier history to remain readable, so that automatic Handoff does not erase my record of the work.
12. As a Pi user, I want my Workspace, checkout, attachments and evidence retained, so that the agent continues with the same resources.
13. As a Pi user, I want authorized active work to continue automatically, so that Handoff does not leave the agent waiting for a new prompt.
14. As a Pi user, I want completed, stopped and cancelled tasks to remain in those states, so that automation respects my intent.
15. As a Pi user, I want the latest objective and acceptance conditions preserved, so that the agent continues solving the right problem.
16. As a Pi user, I want effective constraints and my corrections retained with their original sources, so that an older requirement cannot silently regain authority.
17. As a Pi user, I want rejected approaches and their relevant reasons retained, so that the agent does not repeat unsuccessful work.
18. As a Pi user, I want current requirements distinguished from historical quotations and tool content, so that evidence cannot invent authorization.
19. As a Pi user, I want important older decisions discoverable beyond a fixed recent-message window, so that an early constraint remains usable later.
20. As a Pi user, I want confirmed completed work separated from remaining work and uncertain claims, so that the agent neither repeats nor skips necessary actions.
21. As a Pi user, I want old verification results attributed to the revision and observation they tested, so that a previous pass is not reported as a current pass.
22. As a Pi user, I want exact paths, identifiers, commands, versions and error spellings retained, so that the agent can locate the correct source material.
23. As a Pi user, I want to recover original evidence across repeated Handoffs, so that access does not depend on a chain of generated summaries.
24. As a Pi user, I want recovery to search historical originals as well as the compact index, so that a fact omitted from a summary can still be found.
25. As a Pi user, I want small, scoped recovery results, so that retrieval does not immediately refill the active context.
26. As a Pi user, I want missing, changed or out-of-scope evidence reported accurately, so that plausible references do not masquerade as verified facts.
27. As a Pi user, I want incomplete source coverage and unresolved conflicts made explicit, so that the agent does not guess which instruction wins.
28. As a Pi user, I want Handoff to wait until active actions and delegated work are safely settled, so that it cannot orphan work or lose results.
29. As a Pi user, I want input arriving during preparation incorporated exactly once, so that corrections are not dropped or duplicated.
30. As a Pi user, I want Handoff cancellation to be respected throughout the transition, so that I can stop work at any point.
31. As a Pi user, I want crashes to recover a coherent committed state, so that restarting cannot create duplicate continuations or repeat uncertain side effects.
32. As a Pi user, I want preparation and recovery to fit explicit budgets, so that context management itself does not exhaust the available window or run indefinitely.
33. As a Pi user, I want my selected model, tools and instructions restored appropriately, so that Handoff does not silently change the agent's capabilities.
34. As a Pi user, I want routine successful Handoff to require no attention, so that I can keep working naturally in the same conversation.
35. As a Pi user, I want a clear recovery status when automatic continuation cannot proceed, so that a stalled or ambiguous transition is not hidden.
36. As a maintainer, I want tests of the complete Pi conversation behavior, so that packet serialization alone cannot be mistaken for a working plugin.
37. As a maintainer, I want outcome fidelity and source integrity evaluated separately, so that a valid hash is not treated as proof of correct task understanding.
38. As a maintainer, I want explicit compatibility and upstream provenance, so that the plugin can evolve without modifying Pi core or silently importing unrelated features.

## Implementation Decisions

1. **Delivery and independence.** Build a new Pi plugin through supported extension interfaces. It must not depend on the user running a Skill. Do not require Coffee Host, the old P7 structure, or Coffee-specific Chat/Work mode semantics as an architectural premise. Preserve the source of Pi instructions, selected model and active capabilities. Standalone Pi is the primary integration target; additional host bindings must explicitly meet the same visible-continuity contract.

2. **One principal testing seam.** Use Pi's public conversation lifecycle as the principal Interface: feed normal user input and compaction events, observe outgoing provider requests, visible history, continuation and recovery. Keep policy, source selection, packet persistence and context installation inside the Handoff module where possible. Do not expose a collection of management tools merely to make internal functions testable. The owner confirmed this whole-conversation acceptance level.

3. **Success-based cadence.** Persist committed native summary compaction counts for the active conversation lineage/branch. Count manual and automatic native successes once; failures, cancellations, retries, process starts and Handoff synthesis calls do not count. Before the configured native-success count (default three), do not replace native summarization. At the next would-compact boundary, Handoff owns recovery and prevents a competing fourth native summary. Successful Handoff resets the new cycle to zero; failed preparation does not.

4. **Logical continuity is mandatory; physical session strategy is open.** Preserve one user-visible Conversation and its history/resources. Either rebuilding active context inside the native session or internally replacing a session may be used if supported by public Pi interfaces and the complete contract. A plugin that merely starts a new visible conversation fails acceptance. Validate the supported mechanism before committing to storage or transition architecture; an unsupported host must not advertise seamless operation or silently fall back to a visible new conversation.

5. **Autonomous continuation.** Capture whether there is active authorized work and its next bounded action. After successful context installation, continue that work through the supported Pi lifecycle without requiring user input. Do not manufacture new authorization, duplicate user messages, or restart completed/cancelled work. A recovered transition must not issue a second continuation for an action whose execution status is uncertain.

6. **Task State is prepared for Handoff.** The model returns at most 12 concise claims with source IDs, status and one next action. The program resolves source IDs into hashes/timestamps, records current project observations, and preserves original messages in native history. Source IDs identify whole messages, not verified entailment; optional legacy quotes are checked literally. Do not ask the model to reproduce transcripts, hashes, timestamps or an exhaustive state. Assemble objective and acceptance conditions, effective constraints, owner corrections, accepted/superseded decisions, relevant rejected approaches, completed/remaining work, blockers, uncertainties and next action. Attach source identity and provenance to important claims. The new design does not require continuously maintained notes or a general memory framework.

7. **Original-source selection.** Use relevant original user messages, verified project artifacts and observed development evidence. Prioritize corrections and active requirements; do not define correctness as keeping only the first line or the first/recent N messages. Generated summaries can help locate originals but cannot be the sole authority in subsequent Handoffs. When selection is bounded, expose coverage and omissions; do not silently proceed past an unresolved constraint essential to the next action.

8. **Authority and supersession.** Preserve the difference between an original user instruction, a model interpretation, a tool observation and a historical quotation. Record explicit replacement/cancellation relationships with provenance. A reference existing is not sufficient: supported validation must check the referenced content and distinguish verified claims from interpretations. Do not require users to reconfirm every valid earlier instruction solely because Handoff occurred.

9. **Current facts.** Reconcile claimed progress with the authoritative project material and current checkout as needed for the next action. Record revision/time and scope for verification observations. Source files or state changing during preparation invalidate affected claims. Read-only reconciliation does not authorize running new tests, modifying files or replaying commands with side effects.

10. **Selective context-fold learning.** Adopt the principles of exact lexical indexes, durable source anchors, identity/integrity checks and bounded retrieval. Preserve useful paths, identifiers, commands, versions, numbers and error excerpts. Distinguish historical failures from current blockers. Stable compact evidence representations and protected current working material are relevant to the Handoff seed; an automatic same-session fold ladder before the first three native compactions is not part of this specification.

11. **Selective billion-context-pi learning.** Study search across original historical messages, message/block-level recovery, temporary recovery that leaves compact context intact, and purpose/goal-change/decision-rationale organization. Include discovery hints for omitted material. Do not adopt recursive T1/T2/T3 summarization, its delegation subsystem, or its blanket cancellation of all native compaction. Its prompt guidance and citation-format checks do not substitute for provenance or factual validation.

12. **One bounded recovery Interface.** Provide search and scoped reads through the smallest model-facing surface compatible with Pi. References identify their original conversation/session source, extent and integrity, not a transient fold code alone. Preserve access across repeated Handoffs and branch navigation without merging unrelated scopes. Large bodies stay outside active context; no default permanent full expansion. Verify or explicitly label unavailable/changed/unverified evidence.

13. **Evidence ownership and ingress.** Preserve original admitted history and existing evidence stores. Handoff must not resurrect rejected search material, duplicate entire transcripts into a competing store, or bypass a host's ingress limits. Packet/evidence state belongs to the owning Conversation and stays out of repository commits and public logs. Treat preserved images and attachments honestly: retaining a file pointer does not prove its visual content was understood.

14. **Bounded preparation.** Set explicit source-input, generated-state, index, retrieval, output-headroom, deadline and retry budgets before implementation acceptance. Use the selected model through supported provider interfaces when synthesis is necessary; deterministic checks validate references and metadata. Reject incomplete/failed generation rather than installing a partial context as complete. Report estimates distinctly from provider usage. Inherit Pi thinking strength through the public provider API. Defaults are 16,384 output tokens and 120 seconds with reasoning, or 4,096 tokens and 60 seconds with reasoning off. Output includes provider reasoning and is capped by model output capacity, half its context, and conservative source headroom. Explicit flags allow 1,024–65,536 output tokens and 100–300,000 ms deadlines. Cancellation remains immediate and full-generation retries remain zero; the restricted field-patch attempt below shares the original deadline. Output truncation, provider failure and deadline expiry must be distinguishable. These values are engineering choices, not proven safe bounds.

15. **Safe transition.** Prepare an immutable snapshot, validate its lineage/resources, durably establish the replacement context and then continue. Settle active tools and delegated work first; unknown action status is not permission to replay. New input, cancellation or changed project state during preparation must be reconciled before commit. Preserve tool-call/result pairing and provider-specific constraints in every outgoing request.

16. **Recovery and failure.** Restart from the last unambiguous committed state. Do not claim success on cancellation, missing source, storage failure or uncertain commit. Prevent duplicate context installation and continuation. If safe recovery cannot fit the budget or resolve ambiguity, expose a concise error and stop automatic work. Do not secretly use a fourth native summary to conceal a failed Handoff or loop oversized requests. *(Revision 4: a failed Handoff preparation now uses one visible native summary instead of stopping; see below.)*

17. **User experience.** Routine successful transitions produce no new conversation, confirmation flow, handoff ceremony or request to continue. Internal diagnostics may record bounded metadata for inspection. Errors requiring user action are surfaced; silent failure does not satisfy the requirement for an unobtrusive transition.

18. **Attribution.** Pin any copied/adapted upstream code and retain its license and copyright. Learn mechanisms selectively; this plugin is not a renamed context-fold or billion-context-pi installation. The imported Coffee code remains historical material and does not constrain the new design.

## Testing Decisions

- **Main acceptance surface, owner confirmed:** run the complete Pi conversation workflow through public lifecycle controls with a controlled provider, capturing actual outgoing requests, user-visible conversation/history and resumed work. Use this single high seam to exercise counting, preparation, context installation, recovery and continuation together. Test observable behavior rather than internal class layout, private helpers or incidental summary wording.
- **Cadence:** observe three actual successful native summary compactions, no immediate Handoff after the third, and Handoff instead of the fourth would-compact event. Include manual/automatic entry, failed/cancelled attempts, restart, model change, branch restore, a second Handoff cycle and a task that finishes before the next boundary.
- **Invisible continuity:** assert the visible Conversation identity, earlier history, Workspace and attachments remain usable; the active authorized task continues without an extra user message. Assert completed/cancelled work stays stopped. Do not accept an idle replacement session as a completed Handoff.
- **Fidelity fixtures:** use independent expected task facts covering an older correction outside the recent tail, a constraint in a later paragraph, a revoked requirement, a rejected approach, partial completion, stale test evidence, exact identifiers/error spellings and unresolved conflicting claims. Inspect the installed context and subsequent externally visible behavior; do not use the generated brief as its own expected answer.
- **Original recovery:** remove a detail from the compact narrative while retaining a discovery hint, then recover its exact original text through the plugin Interface across successive Handoffs. Cover branch navigation, missing/tampered/foreign sources, source ranges and output budgets. Retrieval being possible and the agent recognizing when to retrieve are separate properties.
- **Failure and races:** cover input arriving during preparation, cancellation before/after persistence, changing checkout state, active/unknown delegated work, provider errors, exceeded budgets, packet-write failure, interrupted context installation and restart around commit. Assert no lost/duplicated input, replayed side effect, extra successor or duplicate autonomous continuation.
- **Provider request correctness:** inspect current user content, tool-call/result pairing, instructions, active tool schemas, output headroom and media handling on the supported Pi/provider paths. A smaller saved packet is not proof that the final provider request is smaller or valid.
- **Prior art only:** the repository contains historical Coffee packet/resolver tests and P7 local-provider lifecycle tests. Their scenarios can inform the new suite, but old assertions, counts, architecture and passing runs are not acceptance of this plugin.
- **Semantic evaluation gate:** controlled-provider tests establish orchestration and deterministic integrity, not model comprehension. Any claim of improved continuation fidelity needs a separately authorized, bounded real-model evaluation with independent expected outcomes, all summary/recovery cost included and failures retained. No real-model run is authorized by writing this specification; future authorized runs use the previously selected evaluation model, eidolon/gpt-5.6-terra. Do not rerun the historical P7 matrix by default.
- **Completion:** record the supported Pi version, integration mechanism, reproducible checks, observed outcomes and remaining limits. Plugin implementation is complete only when its user-visible contract passes; production activation is a separate decision.

## Out of Scope

- Implementing the plugin in this specification-writing task.
- Treating the old Coffee/P6/P7 implementation as the new plugin architecture or acceptance baseline.
- A Skill-based/manual handoff workflow or a new user-visible conversation.
- Automatic context-fold-style folding before the three native compactions, replacing those native compactions with deterministic indexes, or recursive multi-tier summaries as a substitute for Handoff.
- A general long-term memory framework, continuously maintained task notes or an unrelated delegation/scheduling system.
- Pi-core modifications, a browser UI redesign, production deployment, activation/default-model changes, or public package/GitHub publication.
- Real user transcript collection, an unrestricted benchmark, claims of zero drift, or claims that three compactions is universally optimal.

## Further Notes

The owner explicitly restarted this as a new plugin design. Revision 1 and its
code import are historical; this specification is the new behavioral authority.
An internal Session Segment is permitted only as an implementation option that
preserves the visible Conversation contract. The public Pi mechanism supporting
that contract is the first bounded implementation question to resolve, not an
excuse to weaken the user experience.

The implementation agent may choose compatible packaging, storage schema,
budget values and internal module structure within this specification. Record
those choices and their evidence; do not assume an unverified Pi interface exists.
If the contract requires unsupported host changes or Pi-core modification, report
the concrete conflict instead of silently delivering a manual/new-conversation flow.

Source research inspected context-fold 0.5.1 and billion-context-pi 0.1.77 at
fd8095e69ca3317b52fb58adccf9745a3dc18dfa. Their mechanisms are references, not proof
of this plugin's efficacy. See the maintained research note and source inventory.
The related research distinguishes raw-byte recoverability from correct task
continuation, and cumulative processed tokens from active context capacity.


## Revision 3 acceptance additions

- Exercise non-default cadence, inheritance of high reasoning, model output caps,
  deadline/cancellation failure and invalid configuration through Pi RPC.
- Recover deterministic historical project observations by the same scoped evidence
  tool. Those observations never become current verification or owner authority.
- A real-provider run must use four actual automatic threshold boundaries with
  three native entries followed by one Handoff. Require same session, exactly four
  user messages, hidden autonomous continuation and correct deliverable without a
  fifth user prompt. Source recovery requires both search and scoped read.
- Preserve all failed attempts. Direct JSON parsing, manual fourth compaction or a
  correct answer after a follow-up are not substitutes for full acceptance.
- Real-provider recording must forward the recorded body and upstream bytes
  unchanged, including reasoning, limits and usage. Lowered local compaction
  thresholds are explicit test conditioning, not production capacity measurements.

### Recovered evidence lifetime

Keep recovered evidence across intermediate tool calls in the same user turn, within a 32 KiB content window. Evict oldest evidence on capacity pressure and clear prior-turn evidence on new user input. Keep tool call/result pairing and original recovery available; a tool call alone does not establish that earlier evidence has been consumed.


### Exact values and procedural state (revision 3 follow-up)

The synthesis contract includes bounded `exactValues` and ordered `steps` arrays.
An exact-value record carries field name, label, literal separator, value, source
ID and a short original quote. The program verifies the quote exists and equals
label + separator + value, then binds the original hash and timestamp. Values are
lexical strings: never coerce numbers, normalize Unicode, strip units or silently
repair a mismatched span. Narrative claims must not override structured values.
Label/field selection and effective-source choice remain model interpretations;
this check does not infer all missing values from arbitrary prose.

Each step records its user authorization quote, phase relative to the upcoming
Handoff (`before_handoff`, `after_handoff`, `anytime`), and status (`pending`,
`completed`, `uncertain`). Completion requires quoted original successful tool
results paired with original assistant tool calls. Assistant statements and failed
results do not establish completion. Existing evidence precedes the upcoming
Handoff, so it cannot complete an `after_handoff` step. Unfinished mandatory
`before_handoff` steps block installation. Pending/uncertain steps have no
completion evidence. An active next action equals the first pending step, and
uncertain steps suppress automatic continuation. A done task cannot retain
unfinished steps. Do not revive already completed one-time historical work.

Bounds: 16 exact values and 12 steps; 512-character values/actions, 1024-character
quotes, at most four completion references per step, all within the existing
12 KiB state and 24 KiB installed-context budgets. Missing arrays on legacy states
normalize to empty arrays for compatibility, not certified complete coverage.
Malformed records cannot be installed. The restricted field patch below may repair
supported structure; failure preserves the previous context. Earlier evaluation
outcomes remain historical evidence and are not reclassified by these changes.

### Evaluation of state and continuation

Evaluate the installed Task State and the final user task separately. Check the
effective exact identifier value, label/value separation, a pending post-Handoff
search step, and consistency between the first pending step and next action.
Locate every original recovery tool call relative to the fourth compaction entry.
A search before that boundary does not satisfy a required search afterward;
require a subsequent scoped read. Score final answer fields against independently
specified literals. Report the first observed failure stage, field omissions,
wrong present values and repeated tool calls separately. Keep all failed runs.

For a paired comparison, predeclare scenarios and repetitions, run both policies
with the same model, thinking level, context settings, tools and task text. The
native arm keeps the evidence tool available but raises the Handoff cadence above
the measured four boundaries. First measure autonomous continuation with exactly
four user messages. Then resume the same saved sessions using an identical fifth
user prompt in both arms to compare retained-context task fidelity separately.
Report per-arm correct fields, post-boundary search/read, omissions, repeated calls,
wall time and provider-reported token usage. If actual billed currency prices are
unavailable, report them as unknown rather than converting tokens using an
invented rate. Two scenarios and two repetitions are a pilot, not proof of a
general superiority claim.


### Evaluation-driven reliability follow-up (2026-09-25)

1. Expose separate original search/read tools with small action-specific schemas;
   retain `handoff_evidence` compatibility and the same original-source store.
2. Permit at most one model field-patch request after a parsed state fails
   validation. It may change only exact-value label/separator or authorized step
   phase/status. Preserve values, source IDs, quotes and actions; only a premature
   read-only evidence search may return from completed to pending. Revalidate the
   entire result. Truncation, provider failure and invalid JSON receive no retry.
   The patch inherits reasoning, shares the preparation deadline, uses at most
   8192 output tokens, and obeys the 96 KiB/context input budgets.
3. *(Removed in revision 4; superseded by structured step actions.)* Normalize the supported source-quoted two-marker search into two ordered
   searches. Recognized explicit after-Handoff searches in an active task cannot
   be silently omitted or satisfied by earlier results. This is bounded lexical
   recognition, not general natural-language procedure verification.
4. For the supported pending search → original read → write procedure, derive
   obligations from the latest committed Handoff and replay successful branch
   observations at each public tool call. Restart, new generic continuation and
   branch selection must not forget them. Credit only searched original user
   anchors with verified byte ranges containing the marker and source-bound exact
   values. Accumulate consistent pages per anchor (32 KiB); gaps cannot fabricate
   contiguous text. Completed recovery survives restart.
5. New user input permits unrelated work while retaining prerequisites on the
   recognized original write/edit paths. To replace that ordering, the model may
   call `handoff_reconcile` with an exact latest-user quote and reason. Persist
   Handoff ID, user entry ID/hash and quote, validate them on replay, and carry the
   replacement into later synthesis. Completed one-time recovery likewise stays
   completed across later Handoffs. Keep all originals available. No user
   command, confirmation or new visible conversation is required. Stopped/done
   task state must not revive an old search requirement.
6. The guard is a workflow check for standardized step text, recognized markers
   and paths, not a shell sandbox or complete side-effect authorization system.
   After new input, other tools/path forms are outside this protection. A matching
   latest-user quote proves provenance; deciding that it truly cancels/replaces
   a requirement remains model interpretation. These changes do not prove
   general fidelity superiority, semantic completeness or resistance to a model
   deliberately misusing the reconciliation tool.


## Revision 4 owner decisions (2026-09-26)

The owner confirmed the cadence rationale: a small number of native summaries
has acceptable distortion; serious drift appears after repeated compactions.
Handoff therefore bounds the number of consecutive native summaries rather than
replacing every compaction. Three changes follow.

### 1. Visible native fallback instead of a stalled conversation

A Handoff preparation failure (provider failure, deadline, truncation, invalid or
unrepairable Task State, unknown tool settlement state, context headroom, storage
of the preparation journal, history/project change during preparation) uses **one
native summary compaction** for that boundary. The failure is reported visibly
(`Handoff failed: … Used one native compaction instead`). The native success counts
normally, so the next boundary retries Handoff. The failure is never presented as
a successful Handoff.

The compaction is still cancelled (no native summary) for owner decisions and
transient conditions: cancellation, invalid configuration flags, blocked recovery
state (corrupt journal), unsettled running tools or reported delegated work, and
new user input arriving before or during preparation. Those boundaries retry
Handoff later. Persistence failure of the native Handoff entry itself remains a
blocking recovery state.

### 2. Budget degradation instead of stopping

- **Project observation.** Workspace size never blocks Handoff. Inline text is
  bounded to 32 KiB (8 KiB per file) and prioritizes paths mentioned in the
  conversation (most recent first), then recently modified files (changed or
  untracked files only in repositories over 1,024 paths). Every snapshot includes
  a `project:inventory` source listing file count, fingerprint scope and paths
  without inline text; those files are explicitly unverified. The change
  fingerprint hashes all files for inventories up to 1,024 paths (content within
  8 MiB, size/mtime beyond); larger Git repositories use HEAD, working-tree status
  and hashes of changed/untracked files. Non-Git inventories are bounded and
  labelled partial when truncated.
- **Owner messages.** All original user messages remain mandatory. When they do
  not fit the preparation budget, long messages are excerpted with one uniform
  cap (head and tail kept, the omitted middle marked with its byte count). The
  synthesis input and installed summary list excerpted messages with recoverable
  anchors. Validation of quotes, exact values and step authorization always uses
  the full original. Preparation fails (and falls back) only if even 256-byte
  excerpts cannot fit.

### 3. Structured step actions instead of lexical recognition

Steps carry `action` (`search_evidence`, `read_evidence`, `write`, `other`) and an
optional `target`. `search_evidence` requires one exact query; `write` requires a
workspace path. A guarded target must occur literally in the authorizing original
user message. The evidence-order guard is installed only from these fields: pending
`after_handoff` searches define markers; a pending `after_handoff` read requires
verified original reads; pending writes are protected. When an evidence step is
the first pending step, other tools are held during automatic continuation;
otherwise only protected writes are held. Legacy steps without `action` normalize
to `other` and receive no guard.

The field patch may reopen a completed step only if its action is read-only
(`search_evidence`/`read_evidence`). Removed: regular-expression recognition of
English step text and user instructions (`Search handoff_evidence for …`, "after
the fourth context maintenance boundary"), automatic splitting of combined
searches, and the check that rejected a state omitting a lexically recognized
post-Handoff search. An omitted or misclassified step is now a model
interpretation error that evaluation must measure; it is not detected by the
program. This removes evaluation-specific wording from product behavior and makes
the guard independent of the user's language.

### 4. Exact evidence search

Original-evidence search is an exact, case-sensitive substring match, consistent
with decision 10 (exact lexical indexes) and with the evidence-order guard, which
compares markers exactly. A differently cased query returns no user match and a
hint to retry with the exact spelling. Commit confirmation at startup tolerates
torn trailing lines and does not impose a total session-size limit; the 8 MiB
budget applies to preparation and evidence recovery only.
