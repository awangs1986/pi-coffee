# Context Handoff

Vocabulary for retaining a task's meaning while reducing its active context.

**Folding**:
Replacing older evidence in active context with a compact record and a reference
to recoverable source material.
_Avoid_: lossless understanding, summary compaction

**Summary Compaction**:
Replacing a broader portion of active conversation history with a shorter
model-generated account. Information selection makes this lossy.
_Avoid_: folding, Handoff

**Handoff**:
Preparing and installing attributed current-task context so the agent can
continue the same authorized work within one visible Conversation.
_Avoid_: context-fold, generic memory

**Task State**:
The current objective, effective constraints and corrections, confirmed decisions,
completed and remaining work, uncertainties and next action.
_Avoid_: keyword index, transcript

**Evidence Anchor**:
A reference identifying the original source and the exact extent of evidence
that can be recovered and checked.
_Avoid_: proof of semantic correctness

**Conversation**:
The stable user-facing task, retaining its Workspace and history across
internal context replacements.
_Avoid_: individual model request

**Session Segment**:
A native Pi session contributing to one Conversation if the implementation
uses internal session replacement.
_Avoid_: new task, new checkout


**Evidence Record**:
Program-owned source identities, integrity hashes, observation timestamps and
read-only project snapshots committed with a Handoff in native session history.
Model Task State cites this evidence; historical observations are not current
verification and reference integrity does not prove semantic entailment.


**Evidence Order Obligation**:
A supported pending search/read prerequisite derived from committed Task State.
Its progress is reconstructed from successful active-branch tool observations.
_Avoid_: universal action authorization, semantic correctness proof

**Task Change Receipt**:
A native session record binding a model-interpreted replacement of evidence
ordering to a quote from the latest original user message and its hash.
_Avoid_: mechanically verified user intent, permission to restart old work
