# Changelog

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
