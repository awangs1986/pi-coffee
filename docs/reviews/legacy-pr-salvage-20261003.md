# Historical Gitea PR recovery

Tracking: [Pi #7](https://github.com/awangs1986/pi-coffee/issues/7).
Baseline: GitHub/Gitea main `5d39297ec20231c3173b2f002a6281bfe6edca46`.

- PR #37 (`83f7e3d`) and #38 (`b145578`) already belong to main ancestry; no code recovery is needed.
- PR #65 (`5653e57`) implements a custom search assessor/evidence store. The maintained integration explicitly uses official pi-web-access with native bounded outputs, so the old experiment is not restored.
- PR #68 (`03ba7ea`, stacked on #65) contains LSP lifecycle/framing/readiness/snapshot work already present in the newer independently versioned LSP package. Its handoff core is present; its automatic rollover and admission overrides conflict with current native ownership.
- One active gap from #68 is retained: Harness still advertised retired Git actions and executed `git worktree add`, whereas Host tasks use independent clones. Harness 0.3.0 narrows the model-facing tool to read-only status/diff. Authorized mutations and publication use native Bash; no runtime permission or filesystem migration changes.

This is a selective reimplementation in `packages/harness`, not a merge of the
old aggregate. Only Harness changes version. LSP, Handoff, official web/subagents,
Chat behavior and Server pins remain unchanged. Version 0.3.0 is a candidate;
its namespaced tag/artifact is not published by this source PR.

The removed schema/action test failed on 0.2.2 before the fix. Status/diff still
execute through the native runner; retired direct calls return an error without
running Git. The packed-package Pi RPC test checks the actual outgoing Git schema
and native status result. `npm run check` passed 50 Harness tests, four package/RPC
tests, 81 LSP tests plus its package check, 89 Handoff tests, and three monorepo
installation checks (including Pi 0.99.1 and 1.0.0). Loopback scripted providers
verify integration, not model autonomy. No paid provider or production task ran.

See the [Server review](https://github.com/awangs1986/pi-coffee-server/blob/fix/recover-frontend-continuity/docs/reviews/legacy-pr-salvage-20261003.md)
for the matching current-controller recovery from Gitea Server #5. Old PRs remain
unchanged; new source PRs require independent review before merge or deployment.
