> Canonical source: [pi-coffee/packages/harness](https://github.com/awangs1986/pi-coffee/tree/main/packages/harness). Version `0.1.4`. Start with the [repository map](https://github.com/awangs1986/pi-coffee/blob/main/REPOSITORIES.md) and [release/install guide](https://github.com/awangs1986/pi-coffee/blob/main/docs/releases/README.md). The standalone repository is historical.

# pi-coffee-harness

Version **0.1.4** · [Changelog](CHANGELOG.md) · [Upgrade and rollback](docs/releases.md).
Query the installed version with `/harness version` in Pi.

Standalone native Pi package for Chat/Work, the software-development prompt, Git,
and optional-tool discovery. Tested with Pi 0.99.1 and Node 22.23.2 / 24.19.0.

## Install

Requires Node >=22.19.0 and Pi 0.99.1. From a pinned checkout of
[pi-coffee](https://github.com/awangs1986/pi-coffee), build this package and register
its directory with Pi:

```sh
cd packages/harness
npm ci
npm run check
pi install /absolute/path/to/pi-coffee/packages/harness
```

For installation from the built `harness/v0.1.4` release artifact, follow the
[shared install and release guide](../../docs/releases/README.md). Install the
verified tarball with npm into a permanent plugin directory, then use `pi install`
on that installed package directory. Public npm-registry publication is separate.
Keep exactly one registered copy; remove the previous registration before switching.


## Behavior

- `/work` (default): read, edit, write, bash, git, search_tools, and the development prompt.
- `/chat`: read, edit, write, bash, plus web_search when installed; no system instructions.
- `/harness`: inspect the current mode. Modes restore with the session branch.
- `/capabilities`: inspect settings/readiness or enable, trust and disable capability manifests.

Optional plugins are installed independently. Their absence never blocks the core
modes. Installed Web and LSP tools are discovered through Pi's public registry;
Work activates them through search_tools. Native subagents retain their upstream
loader, while installed Handoff recovery tools remain usable in Work and Chat. Execution,
credentials, output limits, language-server lifecycle and compression policy belong
to those plugins.

The Work addition has a stable software-development body plus guidance for active
`subagents_enable`, `recall_folded`, and `lsp` tools. Its rendered size therefore
changes with the active tool set. Harness enforces a 12,711 UTF-8 byte ceiling on
that addition; Pi's base instructions, project context, runtime state, tool schemas,
and conversation history are separate. Chat remains zero-system even when those
tools are installed. Newly activated tool guidance appears on the next model
request, including requests within the same Work turn. Only the Harness-owned
system block is refreshed; other system instructions and user/tool content stay intact.

Chat filters optional model tools and system instructions at the outgoing request
boundary. This is mode selection, not a shell sandbox: Bash and file operations
retain the VM user's rights. Explicit user slash commands are not intercepted.

## Public API

Independent extensions may import `currentHarnessMode` and
`registerCapabilityManifest` from `pi-coffee-harness`, with the exported capability
types. Registration uses Pi's shared event bus across extension instances. No
private plugin imports or Host integration are required.

## Development and provenance

```sh
npm ci
npm run check
npm pack
```

The check includes isolated packed-package installation through Pi, Git execution,
mode switching, session restart, optional-tool discovery and Chat isolation. Local
scripted providers exercise integration; they do not prove model autonomy.
See the [final prompt acceptance report](docs/final-acceptance-20260929.md).

Extracted from [pi-coffee](https://github.com/awangs1986/pi-coffee) at
`a1c4e4acc88ffd774a09598f1cbd67337ab9522e`; see [provenance](provenance.json).
Harness runtime sources were unchanged at extraction; subsequent prompt changes
are recorded in the acceptance report. This Harness package contains no
Host, Web gateway, Codex/Claude adapters, LSP daemon or compression implementation.
This source consolidation does not change production installations.
