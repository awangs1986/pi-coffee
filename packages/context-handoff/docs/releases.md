# Context-handoff releases

Current version: **0.2.0-experimental.1**. Git tag: **v0.2.0-experimental.1**.
Package version is independent of Harness, LSP, Server and the native Pi version.
`package.json` is authoritative; keep package-lock.json consistent. Query `/handoff version`.

PATCH records compatible fixes, MINOR new behavior, and MAJOR incompatible public
contracts after stabilization. Pre-1.0 changes must document migration. Experimental
versions retain the `-experimental.N` suffix. Tags and published artifacts are immutable.

Before publishing: run npm ci and npm run check in a fresh clone, test the packed
plugin, update CHANGELOG.md and tag the tested commit. Push GitHub main/tag before
synchronizing the same Gitea main/tag. npm publication and Host deployment are
separate. No transcript, credential or generated evidence body belongs in a release.

Server pins the exact source commit and imports context-handoff/protocol. The
public HANDOFF_REQUEST marker uses Pi RPC compact(customInstructions). Check for
the handoff command before invoking it and verify the resulting compaction belongs
to this plugin; never silently fall back to native compaction under a Handoff label.
The runtime may take longer than Pi RpcClient's default response timeout; consumers
must retain operation ownership until native compaction finishes or is cancelled.

Keep exactly one installed plugin copy. Replace the old local context-fold adapter
when enabling this integration. Harness, native Codex/Claude and LSP remain separate.
Before upgrade or rollback, settle active tasks and keep the prior plugin and Server
release plus task data. Reopen the same Conversation; do not delete native history.
Version 0.1.0 defaults to automatic cadence, so rolling back to it also requires an
explicit policy decision; disabling Handoff and using native Pi is the safe fallback.

Historical live evaluations were inconclusive about semantic improvement. This
release remains experimental and does not certify zero drift or live-provider quality.

Unknown or asynchronous third-party tools remain fail-closed until their extension
reports `pi-handoff:work` settlement. Git and tool discovery are recognized as
synchronous Coffee tools; no blanket exemption applies to web or subagents.
