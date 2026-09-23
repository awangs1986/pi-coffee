# Agent Host Interface

The canonical Interface is owned by the Agent Runtime repository:

- [wire protocol](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/protocol.md)
- [protocol implementation](http://gitea:3000/awangs/pi-coffee/src/branch/main/src/shared/protocol.ts)

PI Coffee Server is a transparent Adapter at this seam:

1. Gitea identity selects one administrator-controlled `hostUrl` and `hostToken`.
2. `/ws` frames are forwarded without parsing or translating Agent event types.
3. `/api/workspace` requests are authenticated and forwarded to the same Host.
4. Closing a browser connection only detaches its Host transport; it does not cancel a Host session.
5. Gateway-generated transport errors use the current `v: 1` error envelope. All Agent behavior and validation remain owned by the Host.

The current consumer baseline is Host protocol `v: 1`. A Host change is compatible
when the existing browser vocabulary continues to work and unknown future frames
can pass through this gateway unchanged. Cross-repository release order is:

1. publish a backward-compatible Agent Host;
2. run this repository's smoke against that Host revision;
3. deploy Server;
4. remove old Host behavior only after every deployed Server has moved forward.

## Planned workspace transition

[ADR-0012](./adr/0012-owner-privileges-and-gitea-checkouts.md) keeps Checkout/Git/Gitea code API operations in Host. Server displays Host-provided synchronization and PR state; OAuth credentials are not VM Git credentials. The current UI forwards the additive status/checkpoint/PR/migration actions and no longer exposes old local merge actions. Deployment compatibility and migration evidence remain T4 acceptance work.


## Conversation directories (2026-09-22)

The UI consumes Host `capabilities.chatWorkspaces`, `workspaceKind`, creation state,
absolute display cwd, actual branch and last remote check. New Chat needs no Project;
new Work selects Project/start branch and calls `conversation` with a stable creation ID.
The `branches` action supplies the remote picker. Failed creation retries reuse the ID.
All file bytes, including original inline images, go through the scoped streaming gateway
into the owning VM inbox before a prompt can reference them. No central file persistence.
Archive retains running work and files; permanent cleanup explicitly covers local files
and history, retains remote objects and legacy global data, and requires the exact ID.
The protocol additions and lifecycle guarantees are defined by Agent `docs/protocol.md`.

## Planned native engines (2026-09-23)

The [Agent native-engine SPEC](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/native-agent-engines.md) owns the planned additive contract for engine selection, native Session bindings, capabilities and common presentation Events. The Agent Host remains responsible for native transport, configuration and lifecycle; the gateway continues to forward the existing public HTTP/WebSocket traffic without interpreting engine protocols or handling provider authentication. Legacy Pi compatibility must be verified before activation.

The [Browser Shell companion](./spec/native-agent-browser.md) preserves the existing layout and scopes all Pi-specific controls to Pi. Agent delivery: [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48). Server delivery: [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). These are implementation requirements, not a claim that the currently deployed Host or Server supports Codex or Claude Code.
