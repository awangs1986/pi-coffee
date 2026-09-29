# Versioning and releases

Current version: **0.1.1**. The Git tag is **v0.1.1**.

Harness and LSP have independent version sequences. Neither version is the Pi
engine version or the Server release version. `package.json` is authoritative;
`package-lock.json` must agree. Runtime queries read that installed manifest.

## Version policy

- PATCH (x.y.Z): compatible fixes, packaging, documentation and version reporting.
- MINOR (x.Y.0): compatible new capabilities.
- MAJOR (X.0.0): incompatible public API, tool schema or persisted-data changes.
- Prereleases use an explicit suffix, for example `0.5.0-rc.1`.
- Never move a published tag or overwrite an existing version's artifact.

## Maintainer procedure

1. Start from current GitHub main in a clean checkout; compare the Gitea mirror.
2. Run `npm version <next-version> --no-git-tag-version --ignore-scripts`.
3. Update CHANGELOG.md and this current-version record. Describe any migration.
4. Run `npm ci`, `npm run check` and verify the installed package's version query.
5. Commit, create an annotated `v<version>` tag, then push GitHub main and the tag.
6. Fast-forward the same-named Gitea main and copy the identical tag object. Verify
   both remotes. An npm publication is a separate operation, never inferred from
   a Git tag. Include CHANGELOG.md in npm-format artifacts.
7. Record the plugin version, source commit and tested Pi version when deploying.
   Update only when affected sessions and background tasks are idle. Retain the
   previous release for rollback and ensure exactly one plugin copy is loaded.

## Reproducible installation

These releases are available as Git source tags. At the time this procedure was
introduced, this package was not published on the public npm registry.
Build a pinned tag before installing its directory; this also handles LSP's
TypeScript build requirement:

```sh
git clone --branch v0.1.1 --depth 1 https://github.com/awangs1986/pi-coffee-harness.git pi-coffee-harness-0.1.1
cd pi-coffee-harness-0.1.1
npm ci
npm run check
pi install "$PWD"
```

Check the active version with `/harness version` in Pi. To upgrade, repeat the process with the
chosen newer tag and replace the old package entry in Pi's settings. To roll back,
select the retained previous directory. Do not add the new directory alongside
an already loaded copy. A source release does not automatically update a running
Host or certify production acceptance.
