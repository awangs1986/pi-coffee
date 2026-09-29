# Repository and plugin map

Start here before choosing a directory or changing a dependency. GitHub main is
source authority; Gitea mirrors identical commits and layout. Each plugin's
`package.json` is its version authority; release tags/artifacts are immutable.

| Work | Canonical source | Gitea mirror | Read first |
| --- | --- | --- | --- |
| Browser, gateway, Host, Relay, Pi/Codex/Claude adapters | [pi-coffee-server](https://github.com/awangs1986/pi-coffee-server) | [awangs/pi-coffee-server](http://gitea:3000/awangs/pi-coffee-server) | Root AGENTS.md, REPOSITORIES.md, docs/index.md |
| Pi plugins and their releases | [pi-coffee](https://github.com/awangs1986/pi-coffee) | [awangs/pi-coffee](http://gitea:3000/awangs/pi-coffee) | This map, docs/index.md, selected package README |

| Change | Directory | Package / version query |
| --- | --- | --- |
| Chat/Work policy, development prompt, Git, tool discovery | [packages/harness](packages/harness/README.md) | `pi-coffee-harness`; `/harness version` |
| Language servers, diagnostics, LSP CLI/Skill | [packages/lsp](packages/lsp/README.md) | `pi-coffee-lsp`; `/lsp version`, `coffee-lsp --version` |
| Experimental handoff, evidence recovery, manual/native compression boundary | [packages/context-handoff](packages/context-handoff/README.md) | `context-handoff`; `/handoff version` |
| Cross-plugin installation and packaging | [integrations](integrations/installed-packages.test.mjs), [scripts](scripts/pack-plugins.mjs) | [Release guide](docs/releases/README.md) |

Official `pi-web-access` and `pi-subagents` remain external upstream packages.
They are not new Coffee forks. Each consumer's lockfile controls its actual version.
Pi plugins do not modify native Codex/Claude behavior.

## Historical sources

`pi-coffee-harness`, `pi-coffee-lsp` and `pi-context-handoff` (Gitea name
`Context-handoff`) were standalone repositories. Their Git ancestry is merged into
this repository; original releases stay available for rollback. New source work
belongs only to the directories above.

[compatibility/aggregate](compatibility/aggregate/README.md) preserves the previous
Pi distribution and its docs/tests from `a1c4e4acc88ffd774a09598f1cbd67337ab9522e`.
It is not a second copy to update alongside the canonical plugins. Its old nested
Harness package and context-fold hooks describe historical distribution behavior.
An existing Server may continue pinning an earlier aggregate commit for unaffected
legacy integrations; record that explicitly rather than implying every component
uses the latest source. Follow Server package.json/package-lock.json for consumed
versions and its deployment evidence for the running version.
