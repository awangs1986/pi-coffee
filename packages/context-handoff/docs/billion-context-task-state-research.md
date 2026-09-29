> Source research preceding SPEC revision 2. Its recommendations are research
> findings, not approval to add a fold ladder before native compaction.
> The new-plugin contract in SPEC.md governs implementation.

# billion-context-pi: task-state and recovery research

Date: 2026-09-24. Scope: static inspection of commit
`fd8095e69ca3317b52fb58adccf9745a3dc18dfa` (`0.1.77`). No upstream code,
builds, tests, model calls or deployment were run. SPEC.md is unchanged.

## Findings

1. **It is model-written, hierarchical lossy summarization with recoverable
   originals.** `compress` accepts a free-text summary and contiguous boundaries;
   the adapter asks the agent to supply that summary. Higher-tier compression
   consumes earlier summaries. This is relevant to improving selective summaries,
   but does not eliminate summary-of-summary loss.
   Sources: [src/compress-tool.ts:24-43](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/compress-tool.ts#L24-L43),
   [src/system-prompt.ts:56-65](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/system-prompt.ts#L56-L65).

2. **Its task-state guidance is useful but prompt-based.** The committed default
   prompt fixture prioritizes user goal, goal evolution, hard constraints, decision
   rationale and exact source refs. It asks dropped material to receive a content
   description so later retrieval can find it. T2 asks for supersession markers;
   T3 explicitly drops obsolete/superseded contents and most rationale, and targets
   30–60 tokens per source block. These are authored policy instructions, not proof
   of their faithful execution or an independently validated task-state ledger.
   The adapter fills these rule slots from the pinned kernel prompts; the fixture
   is the repository's expected default prompt, not a fresh runtime observation.
   Sources: [tests/fixtures/pi-system-prompt-default.txt:50-83](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/tests/fixtures/pi-system-prompt-default.txt#L50-L83),
   [tests/fixtures/pi-system-prompt-default.txt:91-155](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/tests/fixtures/pi-system-prompt-default.txt#L91-L155),
   [src/system-prompt.ts:93-102](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/system-prompt.ts#L93-L102).

3. **Historical attribution is recognized, but quote verification is weak.** The
   system prompt labels summaries historical and potentially erroneous and asks
   for decompression of critical details. Its blanket requirement for CURRENT user
   confirmation before acting on summarized instructions would need adaptation to
   our authorized task-continuation semantics. The quote detector only checks
   a few phrases and the presence of any `mNNNNN` ref anywhere in a summary; a
   matching ref bypasses detection. Missing refs produce a log warning, not a
   rejection or source-text comparison. This does not establish quote accuracy,
   effective supersession or the truth of completed-work claims.
   Sources: [src/system-prompt.ts:24-31](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/system-prompt.ts#L24-L31),
   [src/summary-sanitize.ts:53-78](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/summary-sanitize.ts#L53-L78),
   [src/compress-tool.ts:458-474](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/compress-tool.ts#L458-L474).

4. **Do not describe its search as summary-only.** The actual adapter builds search
   documents from all active/inactive blocks AND original session messages covered
   by any block. It preserves message role and links the hit to an owning block.
   Therefore an exact older correction omitted from a summary can still be found
   in the raw historical message. Uncovered messages are deliberately excluded as
   already visible. The adapter passes keyword queries and a result limit to the
   kernel. It does not itself guarantee exhaustive recall or that the model knows
   which omitted condition to search for. Kernel ranking internals were outside
   this subtask's inspection.
   Sources: [src/search-index.ts:23-40](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/search-index.ts#L23-L40),
   [src/search-index.ts:58-94](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/search-index.ts#L58-L94),
   [src/search-tool.ts:10-13](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/search-tool.ts#L10-L13),
   [src/search-tool.ts:44-79](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/search-tool.ts#L44-L79).

5. **Recovery offers valuable granularity.** A message ref restores that original
   message text; a block restores one tier by default, with `full:true` requesting
   original messages through nested tiers. Blocks stay folded. Large recovered
   bodies go to files, with a 600-character preview; single-message recovery goes
   to a file at 2,000 characters. Block recovery attempts missing refs through the
   full session tree. These are good examples for CF-03. However, these functions
   resolve through the current Pi session manager; they do not demonstrate our
   Conversation-scoped recovery across independently created Handoff successors.
   Sources: [src/decompress-tool.ts:18-47](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/decompress-tool.ts#L18-L47),
   [src/decompress-tool.ts:134-174](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/decompress-tool.ts#L134-L174),
   [src/decompress-tool.ts:177-218](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/decompress-tool.ts#L177-L218),
   [src/decompress-tool.ts:221-285](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/decompress-tool.ts#L221-L285).

6. **Important older user messages still need deliberate protection.** The
   detailed README promises hard protection for the last user message, while
   the system prompt asks the model to exclude important user messages from
   compression. That does not establish hard protection for every historical
   correction. Kernel hard-protection implementation was not inspected here.
   Sources: [README.md:254-261](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/README.md#L254-L261),
   [src/system-prompt.ts:50-54](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/system-prompt.ts#L50-L54).

## Evidence limits in its paper

The paper itself records substantial limits. The pilot used qwen3.8-27b at
temperature 0; the main auto-compaction baseline never fired; no pilot round
exercised T2+; and a quiescent-compression control reproduced the re-fetch benefit
with doctrine plus tags alone. The paper attributes that benefit to the bundle,
not compression targeting in isolation. Its restore probe succeeded 6/6 when
instructed, while spontaneous restoration was zero at that model scale.
Sources: [paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md:234-267](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md#L234-L267).

The 28.6B single-session figure is modeled cumulative input including cache
re-reads, about 19 times beyond the largest observed session. It is not a model
context-window size or a measure of preserved semantic information. The paper
labels its data single-user and observational, with multi-model and deeper
quality evaluations pending.
Sources: [paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md:222-230](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md#L222-L230),
[paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md:278-294](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md#L278-L294).

## Integration observations

The adapter cancels Pi native compaction when it owns the host. Its Pi path
loads persisted entries rather than using the optional live-message projection,
rebuilds outgoing messages, and removes orphan tool results after compression.
These mechanisms need an explicit compatibility check with Coffee ingress and
request projections before reuse. They do not establish that directly enabling
both plugins preserves Coffee's admitted evidence view.
Sources: [compaction interception](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/index.ts#L185-L192),
[Pi state source](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/runtime.ts#L638-L646),
[outgoing reconstruction](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/index.ts#L609-L618),
[pair cleanup](https://github.com/ranxianglei/billion-context-pi/blob/fd8095e69ca3317b52fb58adccf9745a3dc18dfa/src/index.ts#L799-L809).

## Recommendation for Context Handoff

For the current accepted scope, retain context-fold as the primary reference
for deterministic stale-evidence folding, and study billion-context-pi as an additional source for original-message search,
message/block recovery, summary attribution, purpose/goal-preservation rules,
and recovery discovery hints. Task-phase organization and provider-aware cache
accounting are also useful topics for a separately scoped implementation study. Its richer summarization doctrine complements
context-fold's smaller deterministic masking/index mechanisms. Do not infer
that multi-tier summarization resolves HF-01–HF-05: reliable older-correction
selection, per-claim authority/supersession, project-fact reconciliation and
cross-successor recovery remain our design work. This note proposes learning
priorities, not a measured performance ranking, and does not accept or activate a new runtime architecture.
