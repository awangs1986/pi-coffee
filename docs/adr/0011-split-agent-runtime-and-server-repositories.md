# ADR-0011: Split Agent Runtime and Server repositories

- Date: 2026-09-21
- Status: accepted and implemented; Gitea Agent `cbe0920`, Server `e6f1082`

## Decision

`awangs/pi-coffee` owns the User VM Agent Runtime: Host, Pi Adapter, canonical
wire protocol, workspaces, transfers, Harness, extensions, tools, Skills, LSP
and subagents.

`awangs/pi-coffee-server` owns the browser shell and Control Plane: Web gateway,
Gitea identity, fixed per-user routing, server deployment and optional
LLM/Search Relay.

The Web gateway is a transparent Adapter. It authenticates and chooses a Host,
then forwards WebSocket frames without duplicating Host protocol parsing.
`pi-coffee` remains the provider and owner of the external Interface.

## Consequences

- Each repository aligns with one deployment and credential domain.
- Agent and Server can build, test, release and restart independently.
- Web/Relay dependencies no longer enlarge the User VM runtime.
- Cross-repository compatibility is checked at the public WS/HTTP seam.
- Server changes must accept the currently deployed Host version; Host changes
  ship backward-compatible first and remove old behavior only after Server rollout.
