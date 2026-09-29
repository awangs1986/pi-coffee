# Context-handoff implementation

Implements [SPEC revision 7](../SPEC.md). Source and independent package releases
live in `pi-coffee/packages/context-handoff`; Host owns enablement and timing.
The Coffee import remains historical and is not linked by the package entry.
Supported runtime: Pi 0.87.1, Node >=22.19.0, Linux, persistent local session
storage outside the workspace.

## Public integration

See [Host integration](host-integration.md) for the exported protocol and lifecycle.
`session_before_compact` returns immediately unless Pi reports a manual request
with the exact `HANDOFF_REQUEST` marker. Ordinary manual, threshold and overflow
compactions stay Pi-owned. There is no count, cadence setting or automatic retry.
Pi owns its pairing-safe cut point, session identity, original history, system
instructions, tool schemas and selected model.

Synthesis uses `ctx.modelRegistry.streamSimple()` with the selected provider,
request-time authentication and Pi thinking level via the provider-neutral
`reasoning` option. Budgets are captured per attempt; a thinking-level change
invalidates the result. This is separate from native synthesis.

Explicit Pi compaction can abort an active run. Host should settle work first and
own any later authorized prompt. The plugin commits attributed context in the same
session and verifies persistence; it does not enqueue or perform continuation.
Failed preparation cancels visibly without native fallback. A native commit or
journal failure can leave settlement uncertain and requires recovery.

## Attributed Task State and original sources

All original user messages are mandatory synthesis inputs, including older
corrections and later paragraphs. Current bounded project observations are also
mandatory. Optional assistant/tool observations are ranked by exact identifiers
and recency to fit the remaining budget. Source coverage and omissions are
explicit. Synthesis cannot claim omitted observations were verified. Critical
unresolved conflicts must produce `uncertain`, which is reported to the caller.
There is no recursive summary ladder and no continuously maintained notes.

The model returns at most 12 claims of 512 characters each, using source IDs instead of reproducing quotations and metadata. The program binds source IDs to original hashes and observation timestamps. Legacy quoted evidence is still accepted and checked literally. Validation checks source existence, claim kinds and replacement targets. Tool/assistant evidence alone cannot become an objective, owner constraint,
correction or accepted decision. An active next action must itself be attributed
to original user evidence. Authority labels are computed by the plugin.

**These checks establish attribution, not entailment.** A model can still
misinterpret a quote, mistake a quotation within a user message for an instruction,
or misjudge completion. Whole-message source IDs establish attribution, not statement-level entailment. The synthesis prompt explicitly addresses those cases;
only a separately authorized semantic evaluation can measure the remaining error.
There is no claim of zero drift or a proven safe three-compaction interval.

Project inspection hashes bounded current files and the Git revision. It records
paths, modification times and read scope, and provides bounded text. Large/binary
files and symlinks are explicitly unverified. It runs only read-only Git inspection,
never tests or user commands. Historical verification is not current verification.
Changed history bytes, checkout observations, branch leaf, input, model or tool
loadout invalidate preparation before context installation.

## Original recovery

`handoff_evidence_search` and `handoff_evidence_read` offer action-specific schemas;
the compatible `handoff_evidence` tool provides the same exact lexical search and
scoped UTF-8 byte reads over original admitted messages on the active branch. Anchors
contain session ID, entry ID and SHA-256 of the original message representation,
including its media metadata. Reads compare the anchor with the persisted source.
Foreign, missing, changed, out-of-branch and split-UTF-8 requests return explicit
errors. Search previews include role and discovery anchors; compact indexes may
omit entries but the original-history search can still find them.

Recovered tool bodies remain available across intermediate tool calls in the same
user turn, within a 32 KiB content window (newest first). A new user turn or window
pressure replaces expired bodies with a short retrieval reminder. Original tool
history remains stored, and tool-call/result pairing is preserved. Media admitted by Pi remains in its native history. Textual
recovery reports that images were retained without claiming visual understanding.
Rejected or omitted-at-ingress media is not recreated by the plugin.

## Budgets

