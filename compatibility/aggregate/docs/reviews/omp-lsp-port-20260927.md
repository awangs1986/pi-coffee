# OMP LSP port: local acceptance, 2026-09-27

Source base: Pi main `0278a99d1a83084113afa057467e7271c12cdb74`.
Initial implementation commit: `05bb685` on `codex/omp-lsp-port`; final
warm-diagnostic source-fix commit: `098af5d`. Clean-clone and packed-consumer
evidence was collected separately for both commits. OMP reference:
`b1a8b875cf81ec2fdc3cc397a2d4b6a9a777543d`; see [provenance](../../third_party/oh-my-pi/README.md).
Scope is HARNESS-P3/P4 LSP. Pi dependencies remain 0.87.1; Host/Web, OMP Agent/TUI,
context, mux and editor mutation are outside this change.

The subsequent review of all changes since `1c9b31a`, local corrections and remaining
acceptance gap are recorded in [the final code review](lsp-final-code-review-20260927.md).

## Verification

Built and exercised the executable CLI and real language servers. Evidence directory:
`/tmp/verify-20260927-omp-port/`. These are local, temporary, sanitized artifacts,
not durable CI URLs. Reproduce with [the acceptance method](../testing/omp-lsp-acceptance.md).
This repository has no `docs/agents/feedback-loops.md`; package scripts supplied
the check procedure. `/setup-feedback-loops` can make that workflow discoverable
for subsequent tasks.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Complete runtime/CLI/Pi RPC suite | PASS | Initial `check.log`: 24 files, 154 tests; final `fresh-final-check.log`: 158 runtime tests |
| Packed content, public entries and OMP notices | PASS | Initial `check.log`: separate package test, 1 test; final `fresh-final-check.log`: 1 package test |
| Seven CLI operations, six families | PASS with explicit backend limit | `language-matrix.json` and post-fix `language-matrix-final.json`; Python implementation is correctly unsupported |
| Diagnostics after symbols; bad → saved repair → clean | PASS | Six matrix rows, plus independent checks rejecting bad source and accepting repaired source |
| Cold Rust project repair stability | PASS | `rust-stability.json`: three consecutive fresh projects |
| Real process crash/recovery, SIGINT cancellation and reuse | PASS | `lifecycle.json`: recovered PID changes, cancelled query exits 4, later query retains healthy PID |
| Consumer stop confirms process exit | PASS | `lifecycle.json` and executable idle/busy shutdown regressions |
| Dynamic capabilities, URI equivalence, stale/no-report diagnostics, incremental dependencies, deadlines, write pressure, init backoff | PASS | Public CLI regressions; relevant failure logs retained beside `check.log` |
| Fresh clone and installed tarball consumer | PASS for `05bb685` and `098af5d` | Initial `fresh-check.log`/`package-consumer.json`; final `fresh-final-check.log`/`fresh-final-pack.json`/`consumer-final-result.json` |
| Live-model autonomous LSP use on natural Work goals | FAIL in the original run | Ten valid model sessions: 9 semantic tasks and 1 document control; only 2/9 semantic tasks invoked LSP, and neither yielded conclusive post-edit diagnostics at the time. See model-level evaluation below |
| Production/Server deployment | Not in scope | No deployment or consumer upgrade performed |

Backend results:

| Family | Status/symbols/definition/references/hover | Implementation | Error → clean + independent check |
| --- | --- | --- | --- |
| TS/JS (TypeScript project) | PASS | PASS | PASS / tsc |
| Python | PASS | UNSUPPORTED (Pyright) | PASS / pyright |
| C# | PASS | PASS | PASS / dotnet build |
| C/C++ (C++ project) | PASS | PASS | PASS / g++ |
| Rust | PASS | PASS | PASS / cargo check --offline |
| Go | PASS | PASS | PASS / go test |

The initial clean clone was created from committed candidate `05bb685`, installed with
`npm ci`, checked and packed. Artifact `pi-coffee-0.1.0.tgz` is 131,673 bytes;
`pack.json` records its SHA-512 integrity and complete file manifest. The independent
consumer installed that tarball through npm and used only the public export and
installed CLI. `toolchains.json` records the concrete versions used for native probes.

