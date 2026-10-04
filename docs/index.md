# PI Coffee documentation index

**Choose the source first: [repository/package map](../REPOSITORIES.md).**

- Source placement and migration: [ADR-0022](adr/0022-versioned-plugin-monorepo.md), [backlog](../BACKLOG.md).
- Installation, versions, package artifacts and rollback: [release guide](releases/README.md).
- Harness: [README](../packages/harness/README.md), [version policy](../packages/harness/docs/releases.md), [changelog](../packages/harness/CHANGELOG.md).
- LSP: [README](../packages/lsp/README.md), [version policy](../packages/lsp/docs/releases.md), [changelog](../packages/lsp/CHANGELOG.md).
- Handoff: [README](../packages/context-handoff/README.md), [SPEC](../packages/context-handoff/SPEC.md), [design](../packages/context-handoff/docs/plugin-design.md), [changelog](../packages/context-handoff/CHANGELOG.md).
- Historical aggregate specs/acceptance: [archived index](../compatibility/aggregate/docs/index.md). These describe the compatibility distribution, not current independent plugin policy.
- Web/Host implementation, consumed pins and deployed release: [Server index](https://github.com/awangs1986/pi-coffee-server/blob/main/docs/index.md).

Current consolidation tracking: [GitHub Pi #1](https://github.com/awangs1986/pi-coffee/issues/1).

Current runtime upgrade tracking: [Pi #3](https://github.com/awangs1986/pi-coffee/issues/3), validating Pi 0.99.1.

- [Pi 0.99 native integration](spec/pi-099-native-integration.md): candidate package and lifecycle contract.

- [Pi #5](https://github.com/awangs1986/pi-coffee/issues/5): Harness 0.2.1 fixed 500K Host context preset.

- [Pi #6](https://github.com/awangs1986/pi-coffee/issues/6): [Pi 1.0 integration and upgrade contract](spec/pi-100-native-integration.md).

- [Pi #9](https://github.com/awangs1986/pi-coffee/issues/9): [Pi 1.0.2 and official plugin upgrade contract](spec/pi-102-native-integration.md).

- [Historical PR salvage](reviews/legacy-pr-salvage-20261003.md): ancestry/coverage decisions and Harness 0.3.0 candidate; [Pi #7](https://github.com/awangs1986/pi-coffee/issues/7).