| Work | Limit |
| --- | --- |
| Original history integrity/recovery scan | 8 MiB |
| Mandatory + selected synthesis source payload | 96 KiB, further reduced for model capacity |
| Generated Task State | 12 claims / 512 characters per claim and next action; installed state 12 KiB |
| Provider output (including reasoning) | Default 16,384 with reasoning, 4,096 off; configurable 1,024–65,536, capped by model and half-context capacity |
| Compact evidence index | 8 KiB plus coverage/discovery metadata |
| Installed Handoff summary | 24 KiB |
| Synthesis deadline / automatic synthesis retries | Default 120 seconds with reasoning, 60 seconds off; configurable 100–300,000 ms / zero |
| Project fingerprint | Per-file hashes up to 1,024 paths (8 MiB content, size/mtime beyond); larger Git repositories: HEAD + status + changed files |
| Project inline text / individual file | 32 KiB / 8 KiB, mentioned paths first; never blocks Handoff |
| Each read-only Git operation | 3 seconds |
| Recovery search page / read / total result | 8 matches / 4 KiB / 8 KiB |
| Request headroom | 8,192 units reserved beyond a conservative UTF-8 byte estimate of summary, retained messages, instructions and tools |

The request estimate is deliberately conservative and is **not** provider token
usage. Provider usage is not inferred from saved packet size. Oversized required
owner/project coverage fails visibly; the plugin does not promise infinite usable
history or silently discard mandatory constraints. Filesystem operations assume
local storage; a remote filesystem can have different latency/durability behavior.

## Work settlement and cancellation

Pi's tool lifecycle tracks in-flight calls. Extensions owning delegated work must
emit the following public event before returning an asynchronous tool result, and
again when its complete result has been admitted to the owning conversation:

```ts
pi.events.emit('pi-handoff:work', {
  id: 'stable-operation-id',
  tool: 'owning_tool_name',
  status: 'running' // later 'settled', or 'unknown' if outcome is uncertain
});
```

Status observations persist in the native conversation. Unknown custom tools
without a settlement report block Handoff. The owner of an operation must not
report `settled` before its result is available. Ordinary synchronous built-in
Pi tools are supported. Uninstrumented background work outside Pi is not observable
through this interface; such hosts need an adapter before claiming seamless
settlement. No delegation subsystem is included.

Queued new input invalidates preparation and remains in Pi's queue exactly once.
Cancellation is checked throughout synthesis and before commit. Failures produce
a bounded visible status and cancel the request. Host owns further decisions.

## Persistence and recovery

The native compaction entry is the canonical installed context. A sibling
`<session-file>.handoff.json` records a checksummed preparation/installation phase,
summary identity and legacy continuation status. It contains bounded metadata, not a
second transcript. Journal writes use a private temporary file, file fsync, rename
and directory fsync. Before reporting installed context, the native entry is read back and synced.

An explicit Pi fork inherits its committed checkpoint; unrelated branches do
not share source scope. A legacy journal with uncertain continuation
shows recovery status and does not replay work. Corrupt/missing required journal
state blocks new input until repaired and reloaded. Storage failure during native
append blocks execution and reports through Pi UI notifications, avoiding additional
entries attached to an unpersisted parent. Restart uses the previous committed
history. Local fsync sequencing is tested; arbitrary hardware/filesystem failure
is not claimed to be impossible.

## Packaging and provenance

The `pi.extensions` manifest points at the new TypeScript entry, which Pi loads
natively. Both source checkouts and packaged tarballs work without Coffee or a Skill.
`npm run build` also emits declarations/JavaScript. The Pi peer version is pinned to
0.87.1; runtime TypeBox is pinned to 1.3.7. Other Pi/provider versions have not been
accepted by this suite. Native RPC lifecycle is the acceptance seam; this is not a
separate graphical TUI automation test.

No upstream source was copied into `src/plugin`. Selective conceptual learning:
context-fold 0.5.1 (exact lexical anchors, integrity and bounded recovery), and
billion-context-pi 0.1.77 at `fd8095e69ca3317b52fb58adccf9745a3dc18dfa`
(original-history search, scoped recovery and goal evolution). See the research
note. Existing Coffee snapshots/provenance/licenses are unchanged and excluded
from the shipped plugin files. New plugin distribution remains private/UNLICENSED.

