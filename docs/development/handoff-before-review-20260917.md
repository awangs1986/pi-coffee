> 历史存档：此文件保存本轮提交前的旧 handoff，部分状态已过时。当前入口为根目录 `handoff.md`，不要按本页旧的 Resume Here 重做功能。

# PI Coffee handoff

> **2026-09-16 owner 更新**：通用软件开发提示词已统一（simple/lean/full 同正文）；VM 是执行隔离边界，不新增 sandbox/内核。搜索历史只保留精选摘要与索引，完整证据留在独立 VM artifact；默认不委派搜索子 Agent。恢复使用 context-fold 本地算法、常驻 recall_folded 和失败取消，不再静默回退模型摘要。当前合同见 `docs/spec/harness-prompt.md`、`docs/spec/web-search-plugin.md`、`docs/spec/context-recovery.md`（路径均相对仓库根）。通用 SUBAGENTS 设计待单独对齐；下文历史 Lean/Full、8/10 总数、agent_end 封存与 fail-open 描述由上述合同取代。


Generated: 2026-09-16
Purpose: continue PI Coffee from this checkout on another computer.
This file is a resume brief. Follow the relative links; do not reconstruct decisions from chat, and do not depend on an internal Gitea hostname.

## Resume Here

- First next action: In this directory run `npm ci && npm run check`, then start **ID-001** in [`BACKLOG.md`](./BACKLOG.md) (Gitea OAuth and fixed User VM routing). That unblocks remaining FILE-001 identity scope and multi-user shell assumptions. If this session is continuing the Codex-style shell instead, take **E1 / E2 / E4** in [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md).
- Do not restart: do not recreate the MVP, do not rebuild FILE-001a / HTTPS / the plugin panel / `/subagents-model`, do not edit the frozen Picode V5 repository, do not re-import [`docs/development/handoff-import.md`](./docs/development/handoff-import.md), do not re-evaluate forking `pi-web`, and do not copy V5 Guard / permission approvals / in-process sandbox into this tree.

## How to use this checkout

This file lives at the repository root. The other computer should already have this tree (clone or copy). Work from here:

```bash
cd <this-repo>
git status -sb
npm ci
npm run check
```

Need Node.js `>= 22.19`. After `npm run check`, local smoke is `npm start` (Web `http://127.0.0.1:3000/`, Host `ws://127.0.0.1:8788/host`, Relay `http://127.0.0.1:8789/v1` if a Relay key is in the environment — never commit keys). File transfer smoke uses the Host LocalSend port `http://127.0.0.1:53317/` unless disabled. Subagent load-only smoke: `npm run smoke:subagents`.

Two-machine deployment, systemd units, optional HTTPS, and env templates: [`docs/deployment/runbook.md`](./docs/deployment/runbook.md), [`deploy/README.md`](./deploy/README.md). Credentials live only in env files / a password manager, never in Git.

Ticket IDs (`ID-001`, issue numbers in prose) are indexes into [`BACKLOG.md`](./BACKLOG.md). Specs, ADRs, and code in this tree are the readable sources. Do not require an internal issue tracker to continue.

### Git state as of 2026-09-16

`main` at rewrite: `fd58686` plus the commit that replaced this file.

- `/subagents-model` is on `main`: [`src/subagents/model-policy.ts`](./src/subagents/model-policy.ts), [`docs/spec/subagents-plugin.md`](./docs/spec/subagents-plugin.md), [`test/subagent-model-policy.test.ts`](./test/subagent-model-policy.test.ts).
- Local leftover branch `feat/subagents-global-model` is obsolete; its unique product commit is already on `main`.
- Tags in this clone: `v0.1.0-mvp.1`, `v0.1.0-mvp.2`. [`BACKLOG.md`](./BACKLOG.md) also records `v0.1.0-mvp.3` for FILE-001a; that tag is not in this clone’s tag list.

## What this product is

PI Coffee is the independent web MVP for the **unmodified original Pi coding agent**. Picode V5 is a frozen reference, not a source tree and not a ticket queue.

```text
Browser ── WebSocket ──> Web Server ── WebSocket ──> Host ── RPC ──> original Pi Agent
   \                                              └─ LocalSend v2 :53317 ──> User VM inbox
    \──────────────────────────────────────────────┘  (bytes never transit the Web Server)
```

