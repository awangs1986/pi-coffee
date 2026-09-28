# Standalone LSP extraction

Owner requested repository: https://github.com/awangs1986/pi-coffee-lsp.
Source: `awangs1986/pi-coffee` main
`98b5a8e1c06b92051a2dccd25d2f79de07b84b42`, which merged Gitea PR #72.
Extraction date: 2026-09-28.

`src/lsp`, `src/pi-skills.ts`, `skills/lsp`, LSP tests and fixtures, the language
probes, and `third_party/oh-my-pi` are copied unchanged from that revision.
Only the package manifest, build asset copying, public export module, package
consumer tests and repository documentation are specific to this extraction.
The preserved OMP comparison pin is
`b1a8b875cf81ec2fdc3cc397a2d4b6a9a777543d`.

This repository now provides the standalone LSP source and Git-installable
package requested by the owner. Existing pi-coffee and Server dependencies are
not migrated by this upload. Their source-ownership documents and integration
changes must be handled when those consumers adopt this package.

## Source review evidence

- [Final review](https://github.com/awangs1986/pi-coffee/blob/98b5a8e1c06b92051a2dccd25d2f79de07b84b42/docs/reviews/lsp-final-code-review-20260927.md)
- [OMP port acceptance](https://github.com/awangs1986/pi-coffee/blob/98b5a8e1c06b92051a2dccd25d2f79de07b84b42/docs/reviews/omp-lsp-port-20260927.md)
- [LSP contract](https://github.com/awangs1986/pi-coffee/blob/98b5a8e1c06b92051a2dccd25d2f79de07b84b42/docs/spec/lsp-middle-layer.md)

These are evidence for their stated source revisions, not a claim that the new
repository has rerun every historical model or platform experiment. The original
strict autonomous-model score is 0/9; the later successful directed replay does
not close autonomous acceptance. Native toolchains remain external prerequisites,
versionless diagnostic pushes use a settle heuristic, and Windows lifecycle
behavior is not certified.

## Standalone verification

On 2026-09-28, `npm run check` passed 59 LSP tests and one installed-tarball
consumer test. The consumer installs only this package and its project compiler,
resolves the public Skill/PATH helpers, runs status and symbols, observes real
TypeScript findings, saves a repair, confirms clean diagnostics, then verifies a
second clean-to-clean save and stops its owned daemon. The tarball gate rejects
Harness, Web, Host, subagent and context implementation files.

All 21 selected core, Skill, fixture, regression and attribution files were
compared byte-for-byte with the source revision above and matched. The build
contains only the two language-server frontend runtime dependencies. Native
language servers and compilers are not silently bundled.

The first lockfile-free dependency resolution hit an npm 10.9.8 Arborist error.
Reusing the reviewed source lockfile and letting npm prune unrelated packages
produced the committed standalone lockfile and a successful installation.
Use `npm ci` to reproduce its pinned dependency graph.

## Post-extraction changes

The extraction above describes the 0.1.0 state. Later versions diverge from the
pi-coffee source on purpose:

- 0.2.0 adds the Pi extension layer (`src/extension`) — `lsp` tool, automatic
  diagnostics after `edit`/`write`, `/lsp` command, per-process daemon
  lifecycle — and the standard Pi package manifest.
- 0.3.0 replaces the six hard-coded profiles with a language-server registry
  (`src/lsp/registry.ts`, adapted from oh-my-pi `lsp/defaults.json` at upstream
  `5a6e431aa0ca0b49f28eeb7c1f8558b86c06d25a`; provenance in
  `third_party/oh-my-pi/README.md`). `src/lsp/profiles.ts` selects servers over
  that registry, `coffee-lsp.json` gains a `servers` section, and the CLI gains
  `servers` / `install`. `src/lsp/client.ts` changed only in taking the LSP
  language id from the registry. The kernel's diagnostics semantics, daemon and
  transport are unchanged; `npm run check` covers 75 tests plus the installed
  package consumer test.
