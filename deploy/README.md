# PI Coffee MVP deployment files

> **2026-09-19 目标拓扑变更，尚待实现**：见 [ADR-0010](../docs/adr/0010-unified-web-gateway-private-user-vms.md)。默认只对外提供统一 HTTPS 入口，聊天和文件流由网关转到私网 VM；VM 不再要求浏览器直达。本文中的直连 Transfer 地址、双浏览器侧 TLS 和逐 VM 端口开放说明描述旧实现，不应据此配置新公网部署。当前代码／模板尚未完成文件网关，不能只关闭 VM 文件端口就声称迁移成功。网关与 Host 保持独立生命周期；文件流不在入口落盘。

Two machines, three processes. The step-by-step procedure is in
[`docs/deployment/runbook.md`](../docs/deployment/runbook.md) ("MVP split deployment").

| Machine | Process | Unit | Env file | Holds |
|---|---|---|---|---|
| Server (Control Plane / Web VM, Debian) | Relay | `server/pi-coffee-relay.service` | `server/relay.env.example` → `/etc/pi-coffee/relay.env` | the sole upstream LLM key, Relay tokens |
| Server | Web Server | `server/pi-coffee-web.service` | `server/web.env.example` → `/etc/pi-coffee/web.env` | Host token |
| User VM (Linux Mint Xfce, one per user) | Agent Host + original Pi | `uservm/pi-coffee-host.service` | `uservm/host.env.example` → `/etc/pi-coffee/host.env`; `uservm/models.json.example` → `$PI_COFFEE_AGENT_DIR/models.json` | Host token, this VM's Relay token |

Rules baked into these files:

- The upstream key exists only in `relay.env` on the server. No file on a User VM contains it.
- The Host refuses to start on a non-loopback bind without `PI_COFFEE_HOST_TOKEN`; the Relay refuses without `PI_COFFEE_RELAY_TOKENS`.
- The Host unit runs as the VM owner, not a service account: Pi needs that user's shell and files. The VM is the isolation boundary.
- Nothing here creates, snapshots or restores VMs. That stays an owner operation.
- The User VM Host loads the bundled V5 Harness and locked `pi-subagents`
  extension by default. Set `PI_COFFEE_SUBAGENTS=off` to keep only Harness, or
  use `PI_COFFEE_EXTENSIONS=off` for a transport-only diagnostic.

`podman/Containerfile` plus `scripts/smoke-podman.mjs` rehearse this exact
three-process shape as containers on one machine (see the runbook's "Two-machine
smoke with Podman"); it is a pre-flight check, not a deployment target.

These are the MVP hand-installed units. The idempotent Deployment Skill with enrollment (`DEP-001`, #9) replaces the manual copy steps in 0.1.
