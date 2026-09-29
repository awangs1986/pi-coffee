# OMP LSP port acceptance

Scope: HARNESS-P3/P4 LSP only, on unmodified Pi 0.87.1. The implementation retains
Coffee's Skill → Bash → `coffee-lsp` interface. Use this method for future LSP
changes; passing unit tests alone does not certify a language backend.

## 1. Deterministic public-interface regressions

From a clean checkout, use Node >=22.19, install the locked dependencies, then run:

```bash
npm ci
npm run check
```

`check` builds, runs runtime/CLI/Pi RPC tests, and then inspects the package. Do not
run packaging concurrently with runtime tests: npm's prepare step rebuilds `dist`.
For the shorter LSP loop:

```bash
npm run build
npx vitest run test/lsp-cli.test.ts test/lsp-port.test.ts test/lsp-real-servers.test.ts
```

The executable CLI tests start an independent protocol fixture. They protect:

| User-visible rule | Failure injection / expected result |
| --- | --- |
| All seven operations have bounded JSON results | Status starts no process; symbols/navigation/hover/implementation carry saved-file positions; diagnostics distinguish findings/clean/inconclusive |
| A prior symbols query does not lose diagnostics | Server suppresses same-text publications; symbols → diagnostics still reports the known error |
| A repaired file uses one fresh version | Change bad source to good; the second diagnostic query confirms clean without duplicate same-text version bumps |
| A missing or old report is not clean | Silent server, stale version, provisional cold versionless empty report → exit 4, inconclusive |
| Each pull observes current analysis | First complete pull is empty; second returns errors without a source edit → second query reports findings |
| Dynamic registration and withdrawal are honored | Register hover/pull, then unregister → advertised operation works, withdrawn operation is unavailable; pull failure is not clean |
| Saved dependency changes reach a warm server | Create, edit and delete a dependency; hover changes at each step while process start count stays one |
| Configuration replaces its owning process | Change settings; new hover reflects them and old PID is gone |
| One deadline covers startup, queue and request | Slow initialize + hover; queued short request; shorter deadline on a warm server → exit 4/request_timeout |
| Cancelling one query preserves a healthy server | SIGINT during hover → exit 4/request_cancelled; cancellation reaches the server; next symbols succeeds without restart |
| A crash is recoverable | Kill the owned server; next query starts a new server and returns semantic output |
| Stop means actual exit | Stop idle or busy task daemon, repeat stop, verify daemon and server exit; no idle timer rearm |
| Backpressure is bounded | Server stops reading stdin; large didOpen times out and its process is reaped |
| Permanent init failure does not respawn repeatedly | Identical broken configuration backs off; changed configuration retries; short caller deadline also retries |
| Batch failure preserves useful evidence | First file has an error, second is silent, third exceeds budget → retain first finding with requested=3, confirmed=1 and inconclusive |
| Paths and coordinates survive transport | Special URI characters, Unicode positions, stale hash and out-of-range coordinates retain the documented meaning; invalid positions exit 2 |
| LSP is read-only | Server applyEdit is explicitly declined and source stays unchanged |

These tests cross the CLI/process seam; they do not mock the client under test.
Protocol fixtures cannot certify real compiler semantics. See the next layer.

## 2. Real servers and independent project checks

Install the servers/toolchains below and expose them in the environment inherited
by the CLI. TS and Python servers are locked package dependencies. Native servers
may use absolute JSON argv overrides: `PI_COFFEE_CPP_LSP_COMMAND`,
`PI_COFFEE_CSHARP_LSP_COMMAND`, `PI_COFFEE_RUST_LSP_COMMAND`,
`PI_COFFEE_GO_LSP_COMMAND`. The TS/Python overrides use `TS`/`PYTHON` respectively.

| Family / fixture | Server | Required project/toolchain |
| --- | --- | --- |
| TS/JS (TypeScript fixture) | typescript-language-server 4.3.4 | TypeScript 5.9.3, tsconfig |
| Python | Pyright 1.1.405 | Python, strict pyproject configuration |
| C# | csharp-ls 0.18.0 | .NET 9 SDK, one net9.0 csproj |
| C/C++ (C++ fixture) | clangd 19 | g++, explicit compile_commands.json |
| Rust | rust-analyzer | Rust 1.90, Cargo, matching rust-src, Cargo.toml |
| Go | gopls | Go 1.24, go.mod |

