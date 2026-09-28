# Native pi-subagents migration acceptance — 2026-09-28

Issue: [Pi #73](http://gitea:3000/awangs/pi-coffee/issues/73).
Runtime change: `09a09d6c588d898c39c9e4c503e8d98d3b8f73bb`, based on main `98b5a8e`.

The owner selected the unmodified official npm package and accepted retirement
of Coffee's execution/resource/model/output wrappers. Pi manages the native
installation. The tested pair is Pi 0.87.1 and `pi-subagents@0.73.1`; npm's
published `gitHead` is `8a403efba6975988cc0488ec8bb941db5ef1a19e`. Unreleased
GitHub-main changes were not installed.

## Results

| Check | Result |
| --- | --- |
| `npm run check` in development checkout | PASS: 20 files / 139 tests, plus 1 package test |
| Fresh clone, `npm ci && npm run check` at `09a09d6` | PASS: same 139 + 1 tests |
| Real Pi RPC and unmodified upstream runners | PASS: 12 routes, including single, workflow, background notification, explicit model selection, native stop, Chat isolation and native output truncation |
| Native cancellation | PASS: persisted async status reached `stopped` |
| Explicit `maxOutput` on a large child result | PASS: raw tail absent from parent requests; returned artifact pointer readable and complete |
| `node scripts/smoke-subagents.mjs --install-native` | PASS: isolated `pi install npm:pi-subagents@0.73.1`, native tools, Skills and prompt/command discovery |
| Built-in/Web scripted probes | PASS: `smoke-toolchain.mjs` and `smoke-web-access.mjs` |
| Packed consumer | PASS: actual tarball installation with Pi 0.87.1; Coffee alone registers zero subagent tools, enabling native package registers exactly one; no extension errors |
| Dependency audit | PASS: zero advisories in development install and isolated packed consumer |
| Targeted security review | No actionable runtime findings; native result ownership removes the old Coffee universal redaction guarantee |

The packed consumer used `npm pack --ignore-scripts`, followed by an isolated
`npm install --ignore-scripts --omit=dev <tarball> pi-subagents@0.73.1`. Separate
Pi profiles listed only the installed Coffee directory or both native package
directories. Real RPC startup and command discovery checked the resulting tools.
No remote model or paid search request was used: RPC execution uses deterministic
local HTTP fixtures, while the native installation probe contacts npm.

## Failures found and resolved

- The initial ownership test failed because Coffee still injected both its
  native adapter and resource adapter. They were removed along with their
  obsolete tests; retained contracts have native RPC coverage instead.
- Native activation restored `subagents_enable` after the earlier Harness Chat
  hook, exposing a sixth tool. Harness now filters delegation schemas at the
  outgoing request boundary and blocks model tool calls. Provider-format and
  real RPC checks pass. The upstream package is unchanged.
- The workflow fixture initially omitted stable `runs.all` child keys. It was
  corrected to the official schema; this was a fixture error.
- The Work prompt exceeded its existing 9000-byte budget. Delegation guidance was
  shortened without raising the budget. A mode-word scan also rejected the word
  a retired mode term in a new comment; the comment was clarified.
- The initial standalone consumer probe used CommonJS resolution for Pi's
  import-only export. Switching the probe to `import.meta.resolve` fixed it;
  there was no production package change for this probe error.

## Limits and deployment status

This proves native installation, registration and scripted execution, not real
model autonomy, all upstream functionality, production Web reliability or
compaction quality. It does not enforce the retired Coffee 3/5 limits or global
summary-only child output. Single-child inline results still require explicit
`maxOutput` or file-only output to be bounded.

No user-level Pi package list or running Host service was changed. An old Host
still loads the previous Coffee adapter; installing the native package into that
same profile would duplicate tools. The old Server's `/coffee-workspace-jobs`
lifecycle bridge must be replaced before upgrading the consumer. Unknown child
state must remain fail-closed for workspace mutation and cleanup. Native
slash-command execution remains upstream/user-owned, including in Chat.

The previous consumer and deployment are intentionally not certified by this
source migration. See [the current specification](../spec/subagents-plugin.md).