Host owns Session lifetime. Closing the browser detaches transport; it does not stop Pi. Persistent transcripts, files, and plugin state stay in the User VM. The Control Plane/Relay holds the sole upstream model key and only bounded routing/usage metadata. File bytes go browser ↔ User VM ([`docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md`](./docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md)).

Domain language: [`CONTEXT.md`](./CONTEXT.md). Guardrails: [`AGENTS.md`](./AGENTS.md). Doc map: [`docs/index.md`](./docs/index.md).

## Read order for the next agent

1. [`AGENTS.md`](./AGENTS.md)
2. [`BACKLOG.md`](./BACKLOG.md) — decision register, status, non-goals, ticket order.
3. The BACKLOG row and linked spec for the ticket you are about to implement.
4. [`docs/spec/0.1.md`](./docs/spec/0.1.md) for planned 0.1 behaviour; trust tests/code for what already ships.
5. ADRs under [`docs/adr/`](./docs/adr/) (through ADR-0009) and seam files in [`docs/development/workflow.md`](./docs/development/workflow.md).

Do not duplicate those documents here.

## Already shipped on `main` (do not rebuild)

Details live in [`BACKLOG.md`](./BACKLOG.md). In short:

- Host/Web/Relay processes, frame protocol, Codex-style browser shell, session list/history from the User VM Pi store ([`docs/adr/0008-conversation-history-lives-in-the-user-vm-session-store.md`](./docs/adr/0008-conversation-history-lives-in-the-user-vm-session-store.md)).
- Harness Lean/Full prompts and frozen V5 8/10 tool tables via the Pi extension seam ([`docs/spec/harness-prompt.md`](./docs/spec/harness-prompt.md), [`docs/spec/harness-plugin.md`](./docs/spec/harness-plugin.md)).
- Locked `pi-subagents@0.63.0` (optional `subagent` / `bg_wait`, Harness counts unchanged) plus `/subagents-model` ([`docs/spec/subagents-plugin.md`](./docs/spec/subagents-plugin.md)).
- Relay-backed Serper `web_search`, native research closure to User VM Markdown, official `pi-web-access@0.27.0` for non-conflicting content tools ([`docs/spec/web-search-plugin.md`](./docs/spec/web-search-plugin.md)).
- `context-fold@0.4.0` loaded last as fail-open default compaction.
- Opt-in only (off by default): `pi-lens`, `rpiv-todo`, `pi-mcp-adapter`.
- **FILE-001a**: LocalSend v2 direct browser → User VM transfer, inbox under `.pi-coffee/inbox/<session>/`, progress chips, download API ([`docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md`](./docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md), [`src/host/transfer.ts`](./src/host/transfer.ts)).
- **Optional HTTPS** for Web + transfer only (all-or-nothing). 0.1 stays HTTP. Private Host and Relay remain HTTP + bearer tokens. See [`docs/deployment/runbook.md`](./docs/deployment/runbook.md).
- **Plugin panel**: read-only list of extensions/skills/prompts the current Pi process actually loaded (`get_extensions`). Enable/disable/install is still `ARCH-002` / `PLUGIN-001` in [`BACKLOG.md`](./BACKLOG.md).

Pinned Pi: `@earendil-works/pi-coding-agent@0.84.4`. A ticket is done only when this checkout (or the target VM) can run the documented check in [`docs/development/workflow.md`](./docs/development/workflow.md).

Code on `main` is the authority for implemented behaviour. Some BACKLOG rows marked `DONE` may still be waiting for evidence comments elsewhere; do not reopen the implementation.

## Next work (0.1)

P0 still `READY` in [`BACKLOG.md`](./BACKLOG.md):

1. **ID-001** — Gitea OAuth, cookie lifecycle, fixed User VM/Host routing, fail-closed missing route. Contract: [`docs/spec/0.1.md`](./docs/spec/0.1.md) section 2.
2. **DEP-001** — Linux Mint Xfce User VM Deployment Skill, systemd, one-time enrollment. See [`docs/deployment/runbook.md`](./docs/deployment/runbook.md) and [`deploy/`](./deploy/).
3. **SHELL-001** remainder — one Browser Shell with multiple Tasks/Sessions, same-Task serial writes, cross-Task parallel. `SHELL-001a/b/c` are implemented; remaining product gap is Task orchestration plus roadmap E/F in [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md). Plugin panel is already shipped.
4. **FILE-001 remainder** — identity scoping (needs ID-001), inbox browse panel, large-image path fallback / `MODEL-001`. Do not reimplement LocalSend upload/download.
5. **OPS-001** — failure semantics, health, snapshot restore, release evidence. Includes leftover **REC-001**: recover the in-flight turn across Host restart.

