# PI Coffee handoff

Generated: 2026-09-16
Purpose: continue PI Coffee development on another computer from a fresh agent session.
This file is a resume brief, not a second spec. Read the linked files instead of reconstructing decisions from chat.

## Resume Here

- First next action: Clone this repository `main`, run `npm ci && npm run check`, then start **ID-001 / Gitea issue #8** (Gitea OAuth and fixed User VM routing). That unblocks the rest of FILE-001 identity scope and multi-user shell assumptions. If the session is continuing the Codex-style shell instead, take **E1 / E2 / E4** in [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md).
- Do not restart: do not recreate the MVP, do not rebuild FILE-001a / HTTPS / the plugin panel / `/subagents-model`, do not edit the frozen Picode V5 repository, do not re-import [`docs/development/handoff-import.md`](./docs/development/handoff-import.md), do not re-evaluate forking `pi-web`, and do not copy V5 Guard / permission approvals / in-process sandbox into this tree.

## Checkout on the other computer

Published remote: Gitea `awangs/pi-coffee`, default branch `main`. Clone URL is `http://gitea:3000/awangs/pi-coffee.git`. Some workstations still have `origin` as `http://testpc:3000/awangs/pi-coffee.git`; that is the same repo when DNS/hosts point at this Gitea. Prefer `gitea:3000` if `testpc:3000` does not connect.

```bash
git clone http://gitea:3000/awangs/pi-coffee.git
cd pi-coffee
git status -sb
npm ci
npm run check
```

Need Node.js `>= 22.19`. After `npm run check`, local smoke is `npm start` (Web `http://127.0.0.1:3000/`, Host `ws://127.0.0.1:8788/host`, Relay `http://127.0.0.1:8789/v1` if a Relay key is configured in the environment — never commit keys). File transfer smoke uses the Host LocalSend port `http://127.0.0.1:53317/` unless disabled. Subagent load-only smoke: `npm run smoke:subagents`.

Two-machine deployment, systemd units, optional HTTPS, and env templates: [`docs/deployment/runbook.md`](./docs/deployment/runbook.md), [`deploy/README.md`](./deploy/README.md). Credentials live only in env files / a password manager, never in Git.

### Git state as of 2026-09-16

| Ref | SHA | Notes |
|---|---|---|
| Gitea `main` | `8213c064983f23824ae807adaefd84f37e138617` plus the commit that rewrote this file | Published baseline. `8213c06` is the cherry-pick of `96c3b93` (`/subagents-model`). |
| this machine’s cached `origin/main` | may still say `f76578f` | Stale if `origin` is `testpc:3000` and has not been fetched since 2026-09-03. Trust Gitea `main`, not that cache. |
| local `feat/subagents-global-model` | `08008f7` | Older local copy of handoff + `96c3b93`. Safe to ignore now that both are on `main`. |

`/subagents-model` is on `main` as [`src/subagents/model-policy.ts`](./src/subagents/model-policy.ts). Spec: [`docs/spec/subagents-plugin.md`](./docs/spec/subagents-plugin.md). Tests: [`test/subagent-model-policy.test.ts`](./test/subagent-model-policy.test.ts).

Tags on this clone: `v0.1.0-mvp.1`, `v0.1.0-mvp.2`. BACKLOG also records `v0.1.0-mvp.3` for FILE-001a; that tag is not in this clone’s tag list.

## What this product is

PI Coffee is the independent web MVP for the **unmodified original Pi coding agent**. Picode V5 is a frozen reference, not a source tree and not a ticket queue.

```text
Browser ── WebSocket ──> Web Server ── WebSocket ──> Host ── RPC ──> original Pi Agent
   \                                              └─ LocalSend v2 :53317 ──> User VM inbox
    \──────────────────────────────────────────────┘  (bytes never transit the Web Server)
```

Host owns Session lifetime. Closing the browser detaches transport; it does not stop Pi. Persistent transcripts, files, and plugin state stay in the User VM. The Control Plane/Relay holds the sole upstream model key and only bounded routing/usage metadata. File bytes go browser ↔ User VM (ADR-0009).

Domain language: [`CONTEXT.md`](./CONTEXT.md). Guardrails: [`AGENTS.md`](./AGENTS.md). Doc map: [`docs/index.md`](./docs/index.md).

## Read order for the next agent

1. [`AGENTS.md`](./AGENTS.md)
2. [`BACKLOG.md`](./BACKLOG.md) — decision register, status, non-goals, ticket order. Canonical Gitea twin: issue #13.
3. The Gitea issue for the ticket you are about to implement.
4. [`docs/spec/0.1.md`](./docs/spec/0.1.md) for planned 0.1 behaviour; trust tests/code for what already ships.
5. Relevant ADR under [`docs/adr/`](./docs/adr/) (through ADR-0009) and seam files in [`docs/development/workflow.md`](./docs/development/workflow.md).

Do not duplicate those documents here.

## Already shipped on `main` (do not rebuild)

Details and evidence live in [`BACKLOG.md`](./BACKLOG.md) and the linked issues. In short:

