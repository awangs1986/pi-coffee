# ConFiQA-derived Pi conversation pilot (2026-09-25)

This is an **exploratory, adapted test**, not an official ConFiQA benchmark score.
The original [Context-DPO/ConFiQA](https://github.com/byronBBL/Context-DPO)
items are static context-faithfulness questions. Here, their original passage
was supplied in an early Pi turn and their counterfactual passage was supplied
as a later owner correction. The agent then crossed three actual automatic
native compactions and a fourth would-compact boundary in one conversation.
The same item, prompts, provider, model and `high` reasoning setting were used
for native-only and Handoff arms. Every arm received exactly four user messages;
no fifth continuation prompt was used.
The provider was the owner's NewAPI endpoint, with `gemini-3.8-flash` and
`high` thinking. A deliberately high Pi reserve threshold forced automatic
compaction on this short workload; these were real threshold events but not
production-sized context windows.

The first attempted QA run was interrupted during harness development because
the counterfactual passage had been placed in the first turn. It is excluded
from the four completed runs below. Both selected items and the corrected
procedure were fixed before this completed cohort. This is a small, inspected
pilot, not a randomized or representative sample.

## Data and scoring

Source checkout: `byronBBL/Context-DPO` commit `557dadeeb9f47407890a5626128ca99907770b22`.
The author's repository had no explicit license at inspection time, so source
JSON and raw excerpts remain outside this Git repository. The item identifiers
are zero-based indices in the author's files:

| Item | Original answer | Corrected-context answer | File SHA-256 |
| --- | --- | --- | --- |
| `ConFiQA-QA.json` index 7 | Portuguese | English | `9b201a7e2f2bbf8ad8ae3364eb87c194cf5d6007789c8b5302c091fa8fae74e4` |
| `ConFiQA-MC.json` index 5 | Washington, D.C. | Jerusalem | `a058e0ca631b90bc799ddedc3bb92aea56d249c604f8a12d309cbcd4ec627994` |

The exact counterfactual answer was the semantic oracle. A strict pass also
required four successful threshold events, the intended fourth boundary type,
an unchanged Pi session ID, exactly four user messages, an intact protected
file, one-key `answer.json`, and an original-evidence search followed by a read
**after** the fourth boundary. All model requests had `reasoning_effort: high`;
all upstream responses were HTTP 200 with recorded usage and no
`response_format_error`. The proxy forwarded request bytes unchanged. Token
counts are provider-reported input plus output, including native compaction
and Handoff synthesis; billed currency was unavailable.

## Results

| Item / arm | Final answer | Fourth boundary | Post-boundary original read | Strict pass | Requests | Input + output tokens | Wall time |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| QA 7 / native | English, correct | native | No | No | 20 | 80,732 + 30,584 = 111,316 | 153.5 s |
| QA 7 / Handoff | English, correct | Handoff aborted | No | No | 17 | 143,876 + 29,705 = 173,581 | 150.4 s |
| MC 5 / native | Jerusalem, correct | native | No | No | 18 | 59,874 + 26,746 = 86,620 | 151.2 s |
| MC 5 / Handoff | Jerusalem, correct | Handoff committed | Yes | **Yes** | 17 | 85,473 + 36,971 = 122,444 | 217.8 s |

Both arms gave the counterfactual answer on both items and did not emit the
historical answer. Native-only therefore scored **2/2 semantic answers** and
**0/2 strict passes**. Handoff scored **2/2 semantic answers** and **1/2 strict
passes**. The native runs searched after the fourth compaction but repeatedly
sent anchor/read parameters with `action: search`, so neither performed the
required scoped read. Their correct answers cannot establish original-evidence
recovery. The successful MC Handoff installed active Task State, automatically
continued in the same session, searched and read the original corrected passage,
and wrote the expected answer.

QA Handoff failed closed. Its generated Task State included a labeled exact
value with an empty separator, rejected by `exactValues` as `Exact value
includes its label or differs from the quoted value`. It also marked pending
post-Handoff actions as `before_handoff`, which would fail the subsequent
procedure validator. No Handoff compaction was committed; the agent then used
the retained context and a pre-boundary evidence read to write the correct
answer. Counting that final answer as a successful Handoff would hide the
failed transition.

Across these two items, Handoff consumed 296,025 reported tokens versus
197,936 for native-only (about **1.50×**). This small pilot provides one
successful instance of same-conversation automatic Handoff with original
recovery, plus one concrete generation/validation failure. It does not establish
stable superiority or a general fidelity rate. These generated counterfactual
passages deliberately contradict world knowledge and may contain implausible
details; the test measures obedience to the later authorized passage, not
real-world factual accuracy.

## Reproduction and next work

`scripts/evaluate-confiqa.mjs` runs one item and arm through the public Pi RPC
interface. It requires `PI_HANDOFF_CONFIQA_SOURCE` to point to the author's
`ConFiQA` directory, `PI_HANDOFF_EVAL_API_KEY` in the process environment, and
an artifact directory outside Git. It defaults to the owner's NewAPI endpoint
and `gemini-3.8-flash`. Run each arm in a separate directory with, for example,
`node scripts/evaluate-confiqa.mjs /outside-git/QA-7-native QA 7 native` and
then `... QA 7 handoff`. Raw requests, responses, Pi entries and scores remain
outside Git in the local `confiqa-eval-02` artifact directory. Credentials are
not stored in the repository or report.

The next engineering target is bounded generation recovery for structurally
invalid Task State, while preserving fail-closed behavior. The continuation
prompt and evidence-tool interface also need attention because the model twice
misused `search` where `read` was required. After that, rerun more items and
repetitions, then add FaithEval's inconsistent/unanswerable cases to measure
whether the agent reports unresolved conflict instead of forcing an answer.
