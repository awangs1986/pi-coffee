# Native Agent production rollout — M5

Date: 2026-09-23. Tracking: [Agent #53](http://gitea:3000/awangs/pi-coffee/issues/53), [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48), [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6).

## Deployed revisions and checks

The owner authorized merge and deployment. The LAN entry is `http://webserver:3000/` on `192.168.100.101`. Gitea user `awangs` retains linux001 (`192.168.100.217`); `pi-coffee-t4-user2` retains linux002 (`192.168.100.218`). The Web service remains on its separate host.

- Agent initial deployment: `6ec7d54c0253583dc550e9e78b8c594276b0736a` (PR #54).
- Agent final deployment: `6ee439029a30d9c14aa9fa6cae0e407bb6f96ea3` (PRs #55 and #56), including collaborator targeting and branch validation corrections found during acceptance.
- Server deployment: `d9fff28d5d2d6fb114feb79e0a86cabda4d3e311` (PR #8). Unrelated frontend PR #5 remains separate.
- Native CLIs on both VMs: official `@openai/codex@0.154.0` and `@anthropic-ai/claude-code@2.1.280`.
- Codex: `gpt-5.6-terra`, owner-specified Eidolon endpoint. No other Codex model was used for this rollout.
- Claude: `claude-sonnet-4-6`, owner-specified endpoint.
- Fresh target clones ran `npm ci && npm run check`: initial Agent 190 tests/32 files on each VM; final Agent 191/32 on each VM; Server 45/8 on Web. Server vendor sourcemap warnings were nonfatal.

Active code lives in `/opt/pi-coffee-releases/<Agent revision>` and `/opt/pi-coffee-server-releases/<Server revision>`, selected by `30-native-agents-release.conf` systemd drop-ins. The previous `/opt/pi-coffee` and `/opt/pi-coffee-server` trees remain retained; their HEADs do not identify the running releases. Service restarts preserved all preexisting registered Task IDs.

Native credentials reside only in `/etc/pi-coffee/native-agents.env` on each User VM (root:awang, 0640); native settings belong to `awang` (0600). Both services load the native executable paths explicitly. Codex uses native `workspace-write` / `on-request`, and Claude retains native permissions. No bypass flags, Pi prompt/tool injections, SDK substitution, or central provider credentials were introduced. Local readiness reported all three engines available and native authentication configured; real turns below additionally verified upstream access.

## Real Browser, Gitea and file acceptance

The actual Browser used production Gitea OAuth and the production Web/Host route. Code tasks, prompt submission, native tool display, Diff, Checkpoint and PR were exercised through the Browser. File byte transfer and restore used the authenticated Host/Transfer HTTP interface; these are identified separately rather than described as browser upload automation.

The disposable private repository is `pi-coffee-t4-user2/native-m5-20260923` (Gitea ID 32), shared with the existing collaborator `awangs`. Its initial seed SHA was `a7b0ff039da10bfe4eb363078051a4d402a30afb`. Shared repository registration on linux001 was an operator bootstrap through the existing `Workspaces.registerProject` interface while the Host was stopped; the UI does not yet offer a shared-repository picker. No state-file hand edits or repository migration were used.

| Flow | Evidence |
|---|---|
| Claude Work on linux002 | Task `9422df9b81856872720785cf133a41f9`; independent checkout and `coffee/linux002/9422df9b81856872720785cf133a41f9`; native Read/Write/Bash; exact file bytes checked independently |
| Claude native approval | Reloaded Browser with Write approval pending, recovered the same request and approved it; same turn continued |
| Claude Checkpoint / PR | local SHA = remote SHA = `104e02aa14c79c958a8be483a28d2b3509829559`; Browser created repository PR #1 |
| Codex Work on linux001 | Task `9bd4637175d225e3bd82e059040e61d2`; independent checkout and `coffee/linux001/9bd4637175d225e3bd82e059040e61d2`; native fileChange/commandExecution; both marker files verified independently |
| Code continuation | Codex began at the exact Claude remote Checkpoint, with a new Task/native context and its own clone/branch; no transcript or unversioned file transfer |
| Codex Checkpoint / PR | local SHA = remote SHA = `dbd958c49ba12d8edb1963c7461c99552ed3a87c`; Browser created repository PR #2 from the Codex branch to main; subsequent authenticated API open reused #2, while Claude retained #1 |
| Claude Chat | Task `3781a516bfb9ad1535d1f28112ba76c0` under `/home/awang/work/chats`; native Read consumed its scoped attachment; Browser archive, API restore and Browser reopen retained history/binding/files |
| Codex Chat | Task `4d3aba4a6ffdf42570dbd752a385603c` under `/home/awang/work/chats`; native command read its scoped attachment; Browser refresh/archive and API restore retained history/binding/files |
| Original attachment bytes | Both authenticated transfer flows downloaded byte-identical content; SHA256 `20250ffb69bdbcee6b19595f7373125c60e003e57cc70bf165a318192c43ae83`; retained after archive/restore |
| Existing Pi | Existing linux002 Task `015745d9-7857-4477-8c56-1dc1a6863a38` reopened with its 39-entry native history and Pi controls; no new paid Pi turn was needed |

Gitea acceptance found that PR lookup/create assumed the configured username owned every project. The correction resolves the registered repository ID using Gitea before targeting its canonical owner/name. The HTTP-boundary regression first failed with 404 and then passed. A second live probe found that Gitea ignored the head filter and returned another Task’s PR first. Exact source/base repository IDs and branches are now checked across result pages, created PRs are validated, and cached workspace PR references are refreshed through Gitea. Wrong-PR and stale-reference regressions failed before correction; idempotent reuse then passed. This changes shared code collaboration, not native engine behavior.

## Isolation and retained-data recovery

Real probes from the Web host confirmed the unchanged user-to-VM routes, disjoint Task ID sets, foreign Task file requests rejected with 409 in both directions, and the other VM's Host token rejected with 401 in both directions. Anonymous Web `/api/me`, `/api/workspace` and `/api/engines` returned 401. Both routed identities were also exercised in the actual Browser. These scoped API probes are not a claim of an exhaustive security audit.

On idle linux002, a temporary systemd drop-in emptied both native command variables. After restart Pi remained available, native engines became unavailable, and Task IDs/bindings were retained. Removing that drop-in and restarting restored all three engines and the same native histories. The tested rollback is safe activation rollback on a native-aware release. An older Pi-only Host must not open native Task metadata.

The [M0–M4 record](native-agents-m0-m4-20260923.md) supplies real targeted-stop, native-context continuation, process-restart and reconnect evidence for the unchanged engine adapters. The M5 patches change Gitea PR resolution and cached workspace PR refresh; native adapters are unchanged. The fixture matrix covers uncertain delivery, stale requests, native-ID collisions, concurrent writers, missing history and interruption isolation. Those paid cases were not repeated without a new failure.

## Acceptance map and limits

| Contract | Evidence |
|---|---|
| NE-AC01–03 | Fresh-clone Host tests; actual legacy Pi reopen; fixed Agent and distinct bindings in Browser |
| NE-AC04–06 | Version/native readiness, disable/re-enable, native defaults and actual tool streaming; unsupported controls capability-gated |
| NE-AC07–10 | Live Browser reload during approval; same-version Host recovery; M0–M4 real stop/context probes and protocol fault fixtures |
| NE-AC11–13 | Both Chat byte probes, cross-VM rejection, two native Work clones, exact continuation/Checkpoint SHAs, Browser Diff and real PRs |
| NE-AC14–16 | Writer/cleanup fixtures, non-destructive archive/restore, safe activation rollback and fresh code-only continuation |
| NE-AC17–18 | Agent/Server compatibility suites, unchanged transparent gateway, separated native credentials and no secrets/transcripts in evidence |

Native inline images, native rename, reasoning selector, Pi-specific queue/steer/stats/extensions and permanent native-history cleanup remain unavailable as documented. Cleanup was not forced or claimed successful: the four disposable native acceptance Tasks were archived with their files and histories retained. Provider model catalogues do not guarantee entitlement; the supplied Codex credential must use Terra. No claim covers arbitrary CLI upgrades or every terminal feature.

Known UI follow-up: after visiting a legacy Task, the new-task action can retain the caption “为旧任务创建目录”; it still creates the selected new Task. Shared repository onboarding currently requires operator registration. The caption/account-selection follow-up is recorded in [Server #4](http://gitea:3000/awangs/pi-coffee-server/issues/4#issuecomment-1671). These do not alter the immutable Agent or per-Task Workspace rules. No unrelated layout changes, new VMs, repeated snapshot rollback, or GitHub publication occurred.

See the [deployment and manual-test guide](../deployment/native-agents.md) for repeatable operation and the short owner checklist. Both Host services and Web were active and healthy at final acceptance, with no registered running Task or unknown native writers; both the DNS and IP Web health URLs were reachable from the current LAN machine.
