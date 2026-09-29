# Benchmark selection for Context-handoff

Research date: 2026-09-25. This note checks first-party papers, repositories,
dataset cards and scoring code. It selects an external source of **test items**;
none of the four benchmarks natively measures Pi's automatic, same-conversation
handoff after repeated compactions.
Inspected repository revisions: BenchPress `416ab66`, FaithEval `58d3584`,
Context-DPO/ConFiQA `557dade`, OSU ConflictQA `595e02b`, and SIGIR 2026
ConflictQA `be7f9c5`.

## Recommendation

Use **ConFiQA**, starting with its QA split and then a few MR/MC items, for the
next bounded paired Pi evaluation. The authors publish both the original and
counterfactual context and answer for each item. This makes a correction scenario
and its expected answer explicit: after an authoritative later replacement, the
agent should use `cf_answer` and avoid `orig_answer`. The official evaluation
also reports counterfactual-answer recall and original-answer recall, which is
closer to our current semantic drift failure than a generic QA score. Use a
small FaithEval inconsistent/unanswerable set later to test when the agent should
report conflict or insufficient evidence instead of forcing an answer.

Call the resulting Pi test **ConFiQA-derived**, not an official ConFiQA score:
placing original and modified contexts in successive conversation turns,
performing three native compactions and one Handoff, and asking for a final
action changes the benchmark protocol. Test native-only and Handoff arms with the
same model, thinking level, item, turn content and scoring. Report automatic
continuation, answer correctness, old-answer leakage, evidence retrieval,
latency and all model tokens separately. A small exploratory sample cannot
establish population-level superiority.

## Candidate comparison

