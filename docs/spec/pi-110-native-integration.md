# Native Pi 1.1 integration candidate

Tracking: [Pi #11](https://github.com/awangs1986/pi-coffee/issues/11), [Server #67](https://github.com/awangs1986/pi-coffee-server/issues/67). Replaces the unmerged 1.0.4 candidate; retain its Git ancestry and original failure evidence.

| Component | Reviewed selection |
| --- | --- |
| Official coding-agent / agent-core / ai / tui | 1.1.0 |
| Official Web / Subagents / optional Antigravity | 0.37.0 / 0.76.1 / 0.10.0 |
| Harness / LSP / Handoff | 0.3.3 / 0.4.7 / 0.2.0-experimental.6, unpublished candidates |
| Independent MISHU | 0.3.0-manager.3, based on current manager.2 source |
| Shared typebox | 1.3.36 |
| TypeScript language server / Pyright | 5.3.0 / 1.1.414 |

Harness/Handoff and MISHU peer ranges add the tested 1.1 minor and reject unreviewed 1.2. Retain Pi 0.99.1/1.0.0/1.0.2/1.0.4 installed-package coverage with reviewed upstream combinations; add 1.1.0 with current official packages. No forced or legacy-peer installation. Candidate versions were never released; do not overwrite any published version/tag. LSP retains its existing broad peer contract and must pass the actual native/CLI checks.

Pi 1.1 adds additive/subtractive tool selectors, tool duration/render metadata, OSC program status and cancelled settlement (`agent_settled.aborted`). New native classifiers and model-catalog updates do not change approved defaults. Keep Chat/Work, registered opted-in Chat tools, native activation, public schemas and four-tool Chat isolation. MCP/codemode remain selected by existing policy; no new tools are enabled.

The stricter 3.5-character native context estimate is Pi-owned. Keep 272K/500K capacity-clamped presets, native automatic compaction, manual experimental same-session Handoff, bounded original evidence and no new drift claims. Verify threshold/overflow behavior and original-evidence integrity on the new core. TLS 6.0.1 still needs Node >=22.22.2, outside the preserved >=22.19 floor. No fresh cross-platform/external-language acceptance is implied.

Server must preserve the native cancellation flag without treating cancellation as process death. A cancelled run releases busy state, cannot create an unread completion marker or completed MISHU notice, cannot acknowledge the secretary digest, and its command receipt is uncertain. Preserve ordinary success and older events lacking the optional flag. Retain the latest MISHU manager/tracking implementation and all current Server adapters. Azure provider migration from the prior candidate remains backed up and conflict checked; the API identifier stays unchanged.

Run native CLI/RPC/installed-package red-to-green checks, `npm ci && npm run bootstrap`, `npm run check`, and independent reproducible tarballs. Verify actual matching children and cancelled native parent settlement. Server additionally uses its source-bound review, canonical lint/build/tests/browser plan, formal version increment and independent published-clone check. Deliver PRs and immutable candidate hashes; owner merge/package publication and production activation remain separate.
