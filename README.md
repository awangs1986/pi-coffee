# PI Coffee

> **Pi Agent 设计与维护入口**：[主 SPEC](./docs/spec/pi-agent.md) 是插件扩展、Chat/Work、工具克制、上下文与调用可靠性的持续维护依据；[Work 提示词 SPEC](./docs/spec/harness-prompt.md) 定义正文规则和验收。Chat 连 Pi 默认系统提示词也不要。**当前检出版本仍为旧模式接线**，下述 8/10 基础表不是已确认的新 Work 工具清单；模式迁移和 Chat 零系统提示词仍待实现。讨论决定、代码状态和验收证据分别记录，不以旧实现反推新设计。


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
- PI Coffee does not include V5 Guard, permission approvals, managed snapshots, or Devloop enforcement. The current compatibility Harness exposes the legacy 8/10 base tool tables with the Work development prompt; its `git` adapter is limited to native status/diff and basic native worktree operations. The locked `pi-subagents@0.63.0` extension is loaded in the Agent Host as an optional delegation capability; its tools do not change the Harness 8/10 base counts. The native Web adapter uses the Control Plane Serper Relay and seals concluded research into User VM Markdown artifacts; official `pi-web-access@0.27.0` remains available for optional content/source tools. The local adapter for pinned `context-fold@0.4.0` provides model-free compaction and a local emergency recovery path; see the context-recovery specification for its failure behavior. Gitea integration, PI Coffee Task/Session orchestration, uploads, and image handling remain separate tickets.

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

`npm start` runs Host + Web (and the Relay, if `PI_COFFEE_UPSTREAM_KEY` or
`PI_COFFEE_SERPER_KEY` is set) in one Node process for a local smoke run:

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
| `PI_COFFEE_SESSION_DIR` | Pi default | host | native Pi session directory — the durable conversation store the sidebar and history are served from |
| `PI_COFFEE_IDLE_TIMEOUT_MS` | `600000` | host | stop a Pi process with no browser attached and nothing running; conversations resume from the store |
| `PI_COFFEE_TRANSFER_BIND` / `PI_COFFEE_TRANSFER_PORT` | `0.0.0.0` / `53317` | host | LocalSend v2 file transfer served on the User VM's LAN interface; `off` disables |
| `PI_COFFEE_TRANSFER_ADVERTISE` | first LAN IPv4 | host | address browsers use to reach the transfer port |
| `PI_COFFEE_MAX_FILE_BYTES` / `PI_COFFEE_MAX_BATCH_BYTES` | 256 MiB / 1 GiB | host | upload limits |
| `PI_COFFEE_WEB_TLS_CERT` / `PI_COFFEE_WEB_TLS_KEY` | unset | web | optional HTTPS (internal CA); pair with the transfer TLS below |
| `PI_COFFEE_TRANSFER_TLS_CERT` / `PI_COFFEE_TRANSFER_TLS_KEY` | unset | host | optional HTTPS for the transfer port; LocalSend fingerprint becomes the cert SHA-256 |
| `PI_COFFEE_PROVIDER` / `PI_COFFEE_MODEL` | Pi default | host | provider/model from `models.json` |
| `PI_COFFEE_RELAY_TOKEN` | unset | host | this VM's Relay token, interpolated by Pi from `models.json` |
| `PI_COFFEE_RELAY_BIND` / `PI_COFFEE_RELAY_PORT` | `127.0.0.1` / `8789` | relay | Relay bind |
| `PI_COFFEE_UPSTREAM_URL` | `https://b.awangsawangs.xyz/v1` | relay | upstream OpenAI-compatible base URL |
| `PI_COFFEE_UPSTREAM_KEY` | unset | relay | the sole upstream key; **only** the Relay has it |
| `PI_COFFEE_SERPER_KEY` | unset | relay | Serper API key; **only** the Relay has it |
| `PI_COFFEE_SERPER_ENDPOINT` | Serper API | relay | optional compatible/test Serper endpoint |
| `PI_COFFEE_RELAY_TOKENS` | unset | relay | comma-separated Host tokens; **required** when not on loopback |
| `PI_COFFEE_SEARCH_URL` / `PI_COFFEE_RELAY_URL` | local Relay route | host | Web search Relay endpoint; Host sends only the Relay token |
| `PI_COFFEE_RESEARCH_DIR` | User VM agent dir | host | Markdown research closure directory |
| `PI_COFFEE_SCHEDULER_DIR` | `/tmp/pi-coffee-subagents-<uid>` | VM | shared native-child admission locks; same value for every Host/CLI on one VM; Linux/Python3 required |
| `PI_COFFEE_WEB_MAX_RESULTS` | `8` | host | upper bound for Web search results returned to the model |
| `PI_COFFEE_EXTENSIONS` | bundled Web + Harness + pi-subagents + pi-web-access + context-fold | host | colon-separated Pi extension paths replacing the defaults; set to `off` to disable all extensions |
| `PI_COFFEE_WEB` | enabled | host | set to `off` to disable the PI Coffee Web adapter |
| `PI_COFFEE_WEB_ACCESS` | enabled | host | set to `off` to disable the official pi-web-access adapter |
| `PI_COFFEE_SUBAGENTS` | enabled | host | set to `off`/`0`/`false`/`no` to disable only the packaged pi-subagents extension |
| `PI_COFFEE_CONTEXT_FOLD` | enabled | host | set to `off`/`0`/`false`/`no` to disable the local context adapter; Web recovery refuses without its loaded-state marker |
| `PI_COFFEE_PI_LENS` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to pi-lens; it is not loaded or made visible by default |
| `PI_COFFEE_RPIV_TODO` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to rpiv-todo; its todo tool, command, and overlay are not loaded by default |
| `PI_COFFEE_PI_MCP_ADAPTER` | disabled | host | set to `on`/`1`/`true`/`yes` to opt in to pi-mcp-adapter; its MCP proxy and runtime are not loaded by default |

