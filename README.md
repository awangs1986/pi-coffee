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
- PI Coffee does not include V5 Guard, permission approvals, managed snapshots, or Devloop enforcement. The native Harness extension exposes the frozen V5 8/10 tool tables; its `git` adapter is limited to native status/diff and basic native worktree operations. The locked `pi-subagents@0.63.0` extension is loaded in the Agent Host as an optional delegation capability; its tools do not change the Harness 8/10 base counts. The pinned `context-fold@0.4.0` extension is loaded last so its deterministic compaction replaces Pi's model-based compaction by default. context-fold is fail-open: if its compaction hook cannot produce a result, it returns no override and Pi's native compaction runs. Gitea integration, PI Coffee Task/Session orchestration, uploads, and image handling remain separate tickets.

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
| `PI_COFFEE_EXTENSIONS` | bundled Harness + pi-subagents + context-fold | host | colon-separated Pi extension paths replacing the defaults; set to `off` to disable all extensions |
| `PI_COFFEE_SUBAGENTS` | enabled | host | set to `off`/`0`/`false`/`no` to disable only the packaged pi-subagents extension |
| `PI_COFFEE_CONTEXT_FOLD` | enabled | host | set to `off`/`0`/`false`/`no` to disable context-fold; Pi's native compaction remains available |
| `PI_COFFEE_PI_LENS` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to pi-lens; it is not loaded or made visible by default |
| `PI_COFFEE_RPIV_TODO` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to rpiv-todo; its todo tool, command, and overlay are not loaded by default |
| `PI_COFFEE_PI_MCP_ADAPTER` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to pi-mcp-adapter; its MCP proxy and runtime are not loaded by default |

context-fold keeps the raw session ledger and only rewrites the per-request copy. Its default
`CONTEXTFOLD_COMPACT=det` mode emits a deterministic summary for hard compaction. The plugin's
own error handling deliberately returns control to Pi when folding or deterministic compaction
fails, making native Pi compaction the fallback rather than a competing default. Advanced
context-fold tuning remains available through its `CONTEXTFOLD_*` variables and `/context-fold` command.

`pi-lens@4.1.3` is packaged for a future opt-in path only. PI Coffee does not proactively load
it, initialize its LSP/diagnostic runtime, or add its tools to the model's visible tool set.
Set `PI_COFFEE_PI_LENS=on` for a Host session when that capability is explicitly requested;
pi-lens then applies its own dynamic-tool policy (situational tools start inactive).

`@juicesharp/rpiv-todo@2.9.0` is packaged for an explicit opt-in path only. PI Coffee does
not proactively initialize its todo tool, `/todos` command, or live overlay. Set
`PI_COFFEE_RPIV_TODO=on` for a Host session when task tracking is explicitly requested.

`pi-mcp-adapter@2.32.1` is packaged for an explicit opt-in path only. PI Coffee does not
proactively initialize its MCP proxy tool, discover MCP servers, or start server runtimes.
Set `PI_COFFEE_PI_MCP_ADAPTER=on` for a Host session when MCP access is explicitly requested.

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
- [pi-subagents User VM/Web 可靠性验收](http://testpc:3000/awangs/pi-coffee/issues/18)
- [pi-subagents integration spec](./docs/spec/subagents-plugin.md)
- [0.1 implementation tickets](http://testpc:3000/awangs/pi-coffee/issues)
