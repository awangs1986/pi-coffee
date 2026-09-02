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
- PI Coffee does not include V5 Guard, permission approvals, managed snapshots, or Devloop enforcement. The native Harness extension exposes the frozen V5 8/10 tool tables; its `git` adapter is limited to native status/diff and basic native worktree operations. The locked `pi-subagents@0.63.0` extension is now loaded in the Agent Host as an optional delegation capability; its tools do not change the Harness 8/10 base counts. Gitea integration, task orchestration, uploads, and image handling remain separate tickets.

The Pi adapter uses the upstream package's documented RPC client and is pinned to `@earendil-works/pi-coding-agent@0.84.4` for this first slice. See the upstream [RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) for the underlying command/event semantics.

## Run locally

```bash
npm install
npm run check
npm run build
npm start
```

要只验证 `pi-subagents` 的加载（不调用模型），运行
`npm run smoke:subagents`。

`npm start` runs Host + Web (and the Relay, if `PI_COFFEE_UPSTREAM_KEY` is set) in one Node process for a local smoke run:

- Web Server: `http://127.0.0.1:3000/`
- Host: `ws://127.0.0.1:8788/host`
- Relay: `http://127.0.0.1:8789/v1`

The MVP deployment is split across two machines: `npm run start:host` in the
User VM (original Pi runs there, as the VM owner), `npm run start:web` and
`npm run start:relay` on the server. systemd units and env templates are in
[`deploy/`](./deploy/README.md); the procedure is in
[`docs/deployment/runbook.md`](./docs/deployment/runbook.md).

Settings:

| Variable | Default | Process | Meaning |
|---|---:|---|---|
| `PI_COFFEE_WEB_BIND` / `PI_COFFEE_WEB_PORT` | `127.0.0.1` / `3000` | web | browser-facing bind |
| `PI_COFFEE_HOST_URL` | local Host URL | web | Web→Host WebSocket URL |
| `PI_COFFEE_HOST_BIND` / `PI_COFFEE_HOST_PORT` | `127.0.0.1` / `8788` | host | private Host transport bind |
| `PI_COFFEE_HOST_TOKEN` | unset | web, host | shared Host bearer token; **required** when the Host is not on loopback |
| `PI_COFFEE_WORKDIR` | current directory | host | Pi working directory |
| `PI_COFFEE_AGENT_DIR` | Pi default | host | Pi config directory (`models.json`) |
| `PI_COFFEE_SESSION_DIR` | Pi default | host | native Pi session directory |
| `PI_COFFEE_PROVIDER` / `PI_COFFEE_MODEL` | Pi default | host | provider/model from `models.json` |
| `PI_COFFEE_RELAY_TOKEN` | unset | host | this VM's Relay token, interpolated by Pi from `models.json` |
| `PI_COFFEE_RELAY_BIND` / `PI_COFFEE_RELAY_PORT` | `127.0.0.1` / `8789` | relay | Relay bind |
| `PI_COFFEE_UPSTREAM_URL` | `https://b.awangsawangs.xyz/v1` | relay | upstream OpenAI-compatible base URL |
| `PI_COFFEE_UPSTREAM_KEY` | unset | relay | the sole upstream key; **only** the Relay has it |
| `PI_COFFEE_RELAY_TOKENS` | unset | relay | comma-separated Host tokens; **required** when not on loopback |
| `PI_COFFEE_EXTENSIONS` | bundled Harness + pi-subagents | host | colon-separated Pi extension paths replacing the defaults; set to `off` to disable all extensions |
| `PI_COFFEE_SUBAGENTS` | enabled | host | set to `off`/`0`/`false`/`no` to disable only the packaged pi-subagents extension |

The upstream credential lives only in the Relay process on the server. Hosts
in User VMs authenticate to the Relay with their own token and never see the
upstream key. Nothing in this repository contains a credential.

The frame contract is recorded in [`docs/protocol.md`](./docs/protocol.md).

The consolidated discussion backlog is [`BACKLOG.md`](./BACKLOG.md). It records the
decisions, implementation status, dependencies, open engineering questions, and
explicit non-goals behind the MVP → 0.1 plan.

## Repository tickets

- [PI Coffee consolidated backlog](./BACKLOG.md) · [Gitea backlog Issue #13](http://testpc:3000/awangs/pi-coffee/issues/13) · [Project 1 看板](http://192.168.100.232:3000/awangs/pi-coffee/projects/1)
- [PI Coffee map and MVP outcome](http://testpc:3000/awangs/pi-coffee/issues/1)
- [Host/Web Server protocol and continuity](http://testpc:3000/awangs/pi-coffee/issues/2)
- [Original Pi Host adapter](http://testpc:3000/awangs/pi-coffee/issues/3)
- [Web Server and browser shell](http://testpc:3000/awangs/pi-coffee/issues/4)
- [End-to-end verification and runbook](http://testpc:3000/awangs/pi-coffee/issues/5)
- [MVP → 0.1 handoff](http://testpc:3000/awangs/pi-coffee/issues/6)
- [Harness Lean/Full prompt（V3-derived, Pi-native）](http://testpc:3000/awangs/pi-coffee/issues/14)
- [Harness Pi plugin：V5 Simple/Full tools + prompt](http://testpc:3000/awangs/pi-coffee/issues/15)
- [Harness future plan：可靠性验证与扩展工具](http://testpc:3000/awangs/pi-coffee/issues/16)
- [pi-subagents 集成与 User VM 可靠性验收](http://testpc:3000/awangs/pi-coffee/issues/17)
- [pi-subagents integration spec](./docs/spec/subagents-plugin.md)
- [0.1 implementation tickets](http://testpc:3000/awangs/pi-coffee/issues)
