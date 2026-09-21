# PI Coffee Agent Runtime handoff entrypoint

This repository owns the User VM Agent Runtime. The browser shell, Gitea OAuth,
fixed user routing and centralized Relay live in `awangs/pi-coffee-server`.
The frozen Picode V5 repository remains reference-only.

## First read

1. Read [`docs/index.md`](./docs/index.md).
2. Read [`BACKLOG.md`](./BACKLOG.md) for scope and status.
3. Read the linked Gitea Issue before changing scope.
4. For Agent changes, read [`docs/spec/pi-agent.md`](./docs/spec/pi-agent.md) and the relevant specialist SPEC.

## Working rules

- Keep Pi internals behind the Pi Adapter Interface; Host code consumes only that Interface.
- Treat [`docs/protocol.md`](./docs/protocol.md) and `src/shared/protocol.ts` as the external Server ↔ Host seam.
- Preserve Host session lifetime across browser and gateway disconnects.
- Do not add browser UI, Gitea OAuth, public routing or centralized upstream credentials to this repository.
- Preserve VM ownership of transcripts, contexts, worktrees, uploads and artifacts.
- Use red → green at the public seam and run `npm run check` before reporting completion.
- Keep credentials, cookies, VM snapshots and user transcripts out of commits and Issues.
- Product mode documentation uses only Chat/Work; retired slash modes stay in Git history.

## Completion criterion

A ticket is ready to close only when its acceptance evidence is recorded in the
Issue and a fresh clone can run the documented check or deployment probe.
