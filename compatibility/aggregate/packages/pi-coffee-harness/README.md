# pi-coffee-harness

A standalone native Pi package for Chat/Work, the development system prompt, Git,
and explicit optional-tool discovery. Tested with Pi 0.87.1 and Node 22.

## Build and install

From the pi-coffee source repository:

```sh
npm ci
npm run check
npm pack ./packages/pi-coffee-harness --pack-destination /tmp
pi install /absolute/path/to/pi-coffee/packages/pi-coffee-harness
```

For a separate machine, extract the generated tarball into a permanent directory,
install its dependencies with `npm install --omit=dev`, and use `pi install` on the
extracted package directory. This package is npm-ready; publication to the public
npm registry is a separate release step, not implied by a source merge.

Do not load this package alongside the old pi-coffee aggregate Harness. Existing
Host integration is unchanged; migrate its Pi adapter separately. Optional packages
are installed independently through Pi and are never imported by private paths.

## Modes

- `/work` (default): read, edit, write, bash, git, search_tools; development prompt.
- `/chat`: read, edit, write, bash, plus web_search when installed; no system prompt.
- `/harness`: show the current mode. Session branches restore their selected mode.
- `/capabilities`: inspect settings/readiness and explicitly enable, trust or disable
  additional capability manifests. Mode changes require an idle turn.

Missing optional packages never block Chat/Work. Missing required built-in tools
or an unknown persisted mode fail closed. Chat filters optional tool schemas from
outgoing requests and rejects their model calls; this is a tool-selection policy,
not a shell sandbox or restriction on explicit user slash commands.

Work discovers installed `web_search` and `lsp` definitions through Pi's public
`getAllTools()`. Search results contain metadata only; `search_tools` activation
uses the registered schema and leaves execution to the owning plugin. LSP language
availability remains the LSP plugin's responsibility. Native subagent activation
stays with `subagents_enable`; it is not wrapped or scheduled by Harness. Installed
Handoff evidence/reconciliation tools remain available in Work; the recovery
plugin owns its cadence and execution.

## Public integration API

Other packages may import `currentHarnessMode` and `registerCapabilityManifest`
from `pi-coffee-harness`, with the exported capability types. The shared Pi event
bus joins independently loaded extension API instances. No private imports are
needed. This package does not load search providers, subagents, language servers,
context compression, Host processes or credentials.

Third-party packages remain responsible for their output limits and lifecycle.
Harness does not promise universal result summarization or secret redaction.
