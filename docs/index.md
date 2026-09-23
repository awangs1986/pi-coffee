# PI Coffee Server documentation

- [VM 完整权限与 Gitea 工作区决策](./adr/0012-owner-privileges-and-gitea-checkouts.md)
- [T0–T4 联合交付](./development/t0-t4-gitea-workspaces.md)：T3 UI/代理代码已实现，Server 仍参与 T4 部署与双 VM 验收。

- [任务与 Conversation 目录合同](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/conversation-workspaces.md)：一任务一目录、Work 自动 clone、上下文展示与归档/清理；对应本仓 [#3](http://gitea:3000/awangs/pi-coffee-server/issues/3)，已实现；检查与部署证据见对应工单。

- [`host-interface.md`](./host-interface.md): external seam with the Agent Runtime and compatibility rules.
- [`architecture/topology.md`](./architecture/topology.md): deployment topology and data ownership.
- [`spec/multi-user-vm.md`](./spec/multi-user-vm.md): confirmed workbench product behavior.
- [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): browser experience and delivery status.
- [`deployment/runbook.md`](./deployment/runbook.md): Server installation, configuration and probes.
- [`adr/0010-unified-web-gateway-private-user-vms.md`](./adr/0010-unified-web-gateway-private-user-vms.md): accepted unified gateway decision.

Agent prompts, Chat/Work modes, tools, Skills, LSP, subagents and User VM Host
implementation are maintained in [`awangs/pi-coffee`](http://gitea:3000/awangs/pi-coffee).

## Native engine support — specification, not delivered behavior

- [M0–M5 delivery plan](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/development/native-agents-m0-m5.md): this repository owns M4 ([pi-coffee-server #7](http://gitea:3000/awangs/pi-coffee-server/issues/7)); M1 fixtures unblock Browser development and M2/M3 unblock real-engine acceptance.

- [Browser Shell native-engine SPEC](./spec/native-agent-browser.md): compact engine choice, capabilities, native interaction and compatibility within the existing layout; [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6).
- [Canonical Agent SPEC](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/native-agent-engines.md): native Codex/Claude Code adapters and shared Workspace/Gitea lifecycle; [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48).
- Current Server implementation is Pi-oriented. No native-engine deployment or frontend audit merge is implied by this specification.