context-fold keeps the raw session ledger and folds the per-request copy. Its default
`CONTEXTFOLD_COMPACT=det` mode produces a deterministic index for hard compaction. PI Coffee's
local adapter cancels failed or disabled hard compaction instead of silently falling back to
a model-generated summary. Web recovery also checks that this adapter is loaded. See the
[context recovery contract](./docs/spec/context-recovery.md) for configuration and limitations;
these protections do not constitute precise token accounting or completed real-provider acceptance.

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

The browser shell in `public/` is build-free ES modules. `npm run build` copies
two MIT libraries (`marked`, `dompurify`) from `node_modules` into
`public/vendor-*.js` (git-ignored) and `dist/public/`; nothing else is bundled.

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
- [历史工单：提示词初版](http://testpc:3000/awangs/pi-coffee/issues/14)（当前设计见 Pi Agent 主 SPEC）
- [历史工单：Harness 初版](http://testpc:3000/awangs/pi-coffee/issues/15)
- [Harness future plan：可靠性验证与扩展工具](http://testpc:3000/awangs/pi-coffee/issues/16)
- [pi-subagents 集成与 User VM 可靠性验收](http://testpc:3000/awangs/pi-coffee/issues/17)
- [pi-subagents User VM/Web 可靠性验收](http://testpc:3000/awangs/pi-coffee/issues/18)
- [WEB-001 Relay-backed Web Search + native research closure](http://testpc:3000/awangs/pi-coffee/issues/23)
- [WEB-002 真实 User VM / Control Plane Web Search 验收](http://testpc:3000/awangs/pi-coffee/issues/24)
- [Gitea 全量代码与 PR 审计报告](./docs/reviews/gitea-full-audit-20260903.md)
- [pi-subagents integration spec](./docs/spec/subagents-plugin.md)
- [0.1 implementation tickets](http://testpc:3000/awangs/pi-coffee/issues)

## Chat/Work 与研究能力

产品只有 Chat/Work。Chat 零系统提示词；Work 保留 Pi 原生 Base 并追加通用开发正文。模式运行时迁移尚未完成，工具及研究委派清单见 [Pi Agent 主规格](./docs/spec/pi-agent.md) 与[工具讨论](./docs/spec/work-tools.md)。现有子任务执行器、模型配置和部署要求见[子 Agent 接缝](./docs/spec/subagents-plugin.md)。
