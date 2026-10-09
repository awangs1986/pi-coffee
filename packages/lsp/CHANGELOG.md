# Changelog

## 0.4.7 — candidate 2026-10-09

- Validate native Pi 1.1.0 and shared typebox 1.3.36 through the semantic CLI, native automatic diagnostics, installed tarball and lifecycle checks.
- Retain Pyright 1.1.414 and TypeScript language server 5.3.0, the newest official releases compatible with Node >=22.19. TypeScript language server 6.0.1 requires Node >=22.22.2. No Lens installation or semantic API change.

## 0.4.6 — 2026-10-04

- Validate Pi 1.0.2; upgrade bundled TypeScript language server to 5.3.0 and Pyright to 1.1.414. Preserve Node >=22.19 and existing semantic/CLI/lifecycle contracts. TLS 6.0.1 needs Node >=22.22.2 and is outside the current minimum.

## 0.4.5 — 2026-10-02

- Validate the independent CLI/Skill, native extension and lifecycle contracts against Pi 1.0.0; retain installed-package coverage on 0.99.1.
- Update the development runtime/typebox pins without changing semantic tools or bundled language-server versions. Preserve Node >=22.19 support.

## 0.4.4 — 2026-09-29

- Report native tool, automatic diagnostics and background warm-up settlement through the optional Handoff event contract. Completed LSP calls no longer block manual Handoff; outstanding queries still defer it. No Handoff dependency or native compaction change.
- Reconcile inactive LSP read-only query records on resume and branch navigation; do not replay operations or mark other plugins' work settled.
- Reproduced and verified through Server Web/Host → real Pi LSP → manual Handoff integration (Server #4, Pi #3).

## 0.4.3 — 2026-09-29

- Validate native Pi 0.99.1 with the complete plugin and installed-package checks.
- Update the pinned development runtime and supported installation guidance.

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
