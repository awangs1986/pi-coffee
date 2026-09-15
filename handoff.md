# PI Coffee handoff

Generated: 2026-09-15  
Purpose: continue PI Coffee development on another computer from a fresh agent session.  
This file is a resume brief, not a second spec. Read the linked files instead of reconstructing decisions from chat.

## Resume Here

- First next action: On the other computer, clone this repository, bring over unpublished commit `96c3b93`, run `npm ci && npm run check`, then start the next P0 0.1 slice **ID-001 / Gitea issue #8** (Gitea OAuth and fixed User VM routing). If the session is instead continuing the Codex-style shell, take **E1 / E2 / E4** in [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md).
- Do not restart: do not recreate the MVP, do not edit the frozen Picode V5 repository, do not re-import [`docs/development/handoff-import.md`](./docs/development/handoff-import.md), do not re-evaluate forking `pi-web`, and do not copy V5 Guard / permission approvals / in-process sandbox into this tree.

## Checkout on the other computer

The published remote is Gitea `awangs/pi-coffee`, default branch `main`. This workstation’s `origin` is `http://testpc:3000/awangs/pi-coffee.git`; the same repo is also reachable as `http://gitea:3000/awangs/pi-coffee.git` depending on local DNS/hosts. Use whichever hostname the other computer already uses for this Gitea.

```bash
git clone http://gitea:3000/awangs/pi-coffee.git
cd pi-coffee
git status -sb
npm ci
npm run check
```

Need Node.js `>= 22.19`. After `npm run check`, local smoke is `npm start` (Web `http://127.0.0.1:3000/`, Host `ws://127.0.0.1:8788/host`, Relay `http://127.0.0.1:8789/v1` if a Relay key is configured in the environment — never commit keys). Subagent load-only smoke: `npm run smoke:subagents`.

Two-machine deployment, systemd units, and env templates: [`docs/deployment/runbook.md`](./docs/deployment/runbook.md), [`deploy/README.md`](./deploy/README.md). Credentials live only in env files / a password manager, never in Git.

### Git state that will not appear on a plain clone of `main`

Recorded on the source workstation at 2026-09-15:

| Ref | SHA | Notes |
|---|---|---|
| `origin/main` | `f76578f5a7bfd5db3643f7a8b9117365b168bb59` | Published baseline. Latest merge: PR #31 VM smoke evidence. Tags: `v0.1.0-mvp.1`, `v0.1.0-mvp.2`. |
| current branch `feat/subagents-global-model` | `96c3b932c93fa9a9aeae4ebe9bae7318763da0f8` plus the commit that added this file | **Not on the remote.** Two commits ahead of `origin/main`. |
| local `main` | `c014faf` | Stale, 26 commits behind `origin/main`. Ignore it. Do not reset from this ref. |

Unpublished commit `96c3b93` (`feat(subagents): add global model configuration command`) adds `/subagents-model` and [`src/subagents/model-policy.ts`](./src/subagents/model-policy.ts). Spec delta: [`docs/spec/subagents-plugin.md`](./docs/spec/subagents-plugin.md). Tests: [`test/subagent-model-policy.test.ts`](./test/subagent-model-policy.test.ts). Carry this commit to the other computer (push a branch, or `git format-patch` / bundle) **before** continuing subagent work, otherwise a fresh clone will miss it.

This branch is configured to track `origin/main`, not a remote feature branch. Do not `git push` blindly onto `main`. Publish as `feat/subagents-global-model` (or cherry-pick onto a PR branch) first.

Other local branches exist (`feat/pi-mcp-adapter-optional-tool` is ahead of its remote; several others are behind). They are not required to resume 0.1 work from `origin/main` + `96c3b93`.

## What this product is

PI Coffee is the independent web MVP for the **unmodified original Pi coding agent**. Picode V5 is a frozen reference, not a source tree and not a ticket queue.

```text
Browser ── WebSocket ──> Web Server ── WebSocket ──> Host ── RPC ──> original Pi Agent
```

Host owns Session lifetime. Closing the browser detaches transport; it does not stop Pi. Persistent transcripts, files, and plugin state stay in the User VM. The Control Plane/Relay holds the sole upstream model key and only bounded routing/usage metadata.

Domain language: [`CONTEXT.md`](./CONTEXT.md). Guardrails: [`AGENTS.md`](./AGENTS.md). Doc map: [`docs/index.md`](./docs/index.md).

## Read order for the next agent

1. [`AGENTS.md`](./AGENTS.md)
2. [`BACKLOG.md`](./BACKLOG.md) — decision register, status, non-goals, ticket order. Canonical Gitea twin: issue #13.
3. The Gitea issue for the ticket you are about to implement.
4. [`docs/spec/0.1.md`](./docs/spec/0.1.md) for planned 0.1 behaviour; trust tests/code for what already ships.
5. Relevant ADR under [`docs/adr/`](./docs/adr/) and seam files listed in [`docs/development/workflow.md`](./docs/development/workflow.md).

Do not duplicate those documents here.

## Already shipped (do not rebuild)

MVP vertical slice and several 0.1 slices are in `origin/main`. Details and evidence live in [`BACKLOG.md`](./BACKLOG.md) and the linked issues. In short:

- Host/Web/Relay processes, frame protocol, Codex-style browser shell, session list/history from the User VM Pi store (ADR-0008).
- Harness Lean/Full prompts and frozen V5 8/10 tool tables via the Pi extension seam.
- Locked `pi-subagents@0.63.0` (optional `subagent` / `bg_wait`, Harness counts unchanged).
- Relay-backed Serper `web_search`, native research closure to User VM Markdown, official `pi-web-access@0.27.0` for non-conflicting content tools.
- `context-fold@0.4.0` loaded last as fail-open default compaction.
- Opt-in only (off by default): `pi-lens`, `rpiv-todo`, `pi-mcp-adapter`.

