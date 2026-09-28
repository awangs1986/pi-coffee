# Official native subagents

Tracked in [Pi #73](http://gitea:3000/awangs/pi-coffee/issues/73).

Accepted by the owner on 2026-09-28: use unmodified
[nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) directly,
managed through Pi's native package manager. Do not create a Coffee subagent
fork or an independent Coffee execution adapter. This supersedes the previous
Coffee executor, admission, model-command, resource and output-wrapper contract.

## Version and installation ownership

The migration baseline is npm `pi-subagents@0.73.1`, released 2026-09-27, with
Pi 0.87.1. GitHub main also contains unreleased changes; these are not the npm
release. The exact development dependency in Coffee is a compatibility test
fixture, not a runtime dependency or an automatic installation.

```sh
pi install npm:pi-subagents@0.73.1
```

Pi discovers the extension, Skills and prompt templates from the package's
native manifest. Coffee neither calls its factory nor injects an extension path.
There must be exactly one loaded copy. An explicitly versioned package entry is
pinned: to adopt a newer release, install that version and rerun compatibility
checks. Users who choose an unversioned source can use `pi update`; the running
version must still be recorded. Package presence is distinct from activation.

Before installing into a Web-used agent directory, upgrade the consumer to a
Coffee revision without the old adapter. Installing beside a still-running old
consumer would load two copies. Test isolated profiles first. The old
`PI_COFFEE_SUBAGENTS` switch no longer controls the native package; use Pi package
resource selection/removal instead.

## Harness and native boundaries

- In Work, when installed, the native `subagents_enable`, `bg_wait` and
  `subagent_supervisor` tools are available alongside the Coffee base tools.
  The native loader activates `subagent`; Coffee does not rewrite its schema or
  convert calls into workflow scripts. `search_tools` no longer owns a subagent
  capability. Native Skills, guides and command help describe the current API.
- Chat removes these four tools from model requests and blocks their model tool
  calls, including a native loader restored after Harness's start hook.
- Native slash commands are user-controlled upstream commands. Coffee no longer
  wraps or prohibits them in Chat; an explicit user command can launch work.
  Chat model isolation must not be described as a VM permission boundary.
- Model changes and explicit Harness mode changes reset the effective tool table.
  Use the native loader again when needed. Old Coffee capability leases are not
  carried over as native activation state.
- The official plugin owns single/workflow execution, cancellation, completion
  notifications, retained children, nesting and optional worktree behavior.
  Coffee does not force worktrees or a global no-nesting rule. The Work prompt
  still asks for focused delegation, short evidence and no concurrent writers.
- Configure models with native settings/agent definitions or explicit tool
  arguments. Coffee's `/subagents-model`, `/subagents-policy`, runtime
  `coffee-research` role and launcher are removed. Existing `subagents.defaultModel`
  remains an upstream setting; it is not rewritten during migration.

## Explicit behavior changes

| Area | Old Coffee adapter | Official 0.73.1 |
| --- | --- | --- |
| Concurrency | 3 active children per root, 5 per VM, shared Python/flock admission | Native per-run `globalConcurrencyLimit`, default 20; no Coffee VM-wide 3/5 guarantee |
| Spawn budget | Coffee call schema and no nested delegation | Native per-run spawn budget, default 64; optional session budgets and native nesting policy |
| Async load | Coffee launcher/process tracking | Native `maxActiveAsyncRunsPerSession` and capacity evidence; distinct from per-run concurrency |
| Tool surface | Reduced schema and supervisor multiplexed into `subagent` | Official schema, loader, `bg_wait` and separate supervisor tool |
| Output | Coffee archive and small preview on tools and notifications | Upstream result and artifact contracts, without a Coffee subagent output wrapper |
| Resource discovery | Coffee manually supplied Skills/prompts | Native Pi package manifest |

Concurrency scopes are not interchangeable. A per-run setting of 3 is not a
replacement for three children across a Conversation, or five across a VM.

## Context limits and artifacts

0.73.0+ caps workflow Return/Emitted/Console sections at 200 KB or 5000 lines by
default, with `maxOutput` overrides, truncation markers and artifact pointers.
Async notifications/status have their own upstream preview limits.

**Single-child inline results have no default `maxOutput` cap.** Set
`maxOutput: { bytes: 2400, lines: 40 }` for a bounded call, or use native
`outputMode: "file-only"` with an output path for large evidence. The Work prompt
recommends these options, but that recommendation is not an enforced global cap.
Do not claim every native child result is now summary-only, or that native
artifact placement already matches Coffee's per-Conversation artifact contract.

Coffee's separate context extension still bounds its existing built-in/Web tool
set and checks the final request budget. It does not rewrite native subagent
content/details or completion notifications, including the former Coffee-specific
secret-redaction pass. Native output must not be described as having that old
universal redaction guarantee. This migration does not redesign
compaction or prove drift reduction.

## Host migration gate

The removed adapter supplied `/coffee-workspace-jobs`. Existing Server adapters
that depend on this private command receive unknown background state and must
continue to refuse workspace mutation/cleanup. Do not report unknown as idle.
A Server consumer upgrade must replace this lifecycle integration and verify
queued/running/paused children, completion, cancellation, reconnect and cleanup.
Until then this source release must not be deployed over the current Web Host.

Native plugin installation and source publication do not upgrade an already
running Web session. Server release identity and deployment acceptance are
separate from this repository's native-plugin compatibility checks.

## Validation

`test/subagent-rpc.test.ts` uses a real Pi 0.87.1 process, native package discovery,
unmodified upstream runners and local deterministic HTTP fixtures. It covers
single/workflow/background execution, model selection, Chat isolation and
explicit output truncation and cancellation with terminal-state evidence. It is not a live model's autonomous delegation test.

`npm run smoke:subagents` checks actual tools, commands and manifest resources.
Run `node scripts/smoke-subagents.mjs --install-native` after build to additionally
exercise `pi install npm:pi-subagents@0.73.1` in an isolated agent directory.
Run `npm run check` and validate the packed artifact from a fresh checkout.
