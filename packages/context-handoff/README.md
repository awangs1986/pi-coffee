# Context-handoff

Version **0.2.0-experimental.1** · [Changelog](CHANGELOG.md) · [Releases](docs/releases.md).

An experimental Pi plugin for explicit, same-conversation context Handoff.
Automatic threshold/overflow compaction and ordinary `/compact` use native Pi.
Use `/handoff` and confirm the experimental notice, or the Coffee Web control
交接压缩. `/handoff version` reports the installed version. Original history and
workspace remain intact; this does not establish freedom from semantic drift.

## Install

Supported runtime: **Pi 0.87.1**, Node **>=22.19.0**, Linux with persistent local
session storage outside the workspace. From a trusted local source checkout:

```sh
pi install /absolute/path/to/Context-handoff
```

Pi loads the package's TypeScript extension directly. It is a plugin, with no Skill
or Coffee Host prerequisite. Installing exposes manual Handoff in sessions that load the package; it does not enable automatic Handoff.
This repository task does not activate it in the owner's production installation.

For a standalone artifact, build and pack, extract the tarball into a permanent
local directory, then install the extracted `package` directory with `pi install`:

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

## Behavior and limits

- Default `manual` policy only intercepts explicitly marked Handoff requests.
  Automatic compaction remains native Pi, even after many prior compactions.
- Original user constraints/corrections are retained as source inputs. A small model state cites source IDs; the program binds hashes, timestamps, authority labels and supersession links. Original history and recorded project observations remain recoverable.
- Exact-value records separate labels from values and retain quoted originals. Ordered steps preserve pending/completed/uncertain status, required timing and completion evidence. These checks do not prove complete semantic coverage.
- `handoff_evidence_search` and `handoff_evidence_read` separate original search
  from verified reads; `handoff_evidence` remains compatible. Paged reads can
  satisfy supported evidence prerequisites, including after restart.
- Source-bound evidence ordering is reconstructed from committed branch history.
  Latest user replacements can release old ordering through a quoted, persisted
  `handoff_reconcile` receipt; unrelated new tasks remain usable.
- Failed explicit Handoff is visible and cancelled without a native fallback.
  Prior active context remains; completed actions are not replayed.
- Large workspaces and long pasted messages degrade (mentioned files inline,
  long owner messages excerpted with recoverable anchors) rather than stopping.
- Evidence-order checks use structured step fields (`action`/`target`), not the
  wording or language of the instruction.
- Preparation, retrieval and continuation have explicit budgets and failure states.
  Third-party asynchronous tools require the documented settlement event.
- Scripted-provider acceptance demonstrates orchestration and source integrity.
  A bounded live conversation evaluation is documented separately; universal fidelity improvement is not claimed.

## Project documents

- [Specification](SPEC.md): authoritative revision 6.
- [Implementation and budgets](docs/plugin-design.md).
- [Acceptance and TDD evidence](docs/plugin-acceptance.md).
- [Domain vocabulary](CONTEXT.md).
- [Prior-art research](docs/billion-context-task-state-research.md).
- [Benchmark selection](docs/benchmark-selection-research.md) and
  [ConFiQA-derived live pilot](docs/confiqa-derived-pilot-2026-09-25.md).
- [ConflictQA-derived complete-conversation comparison](docs/conflictqa-derived-evaluation-2026-09-25.md).
- [Frozen-request diagnostic tests and product direction](docs/diagnostic-replay-2026-09-25.md).
- [Drift probe question bank](docs/drift-probe-design.md) and
  [first live cohort and quota interruption](docs/drift-probe-live-2026-09-26.md).
- [Complete Muse medium live comparison](docs/drift-probe-muse-medium-2026-09-26.md).
- [ABCD 250k comparison method](测试方法.md) and
  [completed diagnostic pilot report](docs/abcd-250k-pilot-2026-09-27.md) (all 16 planned
  case/arm combinations have terminal records; no overall comparison is claimed).
- [Pi 0.87.1 native compaction source snapshot](integrations/pi-native-compaction/README.md)
  for side-by-side inspection; the A arm executes the pinned Pi package.

The old `src/context`, Pi-Coffee integration snapshot and four packet tests are historical
Coffee references. The new package entry does not import them; their passing tests
are not new-plugin acceptance. [Historical status](docs/implementation-status.md)
and [provenance](provenance.json) remain available.

## Configuration

```sh
pi --handoff-trigger manual --handoff-output-tokens 16384 --handoff-timeout-ms 120000
```

The following cadence settings only apply with explicit `--handoff-trigger cadence`
for historical research, never in the default manual policy. Cadence counts committed successes on the active branch; three is a default policy,
not an experimentally established optimum. Set `--handoff-native-limit 0` to use
Handoff at the first and every later compaction boundary; the default remains 3.
Numeric flags are validated. Generation
inherits Pi's current thinking strength, including `high`. Without budget flags,
reasoning uses up to 16,384 output tokens / 120 seconds and thinking-off uses
4,096 / 60 seconds. Model/context limits can reduce the output cap. A higher cap
allows reasoning room; it does not enlarge the concise installed task state.
Failed explicit manual generation reports the specific reason and cancels. Only
the historical cadence policy uses one native fallback. There is no full-generation retry. A parsed but invalid state may receive one
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
