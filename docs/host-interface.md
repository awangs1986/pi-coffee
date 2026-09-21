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

[ADR-0012](./adr/0012-owner-privileges-and-gitea-checkouts.md) keeps checkout/Git/Gitea code API operations in Host. Server displays Host-provided synchronization and PR state; OAuth credentials are not VM Git credentials. T1/T2 introduce additive workspace capabilities; T3 detects them before exposing new actions; T4 removes old local merge actions only after rollout and migration evidence. Any incompatible removal requires an explicit protocol compatibility decision. This document does not claim the new contract is already implemented.
