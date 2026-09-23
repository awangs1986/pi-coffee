# PI Coffee Agent Runtime handoff entrypoint

This repository owns the User VM Agent Runtime. The browser shell, Gitea OAuth,
fixed user routing and centralized Relay live in `awangs/pi-coffee-server`.
The frozen Picode V5 repository remains reference-only.

## First read

1. Read [`docs/index.md`](./docs/index.md).
2. Read [`BACKLOG.md`](./BACKLOG.md) for scope and status.
3. Read the linked Gitea Issue before changing scope.
4. For native Codex/Claude Code integration, read [`docs/spec/native-agent-engines.md`](./docs/spec/native-agent-engines.md) and ADR-0013; this is planned support and Pi customizations must stay Pi-only.
5. For Agent changes, read [`docs/spec/pi-agent.md`](./docs/spec/pi-agent.md) and the relevant specialist SPEC.

## Working rules

- Keep Pi internals behind the Pi Adapter Interface; Host code consumes only that Interface.
- Treat [`docs/protocol.md`](./docs/protocol.md) and `src/shared/protocol.ts` as the external Server ↔ Host seam.
- Preserve Host session lifetime across browser and gateway disconnects.
- Do not add browser UI, Gitea OAuth, public routing or centralized upstream credentials to this repository.
- Preserve VM ownership of transcripts, contexts, checkouts, uploads and artifacts; synchronized code belongs in Gitea.
- Follow ADR-0012 and `docs/spec/gitea-workspaces.md` for owner privileges, Gitea authority and the T0–T4 migration; do not treat accepted design as deployed behavior.
- Use red → green at the public seam and run `npm run check` before reporting completion.
- Keep credentials, cookies, VM snapshots and user transcripts out of commits and Issues.
- Product mode documentation uses only Chat/Work; retired slash modes stay in Git history.

## Completion criterion

A ticket is ready to close only when its acceptance evidence is recorded in the
Issue and a fresh clone can run the documented check or deployment probe.

## Agent skills

### Issue tracker

Issues are tracked in Gitea `awangs/pi-coffee`. See [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md).

### Triage labels

Use the five default triage labels. See [docs/agents/triage-labels.md](./docs/agents/triage-labels.md).

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`. See [docs/agents/domain.md](./docs/agents/domain.md) for consumer rules.
