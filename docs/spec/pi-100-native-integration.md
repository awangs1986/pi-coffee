# Native Pi 1.0 integration

Tracking: [Pi #6](https://github.com/awangs1986/pi-coffee/issues/6).
This supersedes the runtime pins in [the 0.99 contract](pi-099-native-integration.md).
Source authority and ownership remain in [REPOSITORIES](../../REPOSITORIES.md).

| Component | Reviewed target | Responsibility |
| --- | --- | --- |
| Official Pi family | 1.0.0 | Native RPC, sessions, package management and automatic compaction |
| Official pi-web-access | 0.35.0 | Search providers, response IDs and bounded original-content retrieval |
| Official pi-subagents | 0.74.0 official source at `10694a6` | Tool activation, children, queues, workflows and fleet status |
| Coffee Harness | 0.2.2 | Chat/Work, Git, discovery, bounded evidence and opt-in context presets |
| Coffee LSP | 0.4.5 | Semantic tooling, CLI/Skill and server lifecycle |
| Context Handoff | 0.2.0-experimental.4 | Explicit same-session experimental Handoff and evidence recovery |
| Host-provided typebox | 1.3.34 | Shared tool schema implementation |

## Pi major-version boundary

The hooks and public extension APIs used by Coffee remain available. Harness and
Handoff declare the tested 0.99 and 1.0 minor lines, rather than accepting unknown
future major versions. All three packages compile and run deterministic checks
against 1.0.0; installed tarballs are exercised together on 0.99.1 and 1.0.0.
The legacy aggregate is preserved without a parallel dependency upgrade.

Native Pi now defaults to fullscreen TUI. Users who need terminal scrollback can
select native `tuiMode: "regular"`; Coffee does not force a preference. Supplying
`--provider` requires an explicit `--model` in Pi 1.0. Keep provider/model pairs
complete in consumer configurations. Codemode, MCP and new image-generation
capabilities are not automatically enabled by this upgrade.

## Delegation activation

The npm 0.74.0 package fails background launches on Pi 1.0 because it requires
`@earendil-works/pi-agent-core/node`, which Pi 1.0 no longer exports. The selected
source is the immutable official commit
[`10694a673cb077b4d3ec6a6cfe68acb6c28b83a5`](https://github.com/nicobailon/pi-subagents/commit/10694a673cb077b4d3ec6a6cfe68acb6c28b83a5)
([upstream #2634](https://github.com/nicobailon/pi-subagents/pull/2634)), consumed
via its GitHub source archive. It retains upstream package version 0.74.0; record
the SHA and lock integrity as well as the version. This is official unreleased
source, not a Coffee fork. The selected snapshot includes 20 upstream commits
after v0.74.0, not only PR #2634. Return to a tested npm release once it includes
the fix.

Upstream subagents 0.74 chooses `auto`, `dynamic` or `eager` activation. Work
preserves an already-selected native executor and exposes `subagent` when no
loader is registered. When only the loader is selected, Work leaves execution
inactive until the native loader is called. Coffee does not read private upstream
activation state, replace schemas, fork execution, or authorize delegation.
Both loader and executor receive the same bounded Work delegation guidance once.

Native selection survives session restoration and model selection. Returning
from Chat uses the loader when registered, or the executor for eager-only
installations. Chat still removes delegation/development schemas at the provider
boundary, including tools selected later by another extension.

Upstream removed `workflowScript` / `workflowScriptPath`. Use the installed
official guide for `workflow: true` with a fenced JavaScript workflow, named/path
workflows, or public RPC `script`. Coffee owns no scripted-workflow adapter.

## Preserved context and language-server policy

Chat/Work are the only modes. Host presets remain 272,000 and 500,000 tokens,
clamped to native capacity and opt-in. Pi owns automatic compaction; only the
explicit Host/manual marker invokes experimental Handoff. No autonomous Handoff
cadence, continuation or fallback is introduced.

Web/delegation results remain bounded to 8,000 characters including a durable
original-evidence pointer. Failed/empty results create no extra Coffee research
artifact; upstream cache/session diagnostics are retained. Web stays on reviewed
dynamic activation, `workflow: none`, 6,000-character content slices and explicit
retrieval. Unobservable background web workflows remain rejected. Public
subagent fleet status still gates cleanup and Handoff.

Bundled TypeScript language server 4.3.4 and Pyright 1.1.405 are retained. The
latest TypeScript server 6.0.1 requires Node >=22.22.2, while Coffee supports
>=22.19.0. A language-server major upgrade is a separate compatibility decision,
not required by Pi 1.0. Configurable C#, C/C++, Rust, Go and other language
servers remain intact; this upgrade does not claim fresh validation of every
external executable or platform.

## Acceptance and rollout

- Preserve the pre-upgrade installed-package peer rejection and the native eager
  executor failure as red evidence, outside commits and Issues.
- Run `npm ci`, `npm run bootstrap`, `npm run check` and `npm run pack:plugins`.
- The installed-package matrix exercises real official plugins, three activation
  modes, both load orders, native loader/executor calls, restoration, model
  selection and Chat isolation using a local scripted provider.
- Server separately verifies native Serper retrieval/bounding, child runtime
  parity/cancellation, Handoff, LSP, reconnection and its current adapters.
- Native model-autonomy and semantic-drift evaluations are separate; no paid
  production-provider calls or transcript migration are needed for this upgrade.
- Publish immutable plugin artifacts and mirrored source identities before
  consumer installation. Preserve credentials, defaults and sessions; keep prior
  runtime artifacts for rollback. Production restarts/deployment need their own
  acceptance and authorization.

Pi 1.0 inherits the previous high-severity brace-expansion 5.0.9 advisory in its
shrinkwrap. Do not describe the dependency audit as clean or assume a root
override repairs native shrinkwrapped dependencies. Track the upstream update.

## Terminal-only legacy registrations

The pre-upgrade terminal had pi-antigravity 0.8.0 and pi-lens 4.2.1. Antigravity
0.9.0 admits Pi 1.0 and is checked in isolation before replacement. Lens 4.3.0
still requires Pi TUI 0.84/0.85; a normal Pi 1.0 resolution rejects it with
ERESOLVE. Coffee LSP is the selected LSP provider. Remove the old Lens package
and registration with `pi remove npm:pi-lens`; do not retain a second provider
or bypass Lens's peer contract. The owner confirmed retirement on 2026-10-02,
and a native Pi RPC check after removal confirmed Coffee LSP 0.4.5 loads once
without extension errors. Preserve configuration/CLI backups and session data;
restoring an old configuration must not silently reintroduce Lens.