- Host/Web/Relay processes, frame protocol, Codex-style browser shell, session list/history from the User VM Pi store (ADR-0008).
- Harness Lean/Full prompts and frozen V5 8/10 tool tables via the Pi extension seam.
- Locked `pi-subagents@0.63.0` (optional `subagent` / `bg_wait`, Harness counts unchanged) plus `/subagents-model` global default in the User VM `settings.json`.
- Relay-backed Serper `web_search`, native research closure to User VM Markdown, official `pi-web-access@0.27.0` for non-conflicting content tools.
- `context-fold@0.4.0` loaded last as fail-open default compaction.
- Opt-in only (off by default): `pi-lens`, `rpiv-todo`, `pi-mcp-adapter`.
- **FILE-001a**: LocalSend v2 direct browser → User VM transfer, inbox under `.pi-coffee/inbox/<session>/`, progress chips, download API ([`docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md`](./docs/adr/0009-file-transfer-is-localsend-direct-to-the-user-vm.md), Host [`src/host/transfer.ts`](./src/host/transfer.ts)).
- **Optional HTTPS** for Web + transfer only (all-or-nothing). 0.1 stays HTTP. Private Host and Relay remain HTTP + bearer tokens.
- **Plugin panel**: read-only list of extensions/skills/prompts the current Pi process actually loaded (`get_extensions`). Enable/disable/install is still `ARCH-002` / `PLUGIN-001`.

Pinned Pi: `@earendil-works/pi-coding-agent@0.84.4`. Completion rule: a ticket is done only when acceptance evidence is on the Gitea issue and a fresh clone (or target VM) can run the documented check.

Code on `main` is the authority for implemented behaviour. Gitea issue **state** still lags: many DONE backlog rows have **open** issues waiting for evidence comments and closure. Do not reopen the implementation; close or comment with evidence.

## Next work (0.1)

P0 still `READY` in [`BACKLOG.md`](./BACKLOG.md):

1. **ID-001** — issue #8: Gitea OAuth, cookie lifecycle, fixed User VM/Host routing, fail-closed missing route.
2. **DEP-001** — issue #9: Linux Mint Xfce User VM Deployment Skill, systemd, one-time enrollment.
3. **SHELL-001** remainder — issue #10: one Browser Shell with multiple Tasks/Sessions, same-Task serial writes, cross-Task parallel. `SHELL-001a/b/c` are implemented; remaining product gap is Task orchestration plus roadmap E/F. Plugin panel is already shipped.
4. **FILE-001 remainder** — issue #11: Gitea-identity scoping (needs ID-001), inbox browse panel, large-image path fallback / `MODEL-001`. Do not reimplement LocalSend upload/download.
5. **OPS-001** — issue #12: failure semantics, health, snapshot restore, release evidence. Includes leftover **REC-001**: recover the in-flight turn across Host restart.

P1 reliability (code exists; real VM/Web evidence does not):

- **HARNESS-003** issue #16
- **SUBAGENT-002** issue #18
- **WEB-002** issue #24 (WEB-001 code is on `main`; issue #23 may only need evidence/close)

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

Change loop: failing test at the public seam → smallest slice → `npm run check` → update the Gitea issue with evidence. One active ticket per change.

## Hard constraints (already decided)

See [`BACKLOG.md`](./BACKLOG.md) section 4 and ADRs. Do not:

- Modify V5, import unfinished V5 implementation, or treat V5 issues as this queue.
- Put the upstream model key, cookies, VM credentials, transcripts, tool output, or file/image bodies into Git, Wiki, issues, or logs.
- Store durable conversation content or file bytes on the Web Server / Control Plane.
- Add a VM manager, in-VM command sandbox, or a second identity system beside Gitea.
- Use multi-tab as the product model (one Browser Shell / tab).
- Switch 0.1 to HTTPS by default (the optional route already exists).
- Introduce Rust without a measured bottleneck (`PERF-001`).

## Gitea at rewrite time (2026-09-16)

Issues remain the execution authority even when backlog status is `DONE`. Wayfinder / handoff: #1 (map), #6 (MVP → 0.1 handoff), #13 (backlog). Implementation tickets still open when last listed: #5, #7–#12, #14–#18, #23–#24.

Use `/awangs/pi-coffee/issues` on this Gitea. Hostname is environment-specific (`gitea:3000` or `testpc:3000`).

## Suggested skills

The next agent should load these skills with the Skill tool when the matching work starts:

- **tdd** — red → green at the public Host/Web/protocol/transfer seam; required by [`docs/development/workflow.md`](./docs/development/workflow.md).
- **diagnosing-bugs** — smoke, Relay, reconnect, LocalSend, or VM failures.
- **domain-modeling** — any change to [`CONTEXT.md`](./CONTEXT.md) or a new ADR.
- **codebase-design** — keeping the Pi adapter small; new seams for OAuth, enrollment, remaining FILE-001.
- **research** — remaining discovery (`PERF-001`, capability detection, enrollment token design).
- **wizard** — human-only Gitea OAuth app, systemd, and secret-store steps on the other computer.
- **code-review** — before merging a branch/PR.
- **no-mistakes** — only when the user asks to validate/ship.
- **writing-for-agents** — only if [`AGENTS.md`](./AGENTS.md) itself must change.
- **resolving-merge-conflicts** — only if a merge/rebase is already in progress.

Do not load V5-oriented workflows into this repository. Do not follow [`docs/development/handoff-import.md`](./docs/development/handoff-import.md) unless `main` is empty (it is not).

## Out of scope for this brief

- Raw prior chat / grill transcripts (never exported; conclusions are in [`BACKLOG.md`](./BACKLOG.md)).
- Gitea Wiki (`DOC-001` / [`docs/development/wiki-publish.md`](./docs/development/wiki-publish.md) — Git remains the source).
- Secrets, cookies, VM snapshots, and live session files (gitignored: `.env`, `.pi/`, `sessions/`).
- Coverage audit of the original design discussion: [`docs/research/handoff-completeness-audit-20260903.md`](./docs/research/handoff-completeness-audit-20260903.md).
