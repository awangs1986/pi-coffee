# PI Coffee Server documentation

- [VM 完整权限与 Gitea 工作区决策](./adr/0012-owner-privileges-and-gitea-checkouts.md)
- [T0–T4 联合交付](./development/t0-t4-gitea-workspaces.md)：T3 UI/代理代码已实现，Server 仍参与 T4 部署与双 VM 验收。

- [任务与 Conversation 目录合同](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/conversation-workspaces.md)：一任务一目录、Work 自动 clone、上下文展示与归档/清理；对应本仓 [#3](http://gitea:3000/awangs/pi-coffee-server/issues/3)，仍待实现。

- [`host-interface.md`](./host-interface.md): external seam with the Agent Runtime and compatibility rules.
- [`architecture/topology.md`](./architecture/topology.md): deployment topology and data ownership.
- [`spec/multi-user-vm.md`](./spec/multi-user-vm.md): confirmed workbench product behavior.
- [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): browser experience and delivery status.
- [`deployment/runbook.md`](./deployment/runbook.md): Server installation, configuration and probes.
- [`adr/0010-unified-web-gateway-private-user-vms.md`](./adr/0010-unified-web-gateway-private-user-vms.md): accepted unified gateway decision.

Agent prompts, Chat/Work modes, tools, Skills, LSP, subagents and User VM Host
implementation are maintained in [`awangs/pi-coffee`](http://gitea:3000/awangs/pi-coffee).
