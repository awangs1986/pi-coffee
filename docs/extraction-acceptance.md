# Standalone repository extraction

Source: `awangs1986/pi-coffee` at `a1c4e4acc88ffd774a09598f1cbd67337ab9522e`.
The Harness and capability runtime sources are byte-identical to the source
revision. Build, package and test paths were adapted to this repository root.
`provenance.json` records the extracted source paths.

## Checks

- `npm run check`: 6 test files / 41 Harness tests and 2 package tests passed.
- The packed-consumer test installs the tarball as an ordinary npm dependency
  outside the checkout, then installs the package through Pi's native manager.
  It verifies public exports, native discovery, Git execution, Chat/Work switching,
  session restart, optional LSP discovery/activation and late-tool Chat isolation.
- Dependencies are locked. `npm install` reported zero vulnerabilities.
- No optional plugin executor, Host, Web, credentials or production configuration
  is copied into this repository. Fixtures use synthetic local provider responses.

These are the standalone Harness tests, not a repeat of the aggregate repository's
142 runtime tests. No model-autonomy or Host deployment result is claimed.

## Packaging failures corrected

An unlocked development installation hit npm 10's peer-resolution exception while
resolving the test stack. The extraction reuses the source's tested dependency
versions and commits a reconciled lockfile. The consumer test initially installed
the extracted archive as a development checkout, incorrectly resolving its test
dependencies; it now installs the tarball as a dependency, matching npm consumers.

## Release boundary

Uploading this repository does not install it in an existing production profile,
change the original pi-coffee source, publish to npm, or perform P5 Host integration.
