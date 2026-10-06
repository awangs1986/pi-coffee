> Canonical source: [pi-coffee/packages/context-handoff](https://github.com/awangs1986/pi-coffee/tree/main/packages/context-handoff). Version `0.2.0-experimental.6`. Start with the [repository map](https://github.com/awangs1986/pi-coffee/blob/main/REPOSITORIES.md) and [release/install guide](https://github.com/awangs1986/pi-coffee/blob/main/docs/releases/README.md). The standalone repository is historical.

# Context-handoff

Version **0.2.0-experimental.6** · [Changelog](CHANGELOG.md) · [Releases](docs/releases.md).

An experimental Pi plugin for explicit, same-conversation context Handoff.
Automatic threshold/overflow compaction and ordinary `/compact` use native Pi.
Use `/handoff` and confirm the experimental notice, or the Coffee Web control
交接压缩. `/handoff version` reports the installed version. Original history and
workspace remain intact; this does not establish freedom from semantic drift.

## Install

Requires Node >=22.19.0 and Pi 0.99.1 or 1.0.x. From a pinned checkout of
[pi-coffee](https://github.com/awangs1986/pi-coffee), build this package and register
its directory with Pi:

```sh
cd packages/context-handoff
npm ci
npm run check
pi install /absolute/path/to/pi-coffee/packages/context-handoff
```

For the built artifact tagged `context-handoff/v0.2.0-experimental.6`, follow the
[shared install and release guide](../../docs/releases/README.md). Install the
verified tarball with npm into a permanent plugin directory, then use `pi install`
on that installed package directory. Public npm-registry publication is separate.
Keep exactly one registered copy; remove the previous registration before switching.

Installing exposes manual Handoff; automatic compaction remains native Pi.
Persistent session storage stays outside the workspace. Installing or publishing
this package does not deploy a Coffee Host.

## Behavior and limits

- Host owns enablement and invocation. The plugin only intercepts explicitly marked Handoff requests.
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

- [Specification](SPEC.md): authoritative revision 7.
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
- [Pi 0.99.1 native compaction source snapshot](integrations/pi-native-compaction/README.md)
  for side-by-side inspection; the A arm executes the pinned Pi package.

The old `src/context`, Pi-Coffee integration snapshot and four packet tests are historical
Coffee references. The new package entry does not import them; their passing tests
are not new-plugin acceptance. [Historical status](docs/implementation-status.md)
and [provenance](provenance.json) remain available.

## Host integration

Host chooses whether to load this independent package and when to send its public
`HANDOFF_REQUEST` through Pi RPC. The plugin has no compression counter, automatic
trigger, retry schedule or continuation queue. See [the integration contract](docs/host-integration.md)
for success validation, failure handling and migration. Existing Host callers keep
the same protocol; consuming the new artifact requires a separate Host upgrade.

## Configuration

```sh
pi --handoff-output-tokens 16384 --handoff-timeout-ms 120000
```

Only synthesis budget flags are supported. Generation
inherits Pi's current thinking strength, including `high`. Without budget flags,
reasoning uses up to 16,384 output tokens / 120 seconds and thinking-off uses
4,096 / 60 seconds. Model/context limits can reduce the output cap. A higher cap
allows reasoning room; it does not enlarge the concise installed task state.
Failed generation reports the specific reason and cancels. The caller decides whether
to retry or request native compaction. There is no full-generation retry. A parsed but invalid state may receive one
restricted field patch within the same deadline, followed by complete validation.
See [repair and ordering limits](docs/plugin-design.md#bounded-state-repair-and-durable-evidence-ordering).

## Historical evaluations

The recorded question banks, transcripts' synthetic fixtures, scorers and reports
remain available. `evaluate-live.mjs`, `evaluate-paired.mjs`, `evaluate-drift.mjs`
and `evaluate-abcd.mjs` assume the retired plugin-owned cadence and now stop before
creating provider requests. Batch wrappers cannot produce a current-contract comparison with these runners. Reproduce
old experiments from the exact revision recorded in the corresponding report.

A new comparison must put the A/B/C/D schedule in its driver, issue explicit
Handoff requests and validate committed outcomes; it must not reintroduce cadence
inside this plugin. No new live evaluation was performed for revision 7.
