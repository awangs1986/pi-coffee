# PI Coffee Agent Runtime

This repository owns the User VM side of PI Coffee: the long-lived Agent Host,
original Pi adapter, native extensions, Chat/Work Harness, tools, Skills, LSP
middle layer, subagents, workspaces, transfers and the canonical Host wire
protocol.

The browser shell and Control Plane now live in
[`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server).

## Repository seam

```text
PI Coffee Server ──versioned WS/HTTP──> Agent Host ──RPC──> original Pi
                                             │
                                             ├── workspaces / Git / transfers
                                             └── extensions / tools / Skills / LSP
```

The Host owns session lifetime and durable state in the User VM. A browser or
Web gateway disconnect only detaches transport; it does not cancel accepted
Agent work. [`docs/protocol.md`](./docs/protocol.md) is the canonical external
Interface consumed by PI Coffee Server.

## Development

Requires Node.js 22.19 or newer.

```bash
npm ci
npm run check
```

Start the User VM runtime:

```bash
npm start
```

Important configuration:

| Variable | Purpose |
|---|---|
| `PI_COFFEE_HOST_BIND` / `PI_COFFEE_HOST_PORT` | private Host listener |
| `PI_COFFEE_HOST_TOKEN` | required for non-loopback Host access |
| `PI_COFFEE_WORKDIR` | default Pi working directory |
| `PI_COFFEE_PROJECT_ROOT` | enables project/conversation workspaces |
| `PI_COFFEE_AGENT_DIR` / `PI_COFFEE_SESSION_DIR` | Pi configuration and native session store |
| `PI_COFFEE_PROVIDER` / `PI_COFFEE_MODEL` | optional explicit model selection |
| `PI_COFFEE_TRANSFER_BIND` / `PI_COFFEE_TRANSFER_PORT` | User VM transfer listener |
| `PI_COFFEE_SEARCH_URL` | optional Control Plane search Relay endpoint |

## Agent design

- [`docs/spec/pi-agent.md`](./docs/spec/pi-agent.md): Chat/Work, extensions, context and acceptance state.
- [`docs/spec/harness-prompt.md`](./docs/spec/harness-prompt.md): Work system prompt.
- [`docs/spec/work-tools.md`](./docs/spec/work-tools.md): Work tool inventory.
- [`docs/spec/lsp-middle-layer.md`](./docs/spec/lsp-middle-layer.md): `coffee-lsp` CLI and Skill.
- [`docs/protocol.md`](./docs/protocol.md): external Host protocol.
- [`docs/deployment/runbook.md`](./docs/deployment/runbook.md): User VM installation and probes.

## Chat / Work

New sessions default to Work. Use `/chat`, `/work`, or `/harness chat|work`;
`/harness` shows the effective mode and tools. The Web command menu gets these
commands from the Host automatically.

Chat sends no system prompt and exposes read, edit, write, bash and web_search.
Work keeps Pi Base, project guidance and Skills, adds the software-development
body, and exposes read, edit, write, bash, git and search_tools (plus recall_folded
when installed). Web and subagents are activated on demand; LSP uses the native
Skill and CLI. Mode changes preserve conversation history.

Pre-v2 development sessions migrate to Work with a notice and new v2 state;
retired command aliases are rejected. See [migration evidence](docs/reviews/chat-work-migration-20260922.md).
