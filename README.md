# Context-handoff

A Pi plugin that defaults to three successful native compactions, then replaces the
next compaction with an attributed Handoff in the same visible conversation.
Authorized active work continues automatically. Completed or cancelled work stays
stopped. Earlier messages and evidence remain available through original-history
search and bounded reads.

## Install

Supported runtime: **Pi 0.87.1**, Node **>=22.19.0**, Linux with persistent local
session storage outside the workspace. From a trusted local source checkout:

```sh
pi install /absolute/path/to/Context-handoff
```

Pi loads the package's TypeScript extension directly. It is a plugin, with no Skill
or Coffee Host prerequisite. Installing enables it in sessions that load the package.
This repository task does not activate it in the owner's production installation.

For a standalone artifact, build and pack, extract the tarball into a permanent
local directory, then install the extracted `package` directory with `pi install`:

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

## Behavior and limits

- The fourth **would-compact** event triggers Handoff; nothing switches immediately
  after the third success. Manual successes count too.
- Original user constraints/corrections are retained as source inputs. A small model state cites source IDs; the program binds hashes, timestamps, authority labels and supersession links. Original history and recorded project observations remain recoverable.
- Exact-value records separate labels from values and retain quoted originals. Ordered steps preserve pending/completed/uncertain status, required timing and completion evidence. These checks do not prove complete semantic coverage.
- `handoff_evidence_search` and `handoff_evidence_read` separate original search
  from verified reads; `handoff_evidence` remains compatible. Paged reads can
  satisfy supported evidence prerequisites, including after restart.
- Source-bound evidence ordering is reconstructed from committed branch history.
  Latest user replacements can release old ordering through a quoted, persisted
  `handoff_reconcile` receipt; unrelated new tasks remain usable.
- If Handoff preparation fails, the failure is shown and that boundary uses one
  native compaction; the next boundary retries Handoff. Cancellation, invalid
  flags, unsettled work and newly arriving input cancel the boundary instead.
- Large workspaces and long pasted messages degrade (mentioned files inline,
  long owner messages excerpted with recoverable anchors) rather than stopping.
- Evidence-order checks use structured step fields (`action`/`target`), not the
  wording or language of the instruction.
- Preparation, retrieval and continuation have explicit budgets and failure states.
  Third-party asynchronous tools require the documented settlement event.
- Scripted-provider acceptance demonstrates orchestration and source integrity.
  A bounded live conversation evaluation is documented separately; universal fidelity improvement is not claimed.

## Project documents

- [Specification](SPEC.md): authoritative revision 4.
- [Implementation and budgets](docs/plugin-design.md).
- [Acceptance and TDD evidence](docs/plugin-acceptance.md).
- [Domain vocabulary](CONTEXT.md).
- [Prior-art research](docs/billion-context-task-state-research.md).
- [Benchmark selection](docs/benchmark-selection-research.md) and
  [ConFiQA-derived live pilot](docs/confiqa-derived-pilot-2026-09-25.md).
- [ConflictQA-derived complete-conversation comparison](docs/conflictqa-derived-evaluation-2026-09-25.md).
- [Frozen-request diagnostic tests and product direction](docs/diagnostic-replay-2026-09-25.md).
- [Drift probe question bank (designed, not yet run)](docs/drift-probe-design.md).
- [Parent issue](http://192.168.100.1:3000/awangs/Context-handoff/issues/1).

The old `src/context`, integration snapshots and four packet tests are historical
Coffee references. The new package entry does not import them; their passing tests
are not new-plugin acceptance. [Historical status](docs/implementation-status.md)
and [provenance](provenance.json) remain available.

## Configuration

```sh
pi --handoff-native-limit 3 --handoff-output-tokens 16384 --handoff-timeout-ms 120000
```

Cadence counts committed successes on the active branch; three is a default policy,
not an experimentally established optimum. Numeric flags are validated. Generation
inherits Pi's current thinking strength, including `high`. Without budget flags,
reasoning uses up to 16,384 output tokens / 120 seconds and thinking-off uses
4,096 / 60 seconds. Model/context limits can reduce the output cap. A higher cap
allows reasoning room; it does not enlarge the concise installed task state.
Failed generation reports the specific reason and uses one native compaction for
that boundary. There is no full-generation retry. A parsed but invalid state may receive one
restricted field patch within the same deadline, followed by complete validation.
See [repair and ordering limits](docs/plugin-design.md#bounded-state-repair-and-durable-evidence-ordering).

Optional real-model acceptance from a source checkout (never run by `npm test`): set
`PI_HANDOFF_EVAL_API_KEY`, `PI_HANDOFF_EVAL_BASE_URL`, and
`PI_HANDOFF_EVAL_MODEL` in the environment, then run
`node scripts/evaluate-live.mjs /absolute/artifacts/outside/the/repository`.
This makes paid requests, uses synthetic files and records raw synthetic requests
outside Git. The script forwards requests unchanged and requires automatic
compaction, autonomous continuation, exact task results and original recovery.

For a paired comparison, run `scripts/evaluate-paired.mjs` for every scenario,
repetition and arm listed in `test/fixtures/paired-evaluation.json`; then use
`scripts/evaluate-followup.mjs` on each run directory for the common prompted
continuation. `scripts/rescore-paired.mjs` and `scripts/aggregate-paired.mjs`
produce one consistent metric summary from all saved runs. These scripts also
require the same environment credentials and an artifact directory outside Git.
`node scripts/run-paired.mjs /absolute/new/artifact/directory` runs the whole
predeclared cohort in order, keeps failures and raw traces, and writes the
aggregate. A new directory is required to prevent overwriting prior evidence.
