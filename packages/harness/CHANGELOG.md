# Changelog

## 0.3.1 — 2026-10-04

- Validate Pi 1.0.2 and official npm subagents 0.75.0 while preserving native activation, Chat isolation, bounded evidence and read-only Git. Public APIs and context policy are unchanged.

## 0.3.0 — candidate

- Narrow the active Git tool to read-only status/diff and remove retired snapshot/transfer/adoption/worktree actions. Reworked from historical Gitea PR #68 against the current independent plugin.
- Migration: mutations and publishing use explicit Bash workflows; old action calls fail without executing Git. Native transcripts and task clones require no migration.
- Keep Chat, official Web/subagents, LSP and Handoff behavior unchanged. No Server pin or running service is updated.

## 0.2.2 — 2026-10-02

- Validate Pi 1.0.0 and retain installed-package compatibility with 0.99.1.
- Preserve upstream subagent auto/dynamic/eager selection across restoration and model selection; eager-only installations remain callable in Work.
- Include delegation guidance for either native loader or executor. Chat isolation, context presets and bounded evidence remain unchanged.

## 0.2.1 — 2026-10-01

- Cap the Host higher context preset at 500,000 tokens instead of restoring the model maximum. Preserve the 272K default, native model capacity clamp and automatic compaction. Existing maximum selections adopt 500K on restore.

## 0.2.0 — 2026-09-30

- Add opt-in Host context presets: 272k (bounded by model capacity) and native model maximum.
- Persist the preset in native custom session entries and retain Pi native automatic compaction.
- Enable only with PI_COFFEE_CONTEXT_CONTROL=1; standalone Pi behavior is unchanged. No session migration is required.


## 0.2.0-rc.1 — 2026-09-30

- Use native upstream web/subagent loaders and public fleet status.
- Bound large results with durable evidence pointers; reject unobservable background web workflows.
- Preserve numerical context attribution in this maintained package after aggregate removal.
- Update Work guidance; preserve Chat, LSP readiness and manual Handoff boundaries.

## 0.1.4 — 2026-09-29

- Validate native Pi 0.99.1 with the complete plugin and installed-package checks.
- Update the pinned development runtime and supported installation guidance.
- Declare host-provided typebox as a peer to avoid duplicate runtime modules.

## 0.1.3 — 2026-09-29

- Move canonical source to `awangs1986/pi-coffee/packages/harness` and the identical Gitea mirror. Preserve independent package identity, runtime behavior and prior history.
- Install built release artifacts from the monorepo; this version changes packaging and source location only.

## 0.1.2 — 2026-09-29

- Keep independently installed Handoff evidence/reconciliation tools usable in Chat as well as Work. Chat still removes system instructions and unrelated optional tools.
- Verify the packaged plugin through native Pi RPC; no Handoff execution or automatic compression policy moves into Harness.


## 0.1.1 — 2026-09-29

- Establish an immutable `v0.1.1` release tag and the release procedure.
- Add installed-version reporting through `/harness version` in Pi.
- Read the runtime version from package.json so source and installed packages agree.
- Preserve the existing 0.1.0 runtime behavior apart from version reporting.

## 0.1.0 — existing baseline

The previous package version predates the tagged-release procedure. See the
repository's existing acceptance and extraction documents for its scope and limits.