Pinned Pi: `@earendil-works/pi-coding-agent@0.84.4`. Completion rule: a ticket is done only when acceptance evidence is on the Gitea issue and a fresh clone (or target VM) can run the documented check.

Code already on `main` is the authority for implemented behaviour. Gitea issue **state** still lags: many DONE backlog rows have **open** issues waiting for evidence comments and closure. Do not reopen the implementation; close or comment with evidence.

## Next work (0.1)

P0 still `READY` in [`BACKLOG.md`](./BACKLOG.md), execution order from section 6:

1. **ID-001** — issue #8: Gitea OAuth, cookie lifecycle, fixed User VM/Host routing, fail-closed missing route. Unblocks multi-user shell assumptions.
2. **DEP-001** — issue #9: Linux Mint Xfce User VM Deployment Skill, systemd, one-time enrollment.
3. **SHELL-001** remainder — issue #10: one Browser Shell with multiple Tasks/Sessions, same-Task serial writes, cross-Task parallel. `SHELL-001b` (native session store) and `SHELL-001c` (Codex-style A/B/C) and `SHELL-001a` (extension UI) are already implemented; remaining product gap is Task orchestration plus roadmap E/F.
4. **FILE-001** — issue #11: Task inbox upload, image bytes in the User VM, scoped download refs.
5. **OPS-001** — issue #12: failure semantics, health, snapshot restore, release evidence. Includes leftover **REC-001**: recover the in-flight turn across Host restart.

P1 reliability (code exists; real VM/Web evidence does not):

- **HARNESS-003** issue #16
- **SUBAGENT-002** issue #18
- **WEB-002** issue #24 (WEB-001 code is on `main`; issue #23 may only need evidence/close)

Web shell next UX (not a new architecture): E1 completion notifications, E2 `get_state` resync, E4 readable 401/429/timeout errors — [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md).

Open engineering questions (`OPEN-001` …) stay in [`BACKLOG.md`](./BACKLOG.md) section 5. Answer them in the owning issue/ADR, not by oral convention.

## Seams to touch

From [`docs/development/workflow.md`](./docs/development/workflow.md):

- [`src/shared/protocol.ts`](./src/shared/protocol.ts)
- [`src/host/pi-adapter.ts`](./src/host/pi-adapter.ts)
- [`src/host/session.ts`](./src/host/session.ts)
- [`src/host/server.ts`](./src/host/server.ts)
- [`src/web/host-client.ts`](./src/web/host-client.ts)
- [`src/web/server.ts`](./src/web/server.ts)

Browser shell is build-free ES modules under [`public/`](./public/). `npm run build` copies vendored `marked` / `DOMPurify` into gitignored `public/vendor-*.js` and `dist/public/`.

Change loop: failing test at the public seam → smallest slice → `npm run check` → update the Gitea issue with evidence. One active ticket per change.

## Hard constraints (already decided)

See [`BACKLOG.md`](./BACKLOG.md) section 4 and ADRs. Do not:

- Modify V5, import unfinished V5 implementation, or treat V5 issues as this queue.
- Put the upstream model key, cookies, VM credentials, transcripts, tool output, or file/image bodies into Git, Wiki, issues, or logs.
- Store durable conversation content on the Web Server / Control Plane.
- Add a VM manager, in-VM command sandbox, or a second identity system beside Gitea.
- Use multi-tab as the product model (one Browser Shell / tab).
- Introduce Rust without a measured bottleneck (`PERF-001`).

## Gitea at handoff time (2026-09-15)

Open issues: 17. Open PRs: 0. Issues remain the execution authority even when backlog status is `DONE`.

Wayfinder / handoff: #1 (map), #6 (MVP → 0.1 handoff), #13 (backlog).  
Still-open implementation tickets: #5, #7–#12, #14–#18, #23–#24.

Use the issue tracker in this Gitea repo (`/awangs/pi-coffee/issues`). Hostname is environment-specific (`gitea:3000` or `testpc:3000`).

## Suggested skills

The next agent should load these skills with the Skill tool when the matching work starts:

- **tdd** — red → green at the public Host/Web/protocol seam; required by [`docs/development/workflow.md`](./docs/development/workflow.md).
- **diagnosing-bugs** — smoke, Relay, reconnect, or VM failures.
- **domain-modeling** — any change to [`CONTEXT.md`](./CONTEXT.md) or a new ADR.
- **codebase-design** — keeping the Pi adapter small; new seams for OAuth, enrollment, uploads.
- **research** — remaining discovery (`PERF-001`, capability detection, enrollment token design).
- **wizard** — human-only Gitea OAuth app, systemd, and secret-store steps on the other computer.
- **code-review** — before merging a branch/PR.
- **no-mistakes** — only when the user asks to validate/ship.
- **writing-for-agents** — only if [`AGENTS.md`](./AGENTS.md) itself must change.
- **resolving-merge-conflicts** — only if a merge/rebase is already in progress.

Do not load V5-oriented workflows into this repository. Do not follow [`docs/development/handoff-import.md`](./docs/development/handoff-import.md) unless `origin/main` is empty (it is not).

## Out of scope for this brief

- Raw prior chat / grill transcripts (never exported; conclusions are in [`BACKLOG.md`](./BACKLOG.md)).
- Gitea Wiki (`DOC-001` / [`docs/development/wiki-publish.md`](./docs/development/wiki-publish.md) — Git remains the source).
- Secrets, cookies, VM snapshots, and live session files (gitignored: `.env`, `.pi/`, `sessions/`).
- Coverage audit of the original design discussion: [`docs/research/handoff-completeness-audit-20260903.md`](./docs/research/handoff-completeness-audit-20260903.md).
