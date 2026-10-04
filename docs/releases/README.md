# Independent plugin releases

Read [the source map](../../REPOSITORIES.md). The root is private orchestration;
install one plugin directory or its built tarball. Each package.json owns its version.

## Install

For a source checkout, choose a tested Git commit, build the selected directory,
and install it with Pi's native manager:

```sh
cd packages/harness
npm ci
npm run build
pi install /absolute/path/to/pi-coffee/packages/harness
```

Use `packages/lsp` or `packages/context-handoff` for the other plugins. For binary
installation download that plugin's `.tgz` and `SHA256SUMS` from its namespaced
GitHub/Gitea release, verify its checksum, install it with npm into a dedicated plugin directory, then
register the installed directory with Pi:

```sh
npm install --prefix /absolute/path/pi-plugins /absolute/path/pi-coffee-harness-0.1.4.tgz
pi install /absolute/path/pi-plugins/node_modules/pi-coffee-harness
```

Use package names `pi-coffee-lsp` and `context-handoff` for the others.
Tarballs include built entries and require no repository siblings or TypeScript build
at installation. Server uses immutable asset URLs with package-lock integrity.

Keep exactly one copy of each plugin. Before replacing an installed package, settle
active work, keep the prior artifact/version and task data, remove the previous
package registration and install the selected replacement. Verify `/harness version`,
`/lsp version` / `coffee-lsp --version`, or `/handoff version` in native Pi. Existing
Server slash-command limitations are separate from native plugin version support.

Official web/subagent plugins remain upstream packages. Never install the historical
aggregate loader alongside all three new package entries: it includes old overlapping
Harness/context behavior. Existing Server adapters explicitly compose selected entries.

## Publish

1. Update only changed package versions/lockfiles and changelogs. Current validated versions
   are Harness 0.3.1, LSP 0.4.6 and Handoff 0.2.0-experimental.5.
2. In a fresh clone run `npm ci`, `npm run bootstrap`, `npm run check`. Each package
   runs its own native/CLI tests; the root also tests all three installed together.
3. Commit, then `npm run pack:plugins`. `artifacts/releases.json` records source SHA,
   package/version/tag, SHA-256 and npm SHA-512 integrity. SHA256SUMS covers tarballs.
4. Push GitHub main, fast-forward Gitea main and verify the same SHA. Tag the tested
   source commit as `<plugin>/v<version>` and mirror that exact tag object.
5. Create releases in both forges and upload the tarball, checksums and releases.json.
   Never move a published tag or overwrite an asset. Download/verify the uploaded
   artifacts. npm registry publication is separate and is not required here.
6. Update consumers only to the selected immutable asset URL, retain lock integrity,
   and run their integration/fresh-clone checks. Deployment is a separate operation.

## Upgrade and rollback

PATCH is compatible behavior/packaging repair, MINOR adds compatible capabilities,
and MAJOR marks incompatible contracts after stabilization. Pre-1.0 changes must
state migration requirements. Handoff retains its experimental prerelease suffix.

Roll back by reinstalling the prior artifact and consumer release while retaining
native session/project data. Older Handoff 0.1.0 uses historical automatic cadence;
disabling Handoff while keeping native Pi is safer than silently restoring that policy.
A passing package check establishes installation/orchestration, not improved model
fidelity, production state or entitlement to rerun live evaluations.
