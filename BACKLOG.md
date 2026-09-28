# PI Coffee backlog

## Repository extraction

[Pi #70](http://gitea:3000/awangs/pi-coffee/issues/70) owns the Pi-only repository and package extraction. [Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19) owns the pinned consumer integration. Source baseline is unified Server `112ef53a0e2b04bd9d7cf283faa04754bc84c9ab`; the original Gitea Pi main `953bba4` is an ancestor and remains reachable.

## Current implementation

Pi 0.87.1, Chat/Work, capability discovery, Git/search extensions, subagents, context recovery, LSP CLI and its Skill are extracted with their existing tests. Installed plugin pins remain in `package.json`; repository placement does not change their policy or merge experimental features.

## Official Web migration

[PA-014](docs/spec/web-search-plugin.md) now selects the unmodified official `pi-web-access` extension as Pi's only Web integration, with Serper configured as its default provider. [Pi #71](http://gitea:3000/awangs/pi-coffee/issues/71) removes the Coffee search/seal adapter and automatic Web delegation. The owner accepted native shared cache placement; deployed/live-provider acceptance is tracked separately. Migration acceptance must cover native Chat/Work tool visibility, Serper calls, large-result context limits, and the official cache's ownership across Conversations. [Pi #24](http://gitea:3000/awangs/pi-coffee/issues/24) has older Relay-specific acceptance text and needs its deployment criteria reconciled with PA-014.

## OMP LSP port

The LSP subset of [Pi #67](http://gitea:3000/awangs/pi-coffee/issues/67), HARNESS-P3/P4,
was ported on `codex/omp-lsp-port` from Pi main `0278a99` and merged into local main. It adds implementation,
six language-family profiles and the OMP lifecycle/diagnostic fixes while preserving
Pi 0.87.1 and the public Skill/CLI interface. See the [acceptance method](docs/testing/omp-lsp-acceptance.md)
and [local evidence](docs/reviews/omp-lsp-port-20260927.md). This does not merge or
certify the remaining P0–P7, context, subagent or Server experiments. Package
publication, Server consumer upgrade and deployment remain separate actions.
The acceptance report records the completed live-model evaluation and its limits.

## Independent work preserved

- [Pi #67](http://gitea:3000/awangs/pi-coffee/issues/67) and [PR #68](http://gitea:3000/awangs/pi-coffee/pulls/68): unmerged P0–P7 work, required-language LSP and native-first/Handoff experiments. Its tests and decisions are evidence for that branch, not current main. Host changes from that branch must be ported into the Server repository when separately accepted.
- [PR #65](http://gitea:3000/awangs/pi-coffee/pulls/65): separate search-evidence changes, preserved in history and branch references.
- Context-fold and Coffee context-management development continue in their dedicated task. This extraction does not authorize a policy switch or another model evaluation.

Historical planning remains available in the parent commits. Host/Web/task-workspace and native Codex/Claude work is tracked in Server Issues.

## Official native subagents (2026-09-28)

[Pi #73](http://gitea:3000/awangs/pi-coffee/issues/73): owner selected unmodified `pi-subagents@0.73.1`, installed by Pi's native package
manager. Coffee executor/resource/model/output adapters and 3/5 launcher are
retired; the exact npm version is a development compatibility fixture only.
[The specification](docs/spec/subagents-plugin.md) records native activation,
output limits, command ownership and concurrency differences. Host lifecycle
replacement and deployment remain a Server integration gate, not completed by
this package change. LSP's independent package work is a separate deliverable.

[Native migration acceptance](docs/reviews/native-subagents-20260928.md): 139 tests plus package validation, fresh clone, native npm installation and packed consumer passed. No production Host deployment.

## Native Harness package (P4)

[Pi #74](http://gitea:3000/awangs/pi-coffee/issues/74) packages `pi-coffee-harness` independently, with public tool/event discovery and optional-plugin degradation. [SPEC](docs/spec/harness-native-package.md) owns acceptance. P5 is limited to the Server Pi adapter and is not included in this task; Host remains a multi-engine service.
