# PI Coffee Server

PI Coffee Server is the browser and Control Plane half of PI Coffee. It serves
the Web shell, authenticates users with Gitea, routes each user to a fixed
private User VM, transparently bridges WebSocket and workspace traffic to the
Agent Host, and optionally runs the centralized LLM/Search Relay.

The Agent Runtime lives in [`awangs/pi-coffee`](http://gitea:3000/awangs/pi-coffee).
That repository owns Pi integration, sessions, workspaces, tools, Skills, LSP,
uploads and the canonical Host protocol.

## Repository seam

```text
Browser ──HTTPS/WSS──> PI Coffee Server ──private WS/HTTP──> Agent Host ──RPC──> Pi
                              │
                              └── optional Relay ──> model/search upstream
```

The Web gateway does not interpret Agent frames. Identity, fixed routing and
streaming belong here; execution and durable content belong to the User VM.

## Development

Requires Node.js 22.19 or newer.

```bash
npm ci
npm run check
```

The check builds both entrypoints and runs the Web, identity, Relay and browser
view tests. The Web seam test uses a fake network Host and verifies that a frame
unknown to this Server version is forwarded unchanged.

Start the processes separately:

```bash
npm run start:web
npm run start:relay
```

Web configuration is documented in [`deploy/server/web.env.example`](./deploy/server/web.env.example).
Relay configuration is documented in [`deploy/server/relay.env.example`](./deploy/server/relay.env.example).
Deployment instructions are in [`docs/deployment/runbook.md`](./docs/deployment/runbook.md).

## Interface ownership

[`docs/host-interface.md`](./docs/host-interface.md) records how this repository
consumes the Agent Host Interface. Wire definitions and compatibility changes
are made in the Agent repository first; this repository validates them through
cross-repository smoke tests rather than carrying a second protocol implementation.
