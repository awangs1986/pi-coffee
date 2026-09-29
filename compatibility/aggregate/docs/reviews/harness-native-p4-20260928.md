# Native Harness P4 acceptance

Scope: [Pi #74](http://gitea:3000/awangs/pi-coffee/issues/74).
Runtime source: `83612519ea0a110e4ad9920774ee15b12dfabefa`.
Package: `pi-coffee-harness@0.1.0`; tested Pi: `0.87.1`; Node: `22.23.2`.

## Delivered boundary

One maintained Harness implementation produces a standalone native Pi package and
preserves the existing aggregate consumer interface. The standalone tarball ships
only Harness, capability metadata and the Work prompt. Its sole runtime dependency
is TypeBox; Pi is an optional peer. Public exports support mode querying and
capability registration. Optional plugins are discovered through Pi's registered
tools or shared event bus, with no imported private implementation paths.

Chat now works without Web installed, using the four built-in tools. Installed Web
adds web_search. Chat strips system instructions and excludes optional tool schemas
at the outgoing request seam; optional model calls are blocked too. Work can
activate the installed native LSP tool and retains installed native subagent and
Handoff recovery controls. Their execution, limits and lifecycle remain upstream.

## Verification

- Red: missing-Web Chat failed; native LSP was absent from discovery; recovery tools
  were hidden; no standalone package existed. Targeted tests reproduced these
  gaps before implementation and passed afterward.
- `npm run check`: 20 files / 142 runtime tests, plus 3 package tests passed.
- A fresh clone of the runtime source completed `npm ci && npm run check` with
  the same 142 + 3 passing tests, including its isolated native-install consumer.
- The native consumer test packs and extracts the artifact outside the repository,
  installs its dependencies without the aggregate package or Pi peer, resolves the
  public exports, and runs `pi install` into an isolated profile. Pi discovers the
  package with no explicit extension paths. Exactly one Harness command is present.
- Real Pi RPC against a deterministic local provider executes Git on a synthetic
  repository, verifies the Work prompt, switches to four-tool zero-system Chat,
  restarts into Chat, then installs a separate optional-tool fixture. Late optional
  tool activation is filtered from Chat, while installed Web remains available.
  Work discovers/activates LSP and restores it after process restart.
- Provider payload tests cover OpenAI, Anthropic and Google tool/schema boundaries.
  Existing aggregate package, native subagent and context tests remain passing.
- Security review found no actionable issue. Production dependency audit reported
  zero vulnerabilities. No credentials or user transcripts are in the package.

## Failures retained and corrected

The initial native-install test assumed Pi persisted absolute local package paths;
Pi actually saved relative paths. The assertion now resolves paths against the
profile directory. The local provider fixture initially expected only string user
content; it now handles native text blocks as well.

The first repository check found an existing documentation vocabulary violation in
the prior subagent acceptance note. Its wording was corrected without changing the
historical claim. An additional RPC check raced npm's aggregate `prepare` rebuild
and observed missing generated extensions. Package checks now run serially and
runtime checks finish before packaging; no concurrent rebuild is used for final
acceptance.

## Release limits

This is P4 only. No Host/Web/native-engine adapter change, production plugin
activation, model change, npm-registry publication or P5 deployment is included.
Install only one Harness distribution per Pi process. Native test fixtures prove
loading, tool execution and mode/restore boundaries, not model autonomy or semantic
Handoff fidelity. LSP server availability remains its plugin's responsibility.

Standalone artifact SHA-256:
`ce9034e6a14c692f00d4e8b0d3f090f8efa4fbd91b19da56f46b3a9e6192aa7e`.