P1 reliability (code exists; real VM/Web evidence does not): **HARNESS-003**, **SUBAGENT-002**, **WEB-002** in [`BACKLOG.md`](./BACKLOG.md). WEB-001 code is on `main`.

Web shell next UX: E1 completion notifications, E2 `get_state` resync, E4 readable 401/429/timeout errors — [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md).

Open engineering questions stay in [`BACKLOG.md`](./BACKLOG.md) section 5.

## Seams to touch

From [`docs/development/workflow.md`](./docs/development/workflow.md), plus the transfer port:

- [`src/shared/protocol.ts`](./src/shared/protocol.ts)
- [`src/host/pi-adapter.ts`](./src/host/pi-adapter.ts)
- [`src/host/session.ts`](./src/host/session.ts)
- [`src/host/server.ts`](./src/host/server.ts)
- [`src/host/transfer.ts`](./src/host/transfer.ts)
- [`src/web/host-client.ts`](./src/web/host-client.ts)
- [`src/web/server.ts`](./src/web/server.ts)

Browser shell is build-free ES modules under [`public/`](./public/). `npm run build` copies vendored `marked` / `DOMPurify` into gitignored `public/vendor-*.js` and `dist/public/`.

Change loop: failing test at the public seam → smallest slice → `npm run check` → record evidence against the BACKLOG ticket. One active ticket per change.

## Hard constraints (already decided)

See [`BACKLOG.md`](./BACKLOG.md) section 4 and [`docs/adr/`](./docs/adr/). Do not:

- Modify V5, import unfinished V5 implementation, or treat V5 as this queue.
- Put the upstream model key, cookies, VM credentials, transcripts, tool output, or file/image bodies into Git, Wiki, issues, or logs.
- Store durable conversation content or file bytes on the Web Server / Control Plane.
- Add a VM manager, in-VM command sandbox, or a second identity system beside the existing Gitea identity decision in [`docs/adr/0004-gitea-is-identity-and-ticket-authority.md`](./docs/adr/0004-gitea-is-identity-and-ticket-authority.md).
- Use multi-tab as the product model (one Browser Shell / tab).
- Switch 0.1 to HTTPS by default (the optional route already exists).
- Introduce Rust without a measured bottleneck (`PERF-001`).

## Suggested skills

The next agent should load these skills with the Skill tool when the matching work starts:

- **tdd** — red → green at the public Host/Web/protocol/transfer seam; required by [`docs/development/workflow.md`](./docs/development/workflow.md).
- **diagnosing-bugs** — smoke, Relay, reconnect, LocalSend, or VM failures.
- **domain-modeling** — any change to [`CONTEXT.md`](./CONTEXT.md) or a new ADR.
- **codebase-design** — keeping the Pi adapter small; new seams for OAuth, enrollment, remaining FILE-001.
- **research** — remaining discovery (`PERF-001`, capability detection, enrollment token design).
- **wizard** — human-only OAuth app, systemd, and secret-store steps on the other computer.
- **code-review** — before merging a branch/PR.
- **no-mistakes** — only when the user asks to validate/ship.
- **writing-for-agents** — only if [`AGENTS.md`](./AGENTS.md) itself must change.
- **resolving-merge-conflicts** — only if a merge/rebase is already in progress.

Do not load V5-oriented workflows into this repository. Do not follow [`docs/development/handoff-import.md`](./docs/development/handoff-import.md) unless `main` is empty (it is not).

## Out of scope for this brief

- Raw prior chat / grill transcripts (never exported; conclusions are in [`BACKLOG.md`](./BACKLOG.md)).
- Wiki mirroring (`DOC-001` / [`docs/development/wiki-publish.md`](./docs/development/wiki-publish.md) — Git remains the source).
- Secrets, cookies, VM snapshots, and live session files (gitignored: `.env`, `.pi/`, `sessions/`).
- Coverage audit of the original design discussion: [`docs/research/handoff-completeness-audit-20260903.md`](./docs/research/handoff-completeness-audit-20260903.md).
