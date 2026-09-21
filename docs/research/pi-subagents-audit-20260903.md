# `pi-subagents` integration audit

> 2026-09-20 文档清理：本页涉及旧模式的段落/表项已撤下，未改写为 Chat/Work 的实现证据。原始记录用 `git show b027838:docs/research/pi-subagents-audit-20260903.md` 追溯；当前模式只见 [Pi Agent 主规格](../spec/pi-agent.md)。其余内容仍是标题日期的历史快照。

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