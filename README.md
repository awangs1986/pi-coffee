# PI Coffee

Pi-only software development harness for the unmodified Pi coding agent. GitHub [awangs1986/pi-coffee](https://github.com/awangs1986/pi-coffee) is authoritative; [Gitea](http://gitea:3000/awangs/pi-coffee) mirrors the same main commit.

This repository owns Chat/Work prompts, capability discovery, Git and search integration, native subagent compatibility, context extensions, the LSP CLI and Skills. Browser, Web gateway, Relay, Host and native Pi/Codex/Claude adapters live in [pi-coffee-server](https://github.com/awangs1986/pi-coffee-server).

## Develop and run

Use Node >=22.19.0; Git is required for repository probes.

```sh
npm ci
npm run check
PATH="$PWD/dist/bin:$PATH" ./node_modules/.bin/pi --extension ./dist/src/pi-extension.js --skill ./dist/skills/lsp
```

Install official subagents separately with `pi install npm:pi-subagents@0.73.1`. Coffee does not load or wrap that package. [Migration details](docs/spec/subagents-plugin.md) include output limits and the pending Host lifecycle integration.

Pi 0.87.1 is pinned. Provider authentication belongs to the user's native Pi configuration. This repository contains no Host service or Web startup command. The native package manifest exposes one extension entry and the LSP Skill; loading both that entry and the individual extension list would load the same extensions twice.

## Embed

Consumers pin a Git commit of this repository as their `pi-coffee` dependency. The Git installation runs `prepare` to build the package. Import the supported integration surface from `pi-coffee`: `resolvePiExtensions`, `resolvePiSkills`, `withCoffeeLspPath`, `stopLspDaemon`, and the context attribution types. Implementation subpaths are private. See [package integration](docs/development/package-integration.md).

## Scope and history

[ADR-0021](docs/adr/0021-pi-only-source-authority.md) supersedes the Pi placement in the former unified repository. Existing main behavior is preserved; unmerged experiments remain on their original branches and Issues. In particular, this extraction does not merge the context-management/Handoff redesign or the unmerged P0–P7 branch. See [documentation](docs/index.md) and [backlog](BACKLOG.md).