## Program-owned evidence record

Native history remains the original-message store. Each committed Handoff's native
compaction details contain the deterministic source manifest (ID, role, hash,
timestamp), history fingerprint and bounded read-only project snapshot. The model
never generates that record. Active context contains concise state, current project
observation time/revision and a compact index, not the full archived project bodies.
`handoff_evidence` searches/reads project snapshots from committed Handoffs on the
active branch with a `historical-project-observation` role. Their anchors identify
the compaction and source index and hash actual stored bytes. They confer neither
owner authority nor verification of a later workspace revision.

The model's 12-claim budget makes omission possible; complete original owner input
remains in synthesis and original recovery stays available. Hash/reference checks
cannot prove coverage or semantic correctness. Fidelity must be checked against
independent expected outcomes after continuation (historical cadence experiment).


## Exact values and ordered procedures

`state.exactValues` separates `field`, `label`, `separator`, `value`, `source` and
`quote`. `grounding.ts` validates a literal original span and its component equality,
then rebuilds each record with program-owned hash and timestamp. The original
`Résumé-ID: ZX_729/β` therefore admits label `Résumé-ID`, separator `: ` and value
`ZX_729/β`; a value containing the full labeled span fails that declared mapping.
This validates a model-selected mapping, not arbitrary semantic extraction. An
omitted field, wrong but internally consistent label mapping, conflicting original
sources or incorrect downstream use still needs semantic evaluation.

`state.steps` is an ordered record of user-authorized actions. A successful tool
observation must have a preceding matching call ID/name and a non-error result;
its quote and source metadata are retained in completed-step evidence. Success of
a tool protocol does not prove the result semantically completes an action. The
program validates phase, status, evidence provenance and next-action consistency;
the model still interprets whether the evidence is relevant. Completed post-Handoff
steps cannot cite pre-Handoff observations. This avoids turning an early search
into proof that a required later search already happened.

The synthesis prompt requests these records and the installed recovery guidance
instructs continuation to use exact values without their labels and follow pending
steps in order. The follow-up below adds bounded structural repair and a public
tool-call order guard; neither proves semantic correctness.
Empty legacy arrays do not establish completeness; all records share existing
state, synthesis and installed-context size limits. Unknown completion remains
uncertain and must not cause side-effect replay.


## Bounded state repair and durable evidence ordering

`state-repair.ts` admits one restricted patch after a parsed Task State fails
validation. It preserves value/source/quote/action fields, rejects extra patch
keys and repeated indexes, and runs the full validator again. Only authorized
read-only searches completed before the required boundary can return to pending.
An authorized combined two-marker search becomes separate pending actions.
Recognized required searches omitted entirely from an active state stop
preparation; the patch cannot invent a missing procedure. Recognition currently
uses the documented English step forms and is not a universal language parser.

The repair request inherits reasoning, has at most 8192 output tokens, shares the
original AbortSignal/deadline and checks input/context headroom. Source selection
remains bounded and preserves mandatory originals. Full synthesis retries remain
zero. Runtime fault injection is absent; synthetic faults live in provider tests.

`order-guard.ts` reconstructs requirements from the latest committed Handoff and
successful original-history search/read results on the active branch for each
public tool call. It does not execute historical calls. Failed results do not
count. Consistent adjacent/overlapping byte ranges accumulate separately for each
anchor, up to 32 KiB; disjoint sections never invent a contiguous exact value.
A read missing a required literal receives a wider-range/paging hint. A completed
recovery remains completed after restart, avoiding mandatory duplicate reads.

The guard recognizes consecutive pending `Search handoff_evidence for MARKER`
steps followed by an original-anchor read, all attributed to original user input.
For legacy context without a new user prompt, those obligations precede other tools. Once new
user input arrives, unrelated work is allowed and recognized `Write <path>`
deliverables remain protected for `write` and `edit` calls. This is not enforcement
for arbitrary prose, shell writes, alternate path spellings or all possible tools.

