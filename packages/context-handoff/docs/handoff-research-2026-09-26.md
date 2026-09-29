# Context Handoff: fresh-context handoff against drift

Researched and scope-corrected: 2026-09-26. Research only; no paid model calls, plugin changes, deployment or SPEC changes.

## Corrected question

The owner asks whether **handing the same task to a fresh active context can counter goal, constraint and progress drift**. This is a question about context reset and the successor's reconstruction of intent and work. It is not primarily a question about how many compactions to permit, choosing compression thresholds, or routing between specialist agents. The earlier broader compaction survey and saved-test audit are preserved in Appendix A; they must not stand in for answering this narrower question.

Targeted discovery included public searches for “fresh context handoff agent drift,” “context reset handoff,” “session handoff context rot,” “ralph fresh context,” and “handoff drift,” followed by first-party articles and implementation files. Ordinary Google responses were access challenges rather than usable results; GitHub repository search and first-party page retrieval provided usable sources. No search-generated answer was treated as evidence. Several small repositories claim “zero drift” without a controlled evaluation; those claims are not a basis for this report.

## Answer

There is direct first-party engineering experience supporting fresh-context handoff as a remedy for some forms of long-task drift. Cursor explicitly describes periodic fresh starts to combat drift and tunnel vision. Anthropic describes clearing the entire context and handing structured state to a fresh agent as important for Sonnet 4.5, where compaction alone did not solve coherence and premature stopping. Amp ships task-directed handoff into a new thread. The architecture is therefore credible and practiced.

The same sources also limit the claim: handoff needs a sufficient, accurate transfer artifact; fresh context can lose unfinished reasoning and constraints; and gains depend on the model and task. Anthropic later removed resets when Opus 4.5 no longer exhibited the same problematic behavior. None of the reviewed sources supplies a controlled, general-purpose estimate of how much **reset alone** reduces goal or constraint drift in Pi. We should not replace “unproven” with “disproven,” or with “guaranteed.”

## Five directly relevant primary sources

### 1. Anthropic: explicit reset versus compaction, including a counterexample

Source: [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps), retrieved 2026-09-26. The available page text did not expose a reliable publication date.

The article defines context resets as clearing the context window entirely and starting a fresh agent, combined with a structured handoff carrying state and next steps. It says this addresses loss of coherence and “context anxiety,” where the model wraps up prematurely as it approaches what it believes is its limit. It distinguishes this from in-place compaction and reports that Sonnet 4.5 needed resets in the earlier harness.

Equally important, its full-stack section says Opus 4.5 largely removed that behavior, allowing the author to drop context resets entirely and use a continuous session with SDK automatic compaction. Resetting added orchestration complexity, token overhead and latency. The newer work also uses a planner and an independent evaluator; their gains must not be attributed to resets that had already been removed.

**What transfers:** carry the current task state and next steps into a genuinely refreshed input; identify the failure mode the reset is meant to remedy. **What is demonstrated:** a specific team's model-dependent engineering experience. **What is not demonstrated:** a universal advantage or an isolated reset-versus-no-reset statistical trial.

### 2. Anthropic autonomous-coding: concrete successor reconstruction protocol

