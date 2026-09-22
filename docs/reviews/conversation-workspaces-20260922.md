# Conversation Workspace implementation and deployment — 2026-09-22

Scope: Agent #46 / Server #3; CW-01–10. This is a workflow acceptance, not a repeat of T4 or an evaluation of model quality.

## Revisions and checks

- Agent runtime: `b76c03d` (`awangs/pi-coffee`, main).
- Server browser: `6930159` (`awangs/pi-coffee-server`, main; includes refresh and task-switch race fixes).
- Agent: `npm ci --no-audit --no-fund && npm run check` from a clean Gitea clone: **31 files / 171 tests passed**.
- Server: same documented install/check on the clean Gitea clone at the final code revision: **7 files / 40 tests passed**.
- New tests exercise the public Workspace/file/Host HTTP and browser DOM seams. Red was observed for Chat creation/root overlap, remote branch listing, historical inbox access, task runtime environment, creation before Pi attachment and switching during an upload checksum.
- Existing Git, Host lifetime, transfer scope, extension/harness, LSP and gateway tests remain green. Vendored browser bundles emit pre-existing missing-source-map warnings during tests; checks succeed.

## Acceptance evidence

| Contract | Verified behavior |
|---|---|
| CW-01/02/08 | Distinct Chat roots, validated nonoverlapping real roots, durable metadata and creation retries; unknown directories and missing ready directories are not silently replaced; deleted IDs are tombstoned. |
| CW-03/07 | Two same-project Conversations have independent clones, `.git` directories and `coffee/<vm>/<id>` branches. Platform checkpoint excludes runtime data and refuses tracked reserved files or branch drift. Real Work creation confirms the remote SHA. |
| CW-04/05 | Original PNG uploaded from the browser is byte-for-byte identical after download. Research, large tool results and child results write to scoped roots in public writer tests. Real Pi processes on linux002 use the registered cwd, data root, Chat/Work initial mode and native subagent runtime directory. |
| CW-06 | Authenticated/scoped file API rejects other-task paths. Proven old inbox references remain readable within their scope; global evidence with unknown ownership is retained and not reassigned. Gateway continues streaming without owning file bodies. |
| CW-08/09 | Actual browser creates Chat and Work, displays VM/project/full cwd/actual branch/sync, offers full-path copy and survives refresh before Pi attachment. Async status/results cannot overwrite a different selected task. Original upload preparation is cancelled if selection changes during hashing; Git actions retain their original task ID. |
| CW-10 | Archive preserves running Pi/children and local files in lifecycle tests; restore retains cwd. Actual linux002 test closes an idle native Chat session and permanently deletes its confirmed directory/history. Native child state, uploads and LSP are checked/stopped before cleanup. Remote Work branch/PR/repository remain. |

## Deployed workflow

- Web: `http://webserver:3000` (`192.168.100.101`), `pi-coffee-web` active.
- User VMs: linux001 / linux002, `pi-coffee-host` active; `/healthz` advertises `chatWorkspaces`, `giteaCheckouts`, owner authority and passwordless root.
- Both VMs explicitly configure `/home/awang/work` and `/home/awang/work/chats`; existing Project Checkout paths were retained.
- Real OAuth browser test on linux001: Chat + Work creation, original image upload/download, actual branch/synced state, copy path, reload, archive/restore; **zero page script errors**.
- linux002: separate Chat + Work creation, independent `.git`, synced remote branch, scoped file roundtrip in both workspaces, archive/restore, actual Pi cwd/env inspection, and successful permanent Chat cleanup.
- Synthetic Work tasks and their remote branches are archived/retained for inspection. Synthetic Chat used for destructive cleanup is gone. Existing user directories/history were not migrated or deleted.
- The first immediate post-restart connection probe raced Host startup; subsequent `/healthz` checks succeeded. The browser probe found and drove a fix for early refresh before Pi attachment; the final deployed probe passes.

## Reproduce and limits

Agent checks: clone `awangs/pi-coffee`, `npm ci`, `npm run check` using Node >=22.19 and normal Git/Python dependencies.
Server checks and actual browser probe: clone `awangs/pi-coffee-server`, `npm ci`, `npm run check`, then `node scripts/smoke-conversation-workspaces.mjs`. Supply the Web URL, Gitea test credentials and installed Chromium path via environment as documented in the Server runbook. The probe creates synthetic tasks and archives them; no credentials, cookies, screenshots of user history or transcripts are committed.

External model/search provider quality and the full LSP/T4 fault matrix were not repeated. Artifact writers were checked with synthetic results; native process binding and directory lifecycle were checked on the VMs. Existing unowned global research/child artifacts are deliberately left in place. Native Pi history retains its existing store and is associated by stable Conversation ID. The VM remains an owner-controlled execution environment, not a per-directory OS sandbox or an orchestrator for independently launched services.
