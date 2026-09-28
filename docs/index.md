# PI Coffee documentation

[ADR-0021](adr/0021-pi-only-source-authority.md) defines source placement. GitHub `awangs1986/pi-coffee` is the Pi-only authority; Gitea mirrors its main. Host/Web/Relay and native Agent adapters belong to [pi-coffee-server](https://github.com/awangs1986/pi-coffee-server).

- [Package integration](development/package-integration.md): public exports, installation and consumer lifecycle.
- [Pi specification](spec/pi-agent.md): current contracts and historical acceptance limits.
- [Work prompt](spec/harness-prompt.md), [tool selection](spec/work-tools.md), [Harness extension](spec/harness-plugin.md).
- [LSP CLI and Skill](spec/lsp-middle-layer.md), [OMP port acceptance method](testing/omp-lsp-acceptance.md).
- [Native subagent migration acceptance](reviews/native-subagents-20260928.md).
- [Subagents](spec/subagents-plugin.md), [search](spec/web-search-plugin.md), [context recovery](spec/context-recovery.md).
- [Manual prompt checks](testing/work-prompt-manual.md).
- [Backlog](../BACKLOG.md): branch-specific work and open scope.

Extraction acceptance is recorded in [Pi #70](http://gitea:3000/awangs/pi-coffee/issues/70), paired with [Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19). Referenced historical reports remain at their pinned Server revision; they do not certify this package or a new deployment.