`handoff_reconcile` is a model tool for an explicit latest-user task replacement
or cancellation. Its receipt records native Handoff/user IDs, the original user
message hash, a literal quote and explanation. Old instruction quotes and
assistant/tool content cannot substitute for latest-user provenance. Receipts
are checked on branch replay and carried into later synthesis as superseded
evidence-order sources; originals remain searchable. New native compactions do
not erase that record. Completed original recovery is likewise recognized across
later Handoffs. Synthesis receives `retiredEvidenceOrderSources` for completed or
replaced one-time orders, while retaining original source content and other
constraints. A stopped/done state does not trigger the missing-search
check. Users do not need a special command or acknowledgement.

The model still decides whether the quoted latest user text actually supersedes
the old order. Source validation does not prove that semantic interpretation; a
misapplied receipt could release an obligation incorrectly. The guard is scoped
workflow reliability, not a security boundary. Branch history scanning adds work
per tool call; large-history latency has not been benchmarked in this follow-up.


## Revision 4 changes (2026-09-26)

**Historical failure policy (superseded by revision 7).** Revision 4 fell back to
one native summary for most preparation failures. Current explicit requests cancel
on every preparation failure; retry/fallback is a caller decision. The project,
excerpting and structured-step changes below remain in use.

**Project snapshot** (`project.ts`). `projectSnapshot(cwd, hints)` never throws for
size. Inline selection: paths mentioned in original conversation text (most recent
mention first), then recently modified files (changed/untracked only above 1,024
paths), within 32 KiB including a `project:inventory` source. The fingerprint does
not depend on hints, so the before/after comparison is stable. On this repository
(71 files) the snapshot takes ~35 ms; a synthetic 3,001-file Git repository took
~40 ms with only mentioned and changed files inline.

**Owner excerpts** (`task-state.ts`). `selectSources` keeps the inventory and
admits inline project files within a third of the budget. If all owner messages
do not fit the remainder, a binary search finds the largest uniform cap; longer
messages keep 60% head / 40% tail with an `[EXCERPT: …]` marker. The result lists
`excerptedOwnerMessages`; the installed summary adds their anchors under
`coverage`. `validate` still receives full originals.

**Structured steps** (`grounding.ts`, `order-guard.ts`, `state-repair.ts`). See
SPEC revision 4 §3. The synthesis prompt describes `action`/`target`; the order
guard installs from those fields only; the field patch reopens only read-only
evidence steps. The previous English regular expressions, combined-search
splitting and omitted-search rejection were removed.

**Robustness fixes (2026-09-26).**

- *Commit confirmation* (`journal.ts`). `hasCommit` streams the session file in
  1 MiB chunks. Only lines beginning with Pi's `{"type":"compaction"` prefix
  are buffered (up to 8 MiB per line) and parsed; other lines are skipped without
  retention. Malformed or torn lines are ignored. The session file has no total
  size limit here because it keeps growing after Handoff. The 8 MiB integrity
  budget still applies to `historyFingerprint` during preparation, which now
  checks the file size before reading it.
- *Incremental order guard* (`order-guard.ts`). Pi entries are append-only, and
  the active branch is the parent path of the leaf. The guard caches its replay
  state with the session ID, cwd and leaf ID. When the new leaf descends from
  the cached leaf, only the new entries are observed. Any other leaf (tree
  navigation, session switch, fork, cwd change) triggers a full replay. The live
  `tool_call` decision does not keep its bookkeeping; the call is recorded when
  its assistant message is replayed, which matches restart behavior.
- *Exact evidence search* (`evidence.ts`). Search is an exact, case-sensitive
  substring match on the original text, as documented. The preview offset
  therefore refers to the same string, and the preview window is widened by one
  code unit rather than splitting a UTF-16 surrogate pair. When no original user
  message matches, the result carries a hint that search is exact and
  case-sensitive. (The query always matches its own tool call, so a zero total
  cannot be the trigger.)