| Candidate | First-party material and benchmark target | Fit for this project | Immediate obstacle |
| --- | --- | --- | --- |
| **BenchPress** | [lil-lab repository](https://github.com/lil-lab/benchpress), [paper](https://arxiv.org/abs/2510.20797), [dataset](https://huggingface.co/datasets/yairfeldman/benchpress): standardized compression QA over 10 datasets, contexts mostly below 1K or 8K tokens; M, EM, token F1 and teacher-normalized scores in [scoring code](https://github.com/lil-lab/benchpress/blob/main/src/benchpress/metrics.py). | Useful later as a broad information-retention check. | Single passage/question/answer; no instruction authority, correction timeline, tool use or autonomous continuation. Its substring Match metric can hide extra wrong claims, so exact answers must be checked separately. |
| **FaithEval** | [SalesforceAIResearch repository](https://github.com/SalesforceAIResearch/FaithEval), [ICLR 2025 paper](https://arxiv.org/abs/2410.03727), [dataset collection](https://huggingface.co/collections/Salesforce/faitheval-benchmark-66ff102cda291ca0875212d4): 4.9K questions with unanswerable, inconsistent and counterfactual contexts. | Strong for conflicting evidence and justified abstention. | Static QA context; contradictory documents do not specify which *user instruction* supersedes which. Its README example accepts broad substrings such as “not” for unanswerable, unsuitable as our sole scorer. |
| **ConFiQA** | Introduced by [Context-DPO authors](https://github.com/byronBBL/Context-DPO) in [the paper](https://arxiv.org/abs/2412.15280). First-party [QA/MR/MC JSON](https://github.com/byronBBL/Context-DPO/tree/main/ConFiQA) pairs original and counterfactual context/answer; [evaluation code](https://github.com/byronBBL/Context-DPO/blob/main/evaluation.py) distinguishes counterfactual and original answer recall. | Best immediate source for testing whether a later correction survives repeated compression. QA gives a simple oracle; MR/MC add reasoning and multiple changed facts. | Original task is RAG context faithfulness against parametric knowledge, not conversation correction. Pi conversion must be reported as a new protocol. |
| **ConflictQA** | Name is ambiguous. The [OSU-NLP-Group ICLR 2024 dataset](https://github.com/OSU-NLP-Group/LLM-Knowledge-Conflict) and [Hugging Face card](https://huggingface.co/datasets/osunlp/ConflictQA) model conflict between a model's answer and opposing evidence. A separate [SIGIR 2026 ConflictQA repository](https://github.com/Tianzhe26/ConflictQA) and [paper](https://arxiv.org/abs/2604.11209) provide textual/KG positive and conflicting evidence in complementary/non-complementary settings. | Both can probe evidence conflict; the 2026 version is especially relevant to multi-source reconciliation. | The two datasets are not interchangeable. The 2026 repository exposes JSON but no end-to-end scoring instructions or license in its current root; OSU's examples are model-specific memory/evidence conflicts, not instruction supersession. |

## Data and execution facts

- **BenchPress:** Repository code is [MIT licensed](https://github.com/lil-lab/benchpress/blob/main/LICENSE); its [README](https://github.com/lil-lab/benchpress/blob/main/README.md) specifies Python >=3.10, `uv sync`, `benchpress.load`, prompt preparation and scoring. The public dataset card exposes a `train` split with 32,479 rows assembled from ten third-party datasets and does not declare a license in its metadata. Rebuilding from upstream uses ten downloads and the `Qwen/Qwen3-1.7B` tokenizer. A test should pin source sample IDs and avoid describing that aggregate `train` split as an untouched held-out test set.
- **FaithEval:** Repository code is [Apache-2.0](https://github.com/SalesforceAIResearch/FaithEval/blob/main/LICENSE.txt). Its [README](https://github.com/SalesforceAIResearch/FaithEval/blob/main/README.md) uses `datasets.load_dataset` on three public `test` splits. The dataset cards currently list [1,500 inconsistent](https://huggingface.co/datasets/Salesforce/FaithEval-inconsistent-v1.0), [2,492 unanswerable](https://huggingface.co/datasets/Salesforce/FaithEval-unanswerable-v1.0) and [1,000 counterfactual](https://huggingface.co/datasets/Salesforce/FaithEval-counterfactual-v1.0) items (4,992 total). Their dataset metadata does not state a license. The repository README provides an example scorer and says a full evaluation script will be released; the example uses local Transformers inference, but the dataset can also be scored through the project's existing API harness.
- **ConFiQA:** The author's [repository README](https://github.com/byronBBL/Context-DPO/blob/main/README.md) documents QA, multi-hop reasoning (MR) and multi-conflict (MC), its JSON fields, and a Transformers evaluation command. The repository contains 6,000 JSON items per category; a [third-party HF conversion](https://huggingface.co/datasets/RajMaheshwari/ConFiQA) exposes train/test splits and marks itself MIT, but is not the author's licensing statement. The author's repository has no visible LICENSE file or declared GitHub license at research time. Keep source data out of this Git repository and cite the original item IDs/fields in results; obtain explicit reuse terms before republishing derived examples.
- **ConflictQA:** The OSU [repository](https://github.com/OSU-NLP-Group/LLM-Knowledge-Conflict) has code and data plus a LICENSE file; the official [HF card](https://huggingface.co/datasets/osunlp/ConflictQA) declares Apache-2.0 and multiple model/source configurations. The newer SIGIR 2026 [repository](https://github.com/Tianzhe26/ConflictQA) contains seven JSON collections and a schema overview, but no root LICENSE or runnable scoring script was found at research time. Do not mix its scores or examples with OSU ConflictQA.

## Proposed next Pi evaluation seam

1. Fix a small set of ConFiQA QA JSON indices and the source-file hash before
   inference; include items with distinct
   original and counterfactual answers. Inspect both contexts for accidental
   mention of both answers. Add MR/MC only after the QA path is validated.
2. Feed the original context as an early historical source. Later, introduce the
   modified context as an explicit authorized correction, with its exact source
   identity and ordering. Drive three actual successful native compactions, then
   a fourth would-compact event in the same Pi conversation.
3. Score both arms on the *same* final question without an extra continue prompt.
   Require the modified answer (or accepted alias), reject the original answer,
   and inspect whether the installed Handoff state and subsequent evidence reads
   support that outcome. Count a stopped/idle agent as an automatic-continuation
   failure even if a later prompted answer would be correct.
4. Record raw request/response artifacts outside Git, redact credentials, and
   report each item's stage failures and total input/output tokens. Keep any
   follow-up-prompt diagnostic separate from the strict score.

The benchmark items test one aspect of semantic fidelity. Exact identifiers,
completed-action order, project revision freshness and authorization still need
the project's own synthetic Pi conversation cases.