The final committed candidate `098af5d` was independently cloned into
`/tmp/verify-20260927-omp-port/fresh-final`. After `npm ci`, its
`npm run check` passed 158 runtime tests and one package test, and `npm pack`
produced a 132,488-byte tarball with SHA-256
`15a135d3694e952a144c5d1ab72168ca8a4640f6ebbfda7ca730f2b8f250d55d`.
An empty consumer installed that tarball and TypeScript 5.9.3, resolved one
Skill and seven extensions through the public package interface, and ran the
installed CLI through status, symbols and saved-edit diagnostics:
`clean → clean → findings → clean`. Every semantic probe exited 0 with 1/1
coverage; cleanup used the public stop interface. Evidence is in
`fresh-final-install.log`, `fresh-final-check.log`, `fresh-final-pack.json`,
`consumer-final-install.log` and `consumer-final-result.json`.

The first empty-consumer TS query failed initialization because no TypeScript
compiler was installed. After installing the documented TypeScript 5.9.3 project
prerequisite, status, symbols and real diagnostics passed. This is retained in
`package-consumer-missing-toolchain.log`; a language-server frontend alone does not
supply the project's compiler. The package does not install native language SDKs.

## Model-level evaluation (separate from CLI acceptance)

After the deterministic port checks, ten independent Pi Work sessions used
`openrouter/meta/muse-spark-1.3-contributor` with `--thinking high`. Pi RPC
confirmed the selected provider/model, high thinking level, Work command and
`skill:lsp` before each natural-language task. The OpenRouter route is the
locally configured workbench connection; the sessions ran in isolated Pi RPC
fixtures, not the Server Host. Unrelated Web and subagent integrations were
disabled for the fixture. A separate attempt through
`opencode-go/muse-spark-1.3-contributor`, the possible meaning of “command
code,” returned HTTP 403 on a live request despite local authentication being
configured. It was not counted as a model result. Two OpenRouter HTTP 429
attempts were likewise excluded; a later independent signature session
completed. The rejected attempts remain in the temporary evidence directory.

| Natural goal | Valid sessions | Autonomous LSP use | Observed result | End-to-end model pass |
| --- | ---: | ---: | --- | ---: |
| Cross-file TypeScript type repair | 3 | 0 | All three made the exact minimal correction and changed failing `tsc` to passing | 0/3 |
| Same-name symbol impact analysis | 3 | 0 | All named both true caller files, left the fixture unchanged and passed `tsc`; exact answer line numbers were not retained | 0/3 |
| Exported signature and caller repair | 3 | 2 | All three changed exactly the exported function and two real callers, preserved the unrelated same-name function and passed `tsc`; both LSP-using runs observed partial post-edit diagnostics | 0/3 |
| Documentation spelling control | 1 | 0 | Correct one-word README change; `git diff --check` passed | Control passed |

The strict semantic criterion in [the acceptance method](../testing/omp-lsp-acceptance.md)
requires a relevant semantic query, correct outcome, post-edit diagnostics and an
independent project check. Thus correct code edits alone do not pass it. A
separately labeled *directed positive control* asked the model to use the LSP
Skill: it performed symbols and references queries with confirmed 1/1 coverage,
then diagnostics returned `clean` with zero issues and 1/1 coverage. This
establishes that the model can drive the CLI when asked; it is outside the
natural-goal denominator.

Before the subsequent source fix, the two natural signature sessions that used
LSP each queried diagnostics after editing, but the captured warm-server response
began `status: partial`. A focused CLI reproduction confirmed the distinction:
after the saved `src/domain.ts` signature edit, two successive 30-second queries
returned exit 4, `diagnosticState: inconclusive`, and 0/1 confirmed files;
`src/app.ts`, `src/service.ts` and `src/unrelated.ts` were clean, and `tsc`
passed. A fresh diagnostic session on the repaired files returned `clean` with
1/1 coverage. The fresh-session result does not substitute for what the model
observed in those original sessions.

An initial source fix reopens a changed, previously clean TypeScript document
and separates its close report from fresh diagnostics. Its public CLI regression
failed before the fix and now covers clean-to-clean, new TS2322 findings,
repair-to-clean and an unchanged rewrite. In the post-fix replay of the same
signature scenario,
`src/domain.ts` returned exit 0, `clean`, 1/1 coverage twice after editing;
`src/app.ts`, `src/service.ts` and `src/unrelated.ts` were also clean, and
`tsc` passed. At that interim revision, the complete check passed 155 runtime
tests and one package test.
This cleared the original `src/domain.ts` reproduction at that interim revision
but does not change the historical 0/9 natural-goal model score. Later review
found additional warm-refresh edges requiring a further source change.

