# PI Coffee

PI Coffee is the independent MVP track for using the original Pi coding agent from a web page.

The current latest Picode repository on Gitea is **V5** and is intentionally frozen. This directory and the main repository [`awangs/pi-coffee`](http://testpc:3000/awangs/pi-coffee) are the only places for PI Coffee work.

## MVP outcome

```text
Browser  ── WebSocket ──>  Web Server  ── WebSocket ──>  Host  ── RPC ──>  original Pi Agent
   ^                            ^                         |
   └──── streamed Events ──────┴─────────────────────────┘
```

- `Host` owns a long-lived Pi process for each Session.
- Closing or refreshing the browser detaches the connection; it does not stop the Session.
- Reconnecting with the Session ID and Cursor replays buffered Events.
- The Web Server has no Pi implementation knowledge; the Pi-specific code is one adapter.
- The MVP intentionally does not include V5 Guard, Worktree, Gitea integration, task orchestration, uploads, or image handling.

The Pi adapter uses the upstream package's documented RPC client and is pinned to `@earendil-works/pi-coding-agent@0.84.4` for this first slice. See the upstream [RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) for the underlying command/event semantics.

## Run locally

```bash
npm install
npm run check
npm run build
npm start
```

`npm start` starts both processes in one Node process for a local smoke run:

- Web Server: `http://127.0.0.1:3000/`
- Host: `ws://127.0.0.1:8788/host`

For a split deployment, run `npm run start:host` in the User VM and `npm run start:web` on the Web VM. Set `PI_COFFEE_HOST_URL` on the Web Server to the Host address.

Useful settings:

| Variable | Default | Meaning |
|---|---:|---|
| `PI_COFFEE_WEB_BIND` | `127.0.0.1` | Web Server bind address |
| `PI_COFFEE_WEB_PORT` | `3000` | Web Server port |
| `PI_COFFEE_HOST_BIND` | `127.0.0.1` | Host bind address |
| `PI_COFFEE_HOST_PORT` | `8788` | Host port |
| `PI_COFFEE_HOST_URL` | local Host URL | Web→Host WebSocket URL |
| `PI_COFFEE_HOST_TOKEN` | unset | Optional shared Host bearer token |
| `PI_COFFEE_WORKDIR` | current directory | Pi working directory |
| `PI_COFFEE_AGENT_DIR` | Pi default | Pi config directory (`models.json`, `auth.json`) |
| `PI_COFFEE_SESSION_DIR` | Pi default | Native Pi session directory |
| `PI_COFFEE_PROVIDER` | Pi default | Optional Pi provider |
| `PI_COFFEE_MODEL` | Pi default | Optional Pi model |

The first MVP uses Pi's normal credential resolution on the Host VM so the conversation path can be tested without putting a credential in this repository. Moving the upstream credential behind the central Relay is a subsequent PI Coffee ticket, not part of this first vertical slice.

## Repository tickets

- [PI Coffee map and MVP outcome](http://testpc:3000/awangs/pi-coffee/issues/1)
- [Host/Web Server protocol and continuity](http://testpc:3000/awangs/pi-coffee/issues/2)
- [Original Pi Host adapter](http://testpc:3000/awangs/pi-coffee/issues/3)
- [Web Server and browser shell](http://testpc:3000/awangs/pi-coffee/issues/4)
- [End-to-end verification and runbook](http://testpc:3000/awangs/pi-coffee/issues/5)
