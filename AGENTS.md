# PI Coffee plugin source authority

Start with [REPOSITORIES.md](REPOSITORIES.md) to choose the repository and plugin, then [docs/index.md](docs/index.md) and the linked Issue. GitHub `awangs1986/pi-coffee` owns the three maintained plugins under `packages/`; Gitea `awangs/pi-coffee` mirrors the exact main commit. Web, Host, Relay and native adapters belong to `pi-coffee-server`.

## Changes and checks

- Read the selected plugin's README, package.json, specification and local instructions. Implement in `packages/harness`, `packages/lsp` or `packages/context-handoff`. `compatibility/aggregate` is the preserved legacy distribution, not a second plugin maintenance target.
- Fetch GitHub and Gitea before changes or publication. Compare divergent commits/capabilities and preserve ancestry. Work from current GitHub main in a clean checkout.
- Preserve each plugin's public API, native Pi behavior and independent package version. Read [the consolidation decision](docs/adr/0022-versioned-plugin-monorepo.md) for placement and [release procedures](docs/releases/README.md) for packaging, upgrades or rollback.
- Use red → green at the native Pi RPC, CLI or installed-package seam. Bootstrap with `npm ci && npm run bootstrap`; run `npm run check`. Preserve failure evidence. Native model evaluations are separate from deterministic checks.
- Keep credentials, transcripts, generated runtime evidence and unlicensed source out of commits and Issues. Retain imported licenses and provenance.

## Publication

- Increment only affected plugin versions; record changes in their changelogs. Build separate tarballs and checksums with `npm run pack:plugins`. Root `package.json` is private orchestration, not a Pi plugin.
- Push GitHub main first, then fast-forward Gitea to the same SHA; verify both remotes. Use immutable namespaced tags and release artifacts, never overwrite published versions.
- Record scope, failures, fresh-clone/installed-package checks and source identity in the GitHub Issue. Server upgrades and production deployment have separate acceptance; a plugin release does not deploy them.
