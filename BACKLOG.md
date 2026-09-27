# PI Coffee backlog

## Repository extraction

[Pi #70](http://gitea:3000/awangs/pi-coffee/issues/70) owns the Pi-only repository and package extraction. [Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19) owns the pinned consumer integration. Source baseline is unified Server `112ef53a0e2b04bd9d7cf283faa04754bc84c9ab`; the original Gitea Pi main `953bba4` is an ancestor and remains reachable.

## Current implementation

Pi 0.87.1, Chat/Work, capability discovery, Git/search extensions, subagents, context recovery, LSP CLI and its Skill are extracted with their existing tests. Installed plugin pins remain in `package.json`; repository placement does not change their policy or merge experimental features.

## Official Web migration

[PA-014](docs/spec/web-search-plugin.md) now selects the unmodified official `pi-web-access` extension as Pi's only Web integration, with Serper configured as its default provider. [Pi #71](http://gitea:3000/awangs/pi-coffee/issues/71) removes the Coffee search/seal adapter and automatic Web delegation. The owner accepted native shared cache placement; deployed/live-provider acceptance is tracked separately. Migration acceptance must cover native Chat/Work tool visibility, Serper calls, large-result context limits, and the official cache's ownership across Conversations. [Pi #24](http://gitea:3000/awangs/pi-coffee/issues/24) has older Relay-specific acceptance text and needs its deployment criteria reconciled with PA-014.

## Independent work preserved

- [Pi #67](http://gitea:3000/awangs/pi-coffee/issues/67) and [PR #68](http://gitea:3000/awangs/pi-coffee/pulls/68): unmerged P0–P7 work, required-language LSP and native-first/Handoff experiments. Its tests and decisions are evidence for that branch, not current main. Host changes from that branch must be ported into the Server repository when separately accepted.
- [PR #65](http://gitea:3000/awangs/pi-coffee/pulls/65): separate search-evidence changes, preserved in history and branch references.
- Context-fold and Coffee context-management development continue in their dedicated task. This extraction does not authorize a policy switch or another model evaluation.

Historical planning remains available in the parent commits. Host/Web/task-workspace and native Codex/Claude work is tracked in Server Issues.