Sources: [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) and [autonomous-coding implementation](https://github.com/anthropics/claude-quickstarts/tree/dee71163217524eed07d79d00ffea5a7d02cedda/autonomous-coding). Source pinned to `dee71163217524eed07d79d00ffea5a7d02cedda`, committed 2026-09-24 21:44:54 UTC. This is a source snapshot date, not the article's publication date.

[`agent.py`](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/autonomous-coding/agent.py) creates a fresh client inside each iteration, chooses the initializer or coding prompt, runs that session, and automatically continues. The next agent does not depend on carrying the entire conversational trajectory forward.

The [`coding_prompt.md`](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/autonomous-coding/prompts/coding_prompt.md) starts by saying this is a fresh context with no memory. It requires the successor to:

1. Read `app_spec.txt`, the full project requirements.
2. Read the feature list, progress notes and recent Git history.
3. Check 1–2 core features previously marked passing before new work.
4. Choose one pending feature, implement and verify it.
5. Update completion status only after verification, commit progress, and leave a progress note for the next session.

This separates stable requirements, mutable progress, actual project artifacts and verification. Its original article identifies concrete failures: premature completion, unfinished or undocumented work, and false completion claims. **The useful mechanism is fresh context plus reorientation against durable evidence.** Copying a summary without this reconstruction step is not equivalent to the complete method. The source is an inspectable implementation, not a guarantee its prompted verification is always faithfully executed.

### 3. Cursor: fresh starts explicitly used against drift and tunnel vision

Source: [Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents), published 2026-01-14.

Cursor describes planners, workers and a judge. At the end of each cycle the judge decides whether to continue, and the next iteration starts fresh. It explicitly concludes: “We still need periodic fresh starts to combat drift and tunnel vision.” It also reports agents running too long, coordination failures, and the fragility of excessive structure.

**What transfers:** bound the worker's task, assess actual progress externally, then restart the next work period from a clear task rather than accumulating the entire old trajectory. **Evidence strength:** first-party operational experience across long-running projects with public artifacts linked. **Limit:** a multi-agent system with many simultaneous interventions; it does not specify a complete rollover packet or isolate the quantitative effect of resetting context. Its model comparisons are also part of the reported explanation.

### 4. Amp: next-task handoff with a reviewable continuation prompt

Source: [Handoff (No More Compaction)](https://ampcode.com/news/handoff), published 2025-10-23.

Amp says it replaced compaction with handoff to encourage focused threads rather than long meandering histories. The user supplies the next goal; Amp extracts relevant context and files, then puts a generated prompt into a new thread as a draft for review and editing. Its distinction is task-directed extraction: “Instead of summarizing a thread, you're extracting from it what matters for your next task.”

**What transfers:** write the successor's task explicitly, carry relevant files and rationale, and distinguish historical exploration from instructions for the next stage. **Important mismatch:** Amp's documented flow gets the next goal and a review opportunity from a human. Our seamless plugin must preserve the already authorized goal without relying on that human correction. The article is product experience and design rationale, not a measured zero-drift guarantee. Starting a new visible thread is its interface choice, not a necessary property of a fresh model context.

### 5. Ralph: external task state with a fresh instance each iteration

Sources: [snarktank/ralph README](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/README.md), current main snapshot `6c53cb0b831ebe8739c6a003e22af14902d8b0b5`, committed 2026-02-02 01:46:21 UTC, and the original author's [Ralph pattern](https://ghuntley.com/ralph/).

The implementation's README explicitly says each iteration starts a fresh instance with clean context. Memory persists in Git, `progress.txt` and `prd.json`. The loop chooses one pending story, implements it, runs checks, commits successful work, updates its status, appends learnings, and repeats. It stresses that tasks must fit in one work period and that feedback through tests is essential.

The original author's account also acknowledges bad directions and mistaken judgments that code was not implemented. Fresh context does not eliminate reasoning mistakes. **What transfers:** stable task definitions, durable lessons, small next objectives and external success checks. **Limit:** published workflow and examples, not a controlled preservation-of-user-constraints benchmark. Model-maintained progress or learned rules can themselves be wrong or stale.

## Implications for Context-handoff

The useful common pattern is:

> Preserve authoritative task requirements and durable project evidence → settle and record current progress → build a focused successor context → reread the requirement and verify relevant current facts → continue the next authorized step.

The reset can reduce the influence of obsolete exploration, failed hypotheses and premature stopping cues. This is a plausible explanation consistent with the engineering reports, not a claim that resetting clears an invisible persistent model mind. The relevant intervention is the content and structure of the next model request. A new physical session ID alone proves nothing; the same visible conversation can still install a fresh active context.

Our existing plugin already has original-source task state, source anchors and project observations. It is inaccurate to say that it has no handoff mechanism. However, the current extension returns a custom compaction result with `firstKeptEntryId` taken from Pi's preparation, and automatic continuation supplies the pending next action. That does not by itself establish equivalence to the fresh-context successor protocols above. The outgoing request needs to show what historical messages actually survived and whether the successor receives and performs sufficient reorientation.

The design questions to answer next are about the transition, not its frequency:

- Which original goal, latest corrections, prohibitions and cancellations must enter the successor directly, and which older exploration should remain available only through retrieval?
- Which fields are observed project facts, which are model interpretations, and which completion claims require rechecking?
- Does the successor reread the authoritative task and the few decisive artifacts before committing to the proposed next action, with bounded cost?
- Can the protocol resume the same authorized work without manufacturing new permission requests or reviving cancelled work?
- Can we compare a focused fresh-context handoff against ordinary continuation from the **same pre-transition state**, then inspect whether goal/constraint/progress mistakes actually decrease?

A useful diagnostic comparison would separate current custom-summary Handoff, a focused successor context with the same evidence tools, and native continuation. Input-content differences must be recorded, since “fresh session” and “same session” labels alone do not isolate the mechanism. This proposes a question to test; it does not launch another paid evaluation or alter accepted scope.

## Evidence limits and source access

The direct handoff evidence supports continuing to investigate this design. It does not establish that reset always helps, that a more elaborate packet is better, or that native compaction can never provide equally focused context. Anthropic's later removal of resets is material counterevidence to a universal claim and should be retained when presenting the recommendation.

Anthropic and Cursor origin pages were retrieved as public text using `https://r.jina.ai/` followed by the original URL when direct access failed. Source citations point to the first-party originals. GitHub raw files and commit metadata were retrieved directly. No third-party code was run and no success claim was inferred from stars, branding, or repository descriptions.

---

# Appendix A: earlier compaction survey and cohort audit

The material below is retained for provenance and workload context. It is secondary to the corrected fresh-context handoff question above; its count and threshold discussion is not the primary research answer.

# Context Handoff: current approaches and evaluation scope

Researched: 2026-09-26. Status: research and proposed evaluation design, not a SPEC revision or authorization for new paid runs. No model API was called. First-party documentation and source were inspected; upstream implementations were not executed. Repository head reviewed: `63a85b83fe06178a2b2540c0922d3edf20765eb6`.

## Conclusions

The project's central combination—compact current task state, durable originals, attributed recovery, and continuation across context boundaries—is consistent with current approaches. It has not become obsolete. However, neither the sources below nor our evaluation establishes that replacing precisely the fourth compaction is optimal, that a complex model-generated schema is necessary, or that repeated compaction always degrades quality monotonically.

The owner's high-occupancy objection is valid. Our previous cohort exercises repeated compaction, but mainly over small active contexts. It cannot reject the hypothesis that Handoff helps after several genuinely large work cycles. Existing fallback and continuation failures remain real implementation evidence; the missing workload coverage does not erase them.

## Primary sources, checked now

### 1. Anthropic: current compaction API and engineering guidance

The current [compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction) documents on-demand compaction with the `compact-2026-09-04` beta header, keeping recent turns verbatim, background compaction, custom summarization prompts, and repeated compaction. It distinguishes on-demand, threshold-triggered, and client-managed summarization. This is live September 2026 documentation, not merely an older generic article. It does not prescribe a universal number of compactions before a reset.

[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) describes compaction, structured notes outside the context, lightweight identifiers with just-in-time retrieval, and a hybrid of upfront context plus subsequent retrieval. It recommends tuning compaction on complex traces, first maximizing recall and then removing irrelevant material. It also warns against brittle overly prescriptive prompts and says retrieval requires tools and guidance: storing an original does not guarantee the agent will find it.

[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) explicitly says compaction alone is insufficient for its long-running development workload. Its concrete solution uses a durable feature list, progress file, Git state, incremental work, and verification of the working environment on subsequent sessions. This supports checking actual project state and remaining work rather than trusting a narrative summary alone. It is a particular web-development harness, not a comparative proof that its pattern improves every agent.

Direct origin requests to these Anthropic pages returned HTTP 403 here. Their public text was retrieved using `https://r.jina.ai/` followed by the official URL. Citations identify the original source. The two engineering-page extracts did not expose a reliable publication date; their retrieval date is recorded rather than inventing a new publication date.

**Implication:** our architectural ingredients fit; stronger emphasis on durable state and preserved recent turns is worth evaluating. Same visible conversation is a product requirement and does not conflict with rebuilding internal active context. Delegating control to another specialized agent, also commonly called “handoff,” is a different question from the context rollover studied here.

### 2. context-fold: current 0.6.0

Inspected current main commit [`cc178a7ef66da1e98748f429a4bd89c9946dd2a8`](https://github.com/Middlewatch/context-fold/commit/cc178a7ef66da1e98748f429a4bd89c9946dd2a8), committed 2026-09-25 19:40:35 UTC, release 0.6.0. Source: [README at that commit](https://github.com/Middlewatch/context-fold/blob/cc178a7ef66da1e98748f429a4bd89c9946dd2a8/README.md).

Its documented current design:

- Fold stale tool results and available thinking outside a protected recent tail; do not mask user messages, assistant text, or tool calls in the per-turn ladder.
- Keep originals in Pi's session ledger with identity/hash-checked recall.
- At hard compaction, default to a deterministic verbatim index re-extracted from active-branch originals; old narrative summaries are archival, not the sole input to automatic summaries.
- Warn after a second forced compaction and recommend a handoff at a task finish line. These are project defaults; its README explicitly says its thresholds are not tuned constants.
- `/fold-handoff` writes a seed and optionally opens a replacement visible session after confirmation; that session is idle until the user types. This differs from our accepted seamless automatic continuation requirement.

The README also discloses that its bounded seed may omit recent unindexed work and that old fold handles do not directly resolve in the new session; the parent files remain available. Thus “reversible” describes source recovery, not guaranteed preservation of task understanding.

**What to learn:** deterministic extraction of paths, identifiers and originals; exact source anchors; protecting recent turns; observing actual on-wire context and cache effects. The manual handoff workflow is not a ready-made implementation of our product contract. Its warning after two compactions is not evidence that our three-compaction policy is right or wrong.

### 3. billion-context-pi: current 0.1.81 and paper limitations

Inspected current master commit [`c12994346ed456e98f352d28a16c63825d2da208`](https://github.com/ranxianglei/billion-context-pi/commit/c12994346ed456e98f352d28a16c63825d2da208), committed 2026-09-26 12:08:04 UTC, release 0.1.81. This is newer than the 0.1.77 snapshot in our earlier research note. Sources: [README](https://github.com/ranxianglei/billion-context-pi/blob/c12994346ed456e98f352d28a16c63825d2da208/README.md) and [paper, especially sections 7–8](https://github.com/ranxianglei/billion-context-pi/blob/c12994346ed456e98f352d28a16c63825d2da208/paper/model-driven-incremental-hierarchical-compression-training-free-multi-generational-context-management-for-long-lived-coding-agents.md).

The design offers model-directed incremental compression, message references, search/decompression, and multiple summary tiers. It emphasizes a bounded active working set and task-phase preservation rather than periodic wholesale reset. Its large cumulative-token figures count many requests, including reread/cache input; they are not simultaneous context capacity or a measured quantity of perfectly retained knowledge.

The paper's controlled pilot explicitly reports that its main native auto-compaction arm never fired. It also reports a control where doctrine plus reference tags reproduced the re-fetch benefit without compression. Its phase-structured workload changes which compression policy performs best. These disclosures matter: a headline from an inactive baseline or one workload cannot establish superiority for repeated saturated Pi contexts. Our revised experiment should avoid the same confounding.

**What to learn:** protect current task phases, make omitted material discoverable, measure cumulative work separately from current occupancy, and evaluate actual trigger activity. Hierarchical summaries remain model-generated selection, not a guarantee against drift.

### 4. Recent research and evaluation methods

[Self-Compacting Language Model Agents](https://arxiv.org/abs/2606.23525v2), submitted 2026-06-22, revised 2026-07-10, studies six math/search benchmarks across seven models. Its SelfCompact combines a model-invoked summary tool with a rubric favoring resolved subtasks and suppressing compaction mid-derivation or when stuck. The authors report improvements over fixed-interval summarization. This supports testing task-phase timing rather than assuming a fixed count alone defines the right boundary. It is not a Pi coding benchmark or proof of a universal optimum.

[The Complexity Trap](https://arxiv.org/abs/2508.21433v3), revised 2025-10-27, compares observation masking and summarization in SWE-agent on SWE-bench Verified and probes OpenHands. It reports masking with lower cost and similar solve rates, plus a useful hybrid. This supports retaining a simpler masking/retrieval baseline; it does not prove all rich state representations fail on long histories.

Factory's [Evaluating Context Compression for AI Agents](https://factory.ai/news/evaluating-compression), published 2025-12-16, proposes recall, artifact, continuation and decision probes on identical pre-compression conversation prefixes. It reports structured persistent summaries and weak artifact tracking even in its best arm. Its product-authored comparison uses an LLM judge and private production traces, so treat the methodology as useful and the reported ranking as scoped evidence, not independent proof for our plugin.

### 5. Current Pi behavior matters to the baseline

Current upstream Pi commit [`2b0a123de98318c2ff8069661721ce0c3794c34e`](https://github.com/earendil-works/pi/commit/2b0a123de98318c2ff8069661721ce0c3794c34e), committed 2026-09-26 12:37:30 UTC: [compaction documentation](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/compaction.md).

The current documentation describes structured summaries, the previous summary supplied as iterative context, and a default 20,000-token recent tail. The next summarized span starts at the prior kept boundary, so retained messages can participate in the next summary. This is more specific than “it just summarizes the summary.” Our previous cohort set `keepRecentTokens: 0`, which is an aggressive experimental condition and differs from the documented default. This current upstream source is a research reference; the cohort used the pinned Pi 0.87.1 runtime. Do not silently upgrade the runtime for a comparison.

## What the existing cohort did and did not test

A separate read-only audit of the saved Muse cohort in this task found:

- Intended schedules were seven native boundaries (`NNNNNNN`) versus three native, one Handoff, then three native (`NNNHNNN`). It was not a one-compaction comparison.
- Compaction was requested manually after each of seven turns; automatic compaction was disabled and the recent tail set to zero.
- The harness declared a 131,072-token context window. Across 3,172 requests reporting usage, maximum reported prompt input was 101,946 tokens; no request reached 200,000, let alone 250,000.
- Among 2,162 agent requests, median reported input was 3,755 tokens. Excluding the long-message D10 case, maximum agent input was 47,333 tokens. These are request occupancy, not total session token consumption.
- The plugin separately caps preparation sources at at most 94,000 bytes and synthesis JSON at 98,304 bytes. Raising a model window declaration does not make the Handoff synthesizer read a full 250,000-token history. Selection, excerpting and discovery must be evaluated explicitly.

Sources: local `scripts/evaluate-drift.mjs`, `src/plugin/extension.ts`, and saved synthetic requests in `the external evaluation artifact directory for this cohort`. Raw traces remain outside Git. Fine-grained request-kind labels can confuse restricted repair with native summarization; aggregate counts above use reported usage and distinguish that limit.

## Proposed experiment: test the actual hypothesis

1. Use one pinned model, route and Pi version. Check the route's real context support and usage semantics. A 250,000-token input needs headroom for system/tool context and output. Public model metadata alone does not establish the proxy route's limit.
2. Build meaningful work cycles. Each cycle adds new specifications, decisions, corrections, tools and project evidence until active input is near the declared target. Do not repeatedly compact a tiny summary or pad one repeated blob.
3. Produce a common checkpoint after three native compactions. Add the same next work to reach the fourth large boundary, then fork identical state: A performs native compaction four; B performs Handoff. Keep the same tool availability if isolating the Handoff layer. A separate stock-Pi arm measures the whole plugin's product benefit.
4. Keep recent-turn retention and output budgets equal or explicitly report differences. Record actual provider input usage, compaction count, selected/excerpted source coverage, state size, retrieved originals, fallback, task correctness, latency and total tokens per task.
5. Probe original constraints, mid-history corrections, cancellation, exact values, decision rationale and pending actions after boundaries 1, 3 and 4. Run probes on separate checkpoint copies so their questions/answers do not remind the ongoing agent of the facts. Add boundary 8 to exercise two Handoff cycles if the first stage yields usable evidence.
6. Include a smaller occupancy condition and 250,000 as the target workload condition. A 250,000-token request on a million-token model is a chosen workload size, not saturation of its physical window. These two axes—absolute input size and fraction of supported window—must be reported separately.
7. Include an uncompressed full-history control only where it genuinely fits the route's context. Across multiple 250,000-token cycles the original transcript can exceed even a million-token window. A same-boundary uncompressed probe can separate information already inaccessible in a long prompt from information removed by compression, but cannot be claimed as an unlimited end-to-end baseline.

The decision should be based on whether Handoff prevents reproducible errors under this workload at acceptable reliability and cost. The current evidence warrants fixing evaluation scope before deciding to abandon the project; it does not warrant promising that larger contexts will make Handoff win.
