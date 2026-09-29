# Changelog

## 0.4.2 — 2026-09-29

- Move canonical source to `awangs1986/pi-coffee/packages/lsp` and the identical Gitea mirror. Preserve independent package identity, runtime behavior and prior history.
- Install built release artifacts from the monorepo; this version changes packaging and source location only.

## 0.4.1 — 2026-09-29

- Establish an immutable `v0.4.1` release tag and the release procedure.
- Add installed-version reporting through `/lsp version` in Pi, or `coffee-lsp --version` in a terminal.
- Read the runtime version from package.json so source and installed packages agree.
- Preserve the existing 0.4.0 runtime behavior apart from version reporting.

## 0.4.0 — existing baseline

The previous package version predates the tagged-release procedure. See the
repository's existing acceptance and extraction documents for its scope and limits.