```bash
npm run build
COFFEE_PROBE_REPORT=/tmp/omp-lsp-matrix.json node scripts/probe-harness-languages.mjs
```

The default is all six families. To isolate a backend:

```bash
COFFEE_PROBE_LANGUAGES=cpp node scripts/probe-harness-languages.mjs
COFFEE_PROBE_LANGUAGES=rust,rust,rust node scripts/probe-harness-languages.mjs
```

For each fresh project the script drives the installed executable through status,
symbols, invalid position, diagnostics, cross-file definition, hover, references
and implementation. It deliberately runs **symbols before diagnostics** to catch
the original clangd ordering failure. It requires a real finding, a failing
independent project check, a saved repair, a confirmed clean report and a passing
independent check. Errors are not counted as empty successful navigation.

Python's Pyright does not advertise implementation. Its expected outcome is exit
3/unsupported_operation, recorded as unsupported, not a successful lookup. Other
five implementation probes require nonempty candidates. C++ queries a virtual
method; Rust/Go/C#/TypeScript query trait/interface implementation candidates.

The JSON artifact retains argv, exit code, envelope and stderr per step. The
script cleans only its temporary projects and task-owned daemons. Keep failures
alongside subsequent fixes rather than replacing the evidence with a summary.
A missing SDK/server is an unmet environment prerequisite, never a semantic pass.

Run the real TypeScript lifecycle probe as well:

```bash
node scripts/probe-lsp-lifecycle.mjs
```

It kills the actual language server, requires recovery on the next query, cancels
an active diagnostic CLI with SIGINT, verifies reuse after cancellation, and checks
that consumer cleanup removes the owned server process. Evidence defaults to
`/tmp/coffee-lifecycle-probe.json` or `COFFEE_PROBE_REPORT`.

## 3. Pi and package integration

The complete suite exercises Pi 0.87.1 RPC, Chat/Work Skill discovery and extension
loading. The package gate checks the CLI launcher, Skill, runtime exports, OMP
license/provenance and absence of Host/Web/Relay assets. `stopLspDaemon(sessionId,
env?)` remains the consumer cleanup interface.

Before any package publication, validate the exact candidate from a fresh clone:

```bash
npm ci
npm run check
npm pack --json
```

Install that tarball into an empty consumer directory. For a TypeScript fixture,
install `typescript@5.9.3` in that consumer/project as well: the language-server
frontend does not bundle `tsserver`. Import the public package,
resolve the Skill and extensions, merge the `withCoffeeLspPath` PATH overlay
into the original environment while preserving the owning session ID, run its
installed `coffee-lsp` executable
against a fixture, and stop its daemon using the public export. A source checkout
passing tests does not substitute for a working packed consumer.

## 4. Model-level acceptance (separate, not automatically claimed)

Use a fresh Work task with only a natural-language goal and the fixture checkout.
For each of cross-file type repair, same-name symbol impact analysis, and signature
change with caller repair, run three independent sessions. Add a documentation-only
control task. Record only sanitized query arguments/results, final diff and project
check outcome; keep private prompts, credentials and transcripts out of commits.

Pass a semantic case only if the model discovers the Skill, performs a relevant
semantic query, makes the correct edit/conclusion, reruns diagnostics and the
project check, and reports unsupported/inconclusive evidence honestly. The control
should not need LSP. This evaluates model choice and Skill usage; deterministic
CLI or Pi RPC tests cannot replace it. No paid/live-model run is implied by this port.

## Limits

Evidence covers six representative projects on Linux/POSIX, not every JS/C
dialect, build flag, monorepo, generated file or platform. Project snapshots are
bounded to 20,000 entries and exclude output/vendor trees. Unversioned push reports
use OMP's quiescence heuristic (250 ms, cold empty guard 12 s), not a protocol
freshness guarantee; independent project checks remain necessary. The global daemon
queue is serial with four cached servers; performance/load benchmarks remain separate.
Windows process-tree cleanup, live-model success rates and production deployment
are not certified by this matrix. Rename/format/code actions and OMP Agent/TUI/mux
are outside the read-only port.

Current run evidence: [2026-09-27 review](../reviews/omp-lsp-port-20260927.md).
