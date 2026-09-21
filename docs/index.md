# PI Coffee Server documentation

- [VM 完整权限与 Gitea 工作区决策](./adr/0012-owner-privileges-and-gitea-checkouts.md)
- [T0–T4 联合交付](./development/t0-t4-gitea-workspaces.md)：设计已确认，Server 承担 T3 并参与 T4。

- [`host-interface.md`](./host-interface.md): external seam with the Agent Runtime and compatibility rules.
- [`architecture/topology.md`](./architecture/topology.md): deployment topology and data ownership.
- [`spec/multi-user-vm.md`](./spec/multi-user-vm.md): confirmed workbench product behavior.
- [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): browser experience and delivery status.
- [`deployment/runbook.md`](./deployment/runbook.md): Server installation, configuration and probes.
- [`adr/0010-unified-web-gateway-private-user-vms.md`](./adr/0010-unified-web-gateway-private-user-vms.md): accepted unified gateway decision.

Agent prompts, Chat/Work modes, tools, Skills, LSP, subagents and User VM Host
implementation are maintained in [`awangs/pi-coffee`](http://gitea:3000/awangs/pi-coffee).
