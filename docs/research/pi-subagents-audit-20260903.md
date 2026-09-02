# `pi-subagents` integration audit

Date: 2026-09-03
Repository: `awangs/pi-coffee`
Purpose: decide how the upstream `nicobailon/pi-subagents` Pi extension can be
loaded by the PI Coffee Agent Host without changing the frozen V5 Harness
contract.

## Sources and version pin

The primary source is the upstream repository and its source tree:

- [upstream repository](https://github.com/nicobailon/pi-subagents)
- [README at the audited commit](https://github.com/nicobailon/pi-subagents/blob/ee65e42d8212864cdceb5419ee636567e75a14f0/README.md)
- [`index.ts`](https://github.com/nicobailon/pi-subagents/blob/ee65e42d8212864cdceb5419ee636567e75a14f0/index.ts)
- [`package.json`](https://github.com/nicobailon/pi-subagents/blob/ee65e42d8212864cdceb5419ee636567e75a14f0/package.json)
- [`VISION.md`](https://github.com/nicobailon/pi-subagents/blob/ee65e42d8212864cdceb5419ee636567e75a14f0/VISION.md)
- [Pi extension loading documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions)

The audit resolved `main` to commit
`ee65e42d8212864cdceb5419ee636567e75a14f0` (2026-09-02) and checked the
published package metadata with npm. That commit publishes `pi-subagents`
version `0.63.0`, under the MIT license. PI Coffee therefore pins the npm
package to `0.63.0`; the commit hash is retained here for provenance rather
than copying the upstream source into this repository.

## What the upstream Module provides

`pi-subagents` is a Pi extension whose parent-session Module registers a
`subagent` tool, a `bg_wait` tool, slash commands, lifecycle observers, and
background-run/result handling. The README names the built-in agents
`scout`, `researcher`, `worker`, `reviewer`, `oracle`, and `delegate`. The
extension starts child Pi processes for foreground/background work and uses
package-relative `agents/`, `skills/`, and `prompts/` resources.

The upstream `index.ts` has an explicit recursion seam: when
`PI_SUBAGENT_CHILD=1`, the parent registration is skipped. This is important
for child sessions and is preserved by loading the upstream entry directly;
PI Coffee does not reimplement the child launcher.

The extension has a large implementation (roughly 250 source files in the
published package). Its interface is intentionally broad: workflows,
artifacts, intercom, watchdogs, missions, schedules, worktrees, and optional
permission-extension integration are all present. Those capabilities remain
owned by the upstream Module and are not copied into the PI Coffee Host or
Web Server.

## Compatibility evidence

The following smoke checks were run against the installed official Pi package
`@earendil-works/pi-coding-agent@0.84.4`:

1. A Pi CLI process started with
   `--extension .../pi-subagents/index.ts --offline --mode json --list-models`
   exited successfully without an extension-load error.
2. A local RPC client started the same extension with `--no-session` and
   `PI_OFFLINE=1`. `get_commands` returned the upstream subagent commands,
   including `subagents`, `subagents-doctor`, `subagents-fleet`,
   `subagents-stop`, `subagents-steer`, and `subagents-models`. The process
   stopped cleanly.
3. The repeatable `npm run smoke:subagents` script adds a temporary diagnostic
   extension. It observed `subagent` and `bg_wait` in the registered tool set
   while the Harness active list stayed exactly at the Simple 8-tool table,
   and it observed the packaged prompt/skill commands.

These checks prove loading and command registration, not model-backed child
execution. A real User VM acceptance run must still cover child launch,
background completion, cancellation, restart, and resource cleanup.

## PI Coffee integration decision

The external seam is the existing `RpcPiSessionFactoryOptions.extensions`
list. The implementation adds the pinned package's `index.ts` as a second
native Pi extension after the PI Coffee Harness extension. The existing
`PI_COFFEE_EXTENSIONS` environment variable remains an explicit replacement
list; `PI_COFFEE_EXTENSIONS=off` still disables all extensions. A separate
`PI_COFFEE_SUBAGENTS=off` switch disables only the packaged extension while
leaving Harness enabled.

The Harness `session_start` handler continues to select exactly the frozen V5
base table: Simple has 8 tools and Full has 10. `subagent` and `bg_wait` are
registered by the external extension but are not silently inserted into
either base table. They appear in `search_tools` as optional extension tools
and can be activated deliberately. This keeps the V5 count honest while
making the new capability available through the same Pi session.

The package's built-in agent definitions are resolved relative to its own
installed entry point. PI Coffee does not copy or mutate those files. An
explicit extension path alone does not make an npm package's `pi.skills` and
`pi.prompts` entries visible to Pi, so `src/subagents/extension.ts` registers
those two directories through `resources_discover`. The repeatable
`npm run smoke:subagents` check proves this on Pi 0.84.4; if a future Pi
release changes that discovery rule, resource loading gets its own ticket
rather than widening the Host seam.

## Risks and explicit non-goals

- Loading the extension is not a security sandbox. VM isolation remains the
  PI Coffee execution seam, as recorded in ADR-0005.
- Upstream worktree and permission features must not be described as PI Coffee
  VM management or as V5 Guard restoration.
- Child execution requires a model/provider and enough User VM resources; the
  current smoke test intentionally does not call an external model.
- The upstream package is actively evolving. Upgrades require a new audit,
  lockfile diff, compatibility smoke, and a Gitea ticket; do not use an
  unbounded npm range.

## Follow-up acceptance

The integration ticket should remain open until a User VM test demonstrates:

- `search_tools` discovers `subagent` and `bg_wait` while Simple/Full counts
  remain 8/10;
- a foreground child returns a result to the parent session;
- a background child can be observed, waited on, stopped, and recovered after
  a browser disconnect;
- `PI_COFFEE_SUBAGENTS=off` and `PI_COFFEE_EXTENSIONS=off` have the documented
  fail-closed effect; and
- no upstream key, transcript, or uploaded file body is written to the
  Control Plane.
