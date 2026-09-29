# PI Coffee plugins

**Start with [REPOSITORIES.md](REPOSITORIES.md)** to find the right repository,
plugin and public entry. GitHub [awangs1986/pi-coffee](https://github.com/awangs1986/pi-coffee)
and [Gitea awangs/pi-coffee](http://gitea:3000/awangs/pi-coffee) share one source tree.
[pi-coffee-server](https://github.com/awangs1986/pi-coffee-server) owns Web and Host.

| Plugin | Source | Current packaging migration |
| --- | --- | --- |
| Harness | [packages/harness](packages/harness/README.md) | 0.1.3 |
| LSP | [packages/lsp](packages/lsp/README.md) | 0.4.2 |
| Context Handoff | [packages/context-handoff](packages/context-handoff/README.md) | 0.2.0-experimental.2 |

Versions are independent. Each plugin has its own manifest, lockfile, changelog,
tests and release artifact. [Install/release/rollback guide](docs/releases/README.md).
The repository root is an orchestration project, not an installable Pi extension.

## Develop

Use Node >=22.19.0 and Git:

```sh
npm ci
npm run bootstrap
npm run check
npm run pack:plugins
```

Or enter one package and run `npm ci && npm run check`. The root check also installs
all three built tarballs together outside the source tree and queries their native
versions. Artifacts and checksums land in ignored `artifacts/`.

[Documentation index](docs/index.md), [decision](docs/adr/0022-versioned-plugin-monorepo.md),
and [backlog](BACKLOG.md). The prior aggregate is preserved under
`compatibility/aggregate` with its own unchanged runtime and tests. New development
uses `packages/`; upgrading production and running live-model evaluations are separate.
