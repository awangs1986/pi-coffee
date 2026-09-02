# PI Coffee handoff entrypoint

PI Coffee is the independent product in this repository. The current Picode Gitea repository named V5 is a frozen reference; do not edit it, split it, or import its unfinished implementation while working here.

## First read

1. Read [`docs/index.md`](./docs/index.md) to choose the relevant branch of the documentation.
2. Read the linked Gitea Issue before changing scope: [PI Coffee map](http://testpc:3000/awangs/pi-coffee/issues/1).
3. For the current implementation, trust the code and tests in this checkout; for planned behaviour, trust [`docs/spec/0.1.md`](./docs/spec/0.1.md) and its ticket links.

## Working rules

- Keep the Pi adapter behind its small interface; the Host and Web Server must not import Pi internals directly.
- Preserve the Host session lifetime across browser disconnects.
- Use the red → green loop at the public seam for each change. Run `npm run check` before reporting completion.
- Keep credentials, cookies, VM snapshots, and user transcripts out of commits and Issues.
- Record scope/status changes in the corresponding Gitea Issue. Do not silently turn a planned 0.1 item into a V5 change.

## Completion criterion

A ticket is ready to close only when its acceptance evidence is recorded in the Issue and a fresh clone can run the documented check or deployment probe that demonstrates it.
