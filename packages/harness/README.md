> Canonical source: [pi-coffee/packages/harness](https://github.com/awangs1986/pi-coffee/tree/main/packages/harness). Version `0.2.0-rc.1`. Start with the [repository map](https://github.com/awangs1986/pi-coffee/blob/main/REPOSITORIES.md) and [release/install guide](https://github.com/awangs1986/pi-coffee/blob/main/docs/releases/README.md). The standalone repository is historical.

# pi-coffee-harness

Version **0.2.0-rc.1** · [Changelog](CHANGELOG.md) · [Upgrade and rollback](docs/releases.md).
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

For installation from the built `harness/v0.2.0-rc.1` release artifact, follow the
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
Work activates LSP through search_tools. Original Web 0.34 uses web_enable;
native subagents retain their upstream loader, while installed Handoff recovery tools remain usable in Work and Chat. Execution,
credentials and language-server lifecycle belong to those plugins. Harness bounds
large web/delegation text results and bridges public settlement events; compression
policy remains native Pi plus the separately installed experimental Handoff.

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

## Pi 0.99 integration contract

This candidate supports Pi 0.99.1, upstream pi-web-access 0.34.0 and
pi-subagents 0.73.1. See [the integration spec](../../docs/spec/pi-099-native-integration.md).
The original upstream schemas and executors are unchanged. Work exposes native
loaders; Chat retains its existing search-only web boundary. LSP discovery stays
in search_tools because Pi tool_search operates on deferred/codemode tools and
does not implement Coffee readiness and trust policy. Codemode is not enabled.

Large web/delegation text results are limited to 8,000 characters including a
pointer to original evidence in the durable session's artifacts directory.
Failed or empty results create no additional Coffee research artifact. Native
upstream session/cache records are not erased. Evidence shares the session's
retention lifetime; archiving keeps it. Bounded native responseId retrieval is
preferred when available. These excerpts are not model-generated summaries.

Only synchronous web workflows are supported: workflow=none, includeContent=false,
then explicit content retrieval. The upstream background web workflow has no
verified public settlement API and is rejected before execution. Subagent status
comes from the upstream public event bus; unavailable status prevents cleanup
or Handoff from assuming that children have finished. Old Coffee 3/5 scheduling
limits and private child-launch overrides are retired.

## Host context presets

With `PI_COFFEE_CONTEXT_CONTROL=1`, `/coffee-context-window 272k|maximum`
selects a native model context window while idle. The default is the smaller of
272,000 tokens and the model registry capacity. Maximum restores that capacity.
Pi owns automatic compaction and its reserve; this setting is not a billing cap.
The choice persists in a native custom entry once the session is saved.
Standalone installations without the opt-in retain their native configuration.
