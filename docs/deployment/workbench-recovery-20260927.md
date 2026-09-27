# Deployment source correction — 2026-09-27

GitHub main `6e0d7fe` included arena `d1f1501` and the native Codex/transfer fixes.
However, it belongs to the older monolithic product lineage. Deploying it over
the separate Gitea Server removed the existing Pi/Codex/Claude selector, modern
Context Usage, right review/Diff pane, Pi Coffee brand menu and task footer.
The earlier Luna reply proved one transport path, not preservation of the UI.

The operational recovery restores the complete Server and a compatible local
Host. It does not merge the two product histories or discard this GitHub work.
The production source repositories for the recovered workbench are:

- [Agent main](http://gitea:3000/awangs/pi-coffee/src/branch/main), including
  `953bba4`, which adds verified Codex 0.156.1 discovery.
- [Server main](http://gitea:3000/awangs/pi-coffee-server/src/branch/main), including
  `3e7376d`, which adds a release identity gate and recovery evidence.
- [Detailed acceptance and topology](http://gitea:3000/awangs/pi-coffee-server/src/branch/main/docs/reviews/workbench-recovery-20260927.md).

The public LAN entry remains `http://webserver:3000/`. Gitea owner `awangs` uses
the complete local Host at `192.168.100.123:8790`; native Codex retains the existing
local login and the selected `gpt-6-luna` configuration. Native credentials are
not copied to Web. The previous monolith release, data and Host remain intact.
The old linux001/linux002 routes were unreachable during recovery; no old VM
data was migrated or deleted.

Browser checks exercised the actual five missing control groups, including a
real temporary-file Diff, native empty Codex task creation and sidebar collapse.
The temporary file was removed. No additional model prompt was submitted.
Fresh-checkout checks passed: Agent 203 tests, Server 56 tests.

Before the next release, reconcile the source ownership explicitly and port
compatible arena improvements into the split repositories. Until then, a latest
GitHub main checkout is not a complete production workbench release. Preserve
both histories; do not resolve this divergence with a force-push, a blind file
copy, or another deployment of the incomplete monolith.