One separately scored, directed interim Pi Work replay used the same
OpenRouter model and high thinking level. The model queried references before
editing, made exactly the intended three-file signature/caller change, then
queried diagnostics for `src/domain.ts`, `src/app.ts` and `src/service.ts`.
All three model-observed post-edit results were `clean`, zero issues and 1/1
coverage; `tsc` passed. This proves the repaired CLI path works end to end
for this fixture at the interim revision when the model is explicitly asked to
use LSP. It does not measure autonomous LSP selection and is excluded from the
original natural-goal denominator.

The final source revision also protects dependent-file refresh and cancellation
during reopen. `npm run check` passed 158 runtime tests and one package test.
The final real-server matrix passed all seven operations across TypeScript,
Python, C#, C++, Rust and Go, with Pyright implementation correctly reported
unsupported. In one fresh, separately scored directed Pi Work replay on that
revision, the model used LSP references with confirmed 1/1 coverage before
editing, made exactly the intended three-file change, and then queried
diagnostics on `src/domain.ts`, `src/app.ts` and `src/service.ts`. Each
model-observed post-edit result was `clean`, zero issues and 1/1 coverage;
`tsc` passed. This directed end-to-end task passes. Autonomous LSP selection
was not retested after the final source revision, so the original natural-goal
score remains 0/9 for those historical sessions.
The final direct CLI signature replay is in
`/tmp/verify-20260927-omp-port/warm-diagnostics-final-replay.json`.

Sanitized, local evidence: `/tmp/verify-20260927-omp-port/model-acceptance/openrouter/report.json`
contains operation names, bounded command/result fields, project checks and
provider error classes; adjacent `*-diff.patch` files contain fixture-only
diffs. `warm-diagnostics-repro.mjs`, `warm-diagnostics-repro.json` and
`warm-diagnostics-repro-repeat.json` preserve the pre-fix reproduction.
`warm-diagnostics-barrier-fix.json` records the interim direct replay.
The interim model run is `directed-repair-1` in the OpenRouter report, with
its exact fixture diff in `directed-repair-1-diff.patch`.
The final run is `directed-final-1` in the same report, with
`directed-final-1-diff.patch`. The post-fix six-family evidence is
`/tmp/verify-20260927-omp-port/language-matrix-final.json`.
No credentials or complete model transcripts were retained. These temporary paths
are local evidence, not durable CI artifacts.

## Failures found and repaired

The old same-text synchronization could discard a diagnostic produced during a
preceding symbols query. Persistent diagnostic storage and unchanged-document
reuse fix that sequence. The explicit stop path rearmed its idle timer and left
its daemon alive; idempotent shutdown now blocks timer rearming and waits for exit.

New regressions exposed duplicate document versions during repair. The initial
real Rust probe also intermittently returned inconclusive after repeated saves of
unrelated open files. Reconciliation now synchronizes a changed file once and,
following OMP, refreshes other open overlays on file creation/deletion. Three fresh
Rust runs and the final six-family matrix then passed. No failed result was counted
as clean.

The initial complete check rejected four documentation phrases under the existing
Chat/Work vocabulary rule; the documentation was corrected and the check rerun.

## Independent review closure

| Axis | Findings | Resolution |
| --- | --- | --- |
| Standards/correctness | Cached pull could hide a new report for an unchanged document | Wait for the current pull; clear cache on diagnostic refresh; executable first-clean/second-findings regression failed before the fix and passed after |
| Spec | Queue time escaped the budget and timeout was classified as daemon failure | Absolute deadline crosses startup/queue; timeout exits 4; bounded-queue regression |
| Spec | Batch timeout discarded earlier confirmed findings | Retain findings and requested/confirmed coverage; three-file partial-batch regression |
| Spec follow-up | Internal timeout could mask caller value above 60 s | Validate each original timeout assignment; oversized-timeout regression |

The deterministic port-review findings above were resolved. The later
model-level evaluation exposed a warm diagnostic-refresh gap; the final source
revision, direct CLI regressions and directed model replay close the observed
reproduction. The original natural-goal score remains pre-fix evidence and
does not measure autonomous LSP use after the fix. Review confirmed the
LSP-only boundary.
Remaining limits: representative Linux projects, versionless-push heuristics,
serial queue/load behavior, broader project layouts, other platforms and model
behavior beyond this one model and fixture set. These limits are detailed in the
test method and are not claimed as verified by this run.
