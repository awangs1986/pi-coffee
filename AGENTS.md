# PI Coffee handoff entrypoint

PI Coffee is the independent product in this repository. The current Picode Gitea repository named V5 is a frozen reference; do not edit it, split it, or import its unfinished implementation while working here.

## First read

1. Read [`docs/index.md`](./docs/index.md) to choose the relevant branch of the documentation.
2. Read [`BACKLOG.md`](./BACKLOG.md) for the discussion-derived scope, status, dependencies, open questions, and explicit non-goals.
3. Read the linked Gitea Issue before changing scope: [PI Coffee map](http://testpc:3000/awangs/pi-coffee/issues/1).
4. For Pi Agent design, read the living [`docs/spec/pi-agent.md`](./docs/spec/pi-agent.md) first, then the relevant specialist SPEC (Work prompt: [`harness-prompt.md`](./docs/spec/harness-prompt.md)). Its confirmed Chat/Work decisions supersede historical mode descriptions; code/tests still define what is actually implemented. Other release scope remains in [`docs/spec/0.1.md`](./docs/spec/0.1.md) and its ticket links.

## Working rules

- Keep the Pi adapter behind its small interface; the Host and Web Server must not import Pi internals directly.
- Preserve the Host session lifetime across browser disconnects.
- Use the red → green loop at the public seam for each change. Run `npm run check` before reporting completion.
- Keep credentials, cookies, VM snapshots, and user transcripts out of commits and Issues.
- Maintain the SPEC alongside discussions and changes: record confirmed decisions and rationale, unresolved questions, implementation status, and acceptance evidence under stable PA/WP IDs. Dated reviews do not replace the living contract; mark superseded statements and update entrypoints. See [`docs/development/workflow.md`](./docs/development/workflow.md).
- Record scope/status changes in the corresponding Gitea Issue. If it is unreachable, record pending synchronization locally, not a claimed remote acceptance. Do not silently turn a planned 0.1 item into a V5 change.

## Completion criterion

A ticket is ready to close only when its acceptance evidence is recorded in the Issue and a fresh clone can run the documented check or deployment probe that demonstrates it.
