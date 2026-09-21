# PI Coffee Server handoff entrypoint

This repository owns the browser shell and Control Plane side of PI Coffee.
The Agent Host, Pi extensions, tools, Skills, LSP layer, workspaces and durable
user data belong to `awangs/pi-coffee` and must not be implemented here.

## First read

1. Read [`docs/index.md`](./docs/index.md).
2. Read [`docs/host-interface.md`](./docs/host-interface.md) before changing Host transport behavior.
3. Read the corresponding Gitea Issue before changing product scope.

## Working rules

- Keep the Web gateway a transparent Adapter at the Host protocol seam. It may authenticate, choose a fixed Host route and stream bytes; it must not parse Pi events or own Agent session state.
- Keep Gitea credentials, Host tokens, upstream keys, cookies, transcripts and file bodies out of commits, Issues and logs.
- Web/Relay restarts must not stop Agent Host sessions.
- Durable transcripts, checkouts, uploads and artifacts remain in the owning User VM; Gitea owns synchronized code.
- The Agent repository owns ADR-0012 / `docs/spec/gitea-workspaces.md`; Server consumes Host workspace/PR status and does not implement Git or local merge coordination.
- Use tests at the HTTP/WebSocket Interface and run `npm run check` before reporting completion.
- The canonical Host protocol is owned by `awangs/pi-coffee`; do not copy its TypeScript implementation into this repository.

## Completion criterion

A change is complete when `npm run check` passes from a clean clone and its
acceptance evidence is recorded in the relevant Gitea Issue.
