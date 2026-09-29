# Native Harness package (P4)

Accepted scope: [Pi #74](http://gitea:3000/awangs/pi-coffee/issues/74).

`pi-coffee-harness` is an independently installable Pi package built from the
Harness sources in this repository. `packages/pi-coffee-harness/package.json`
owns its version and native Pi manifest. The root `pi-coffee` package remains a
compatibility distribution for existing consumers; no Host deployment is included.
This document supersedes earlier requirements that Chat needs an installed Web
plugin or that Harness owns optional plugin assembly.

## Responsibility

Harness owns Chat/Work selection, branch-persisted mode and activation state, the
Work system prompt, Git, and the metadata/activation catalog. It uses only public
Pi extension APIs and registered tool schemas. Optional extensions own their
execution, credentials, output budgets and resource lifecycle.

The standalone artifact contains no search provider, subagent runtime, LSP daemon,
context compression implementation, Host or Web adapter. It never imports another
plugin's private paths or reads its installation directory. Public exports provide
mode querying and capability registration across Pi's shared event bus.

## Mode contract

Chat exposes read/edit/write/bash and, only when registered, web_search. Missing
Web is a supported four-tool Chat. Chat has no system instructions, including
project/Skill instructions, at the provider boundary. Optional tools cannot leak
into Chat through native loaders; model tool calls outside the Chat list are
blocked. Explicit user commands and Bash retain the established VM authority.

Work exposes read/edit/write/bash/git/search_tools and the development prompt.
Installed native subagent controls retain upstream activation. Installed LSP is
found as `lsp` through Pi's tool registry and activated on demand with search_tools.
Web search and source tools keep their existing separate activation/trust rules.
Installed Handoff evidence/reconciliation tools remain available in Work without
loading or changing the recovery plugin. Harness does not configure compaction.
No fabricated schemas or implicit installation are permitted. Missing optional
plugins produce no discoverable capability and never prevent core mode use.
Missing required built-in tools or unknown stored mode versions remain fail-closed.

Only idle sessions may switch mode. Mode/session/model transitions preserve the
existing activation invalidation and branch restoration rules. The public event
registration seam allows other plugins to advertise capabilities without linking
against Harness internals. Tool registration is not proof that a project's language
server or provider credentials are ready; the owning plugin reports those failures.

## Packaging and verification

The root build compiles the single source implementation, then assembles only the
Harness dependency graph into the standalone package. The package pins typebox;
Pi is an optional peer with an explicit tested compatibility range. Npm publication
is separate from packaging. Native local package installation and extracted-tarball
installation require no Server or aggregate package.

Acceptance covers a standalone packed consumer, public exports, native Pi package
discovery, four-tool Chat without optional plugins, Work prompt and Git behavior,
optional LSP discovery/activation, outgoing Chat schema isolation, session restore,
and existing aggregate compatibility. Local deterministic provider fixtures verify
orchestration, not real-model autonomy or compression fidelity.

## P5 boundary

P5 is a separate Server Pi-adapter integration task. Host remains a multi-engine
service; Codex/Claude and Web are not converted into Pi plugins. Its existing Pi
assembly must be replaced before enabling this package in a production profile.
Never load both this package and the old aggregate Harness in one Pi process.
