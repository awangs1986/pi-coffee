# Claude Code UI native-engine integration reference

Date: 2026-09-23. Status: source research for planned M0–M5 implementation,
not runtime acceptance. Canonical requirements remain the
[native-engine SPEC](../spec/native-agent-engines.md) and
[ADR-0013](../adr/0013-native-agent-engines.md).

## Scope and provenance

The public `siteboon/claudecodeui` checkout was inspected at commit
[`6c51fcaa76c250af70561fad7312c5a7f841a733`](https://github.com/siteboon/claudecodeui/tree/6c51fcaa76c250af70561fad7312c5a7f841a733).
This was the fetched default-branch HEAD during this review. The application
was neither installed nor executed. Findings below describe source behavior;
they do not establish that a particular installed CLI version passes our
acceptance criteria.

The reference package declares Claude Agent SDK `^0.3.165`, Codex SDK
`^0.153.0`, and Codex CLI `0.153.4`. These are upstream declarations, not a
PI Coffee supported-version commitment. The project declares
`AGPL-3.0-or-later`; this research recommends architectural patterns and does
not import source code. See its pinned
[package manifest](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/package.json)
and [license](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/LICENSE).

## Actual upstream transports

| Engine | Main turn execution | Resume and cancellation | Implication for PI Coffee |
|---|---|---|---|
| Codex | `@openai/codex-sdk`, `startThread` or `resumeThread`, then `runStreamed` | Native thread ID; `AbortController` signal | Useful lifecycle precedent; not evidence that the upstream primary turn path uses App Server |
| Claude Code | `@anthropic-ai/claude-agent-sdk` and `query` with streaming input | Native session ID in `resume`; query `interrupt` | Useful event/lifecycle precedent; not our selected unmodified native CLI transport |

Codex evidence: the pinned
[runtime provider](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-runtime.provider.ts#L254-L410)
imports the SDK, resolves the platform session to a native ID, starts or resumes
a thread, and consumes streamed events. Its
[cancellation implementation](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-runtime.provider.ts#L505-L538)
aborts the controller. The
[App Server helper](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-app-server.client.ts#L9-L19)
explicitly describes the SDK as exec-backed. That helper creates a short-lived
`codex app-server`, initializes JSON-RPC and performs `thread/fork` for fork or
message-edit workflows; it is not the ordinary turn engine.

Claude evidence: the pinned
[runtime provider](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js#L224-L312)
configures the SDK with the `claude_code` prompt and tool presets, project/user/local
settings sources, working directory, selected model and native resume ID.
Its [run loop](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js#L1069-L1128)
uses `query` and an asynchronous message stream; its
[interrupt path](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js#L1317-L1359)
interrupts the query and releases held input. SDK presets do not make this
transport or its authentication assumptions interchangeable with the native
CLI route selected by PI Coffee.

## Patterns worth adopting

1. **Separate platform and native IDs.** Both runtime providers resolve an
   application session ID to a provider-native ID and capture the native ID
   when the first native event supplies it. PI Coffee should persist engine,
   native Session binding and workspace association before advertising a
   resumable Task; reconnect must not create a second native conversation.
   Sources: the runtime-provider links above.
2. **Use stable event/item IDs.** The Codex provider preserves item IDs so
   progress updates replace one visible entry instead of appending duplicates.
   PI Coffee needs this for tool output and replayed events, without pretending
   every engine has identical event semantics. Source:
   [Codex event transformation](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-runtime.provider.ts#L78-L100).
3. **Keep process lifetime separate from socket lifetime.** The upstream run
   registry assigns sequence numbers, retains bounded events and supports
   resubscription; a cursor older than the buffer requires history refresh.
   PI Coffee should retain its VM-owned lifetime and recovery contract rather
   than move session ownership into Web. Sources:
   [run registry](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/websocket/services/chat-run-registry.service.ts),
   [subscription handler](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/websocket/services/chat-websocket.service.ts#L489-L567).
4. **A completed answer does not prove the runtime is idle.** Claude's provider
   explicitly keeps input open after a turn result when background work remains,
   tracks task events, releases the hold after settlement, and handles
   interruption separately. Its comments identify EOF-related loss of native
   background work. This is source evidence of a lifecycle risk, not a mandate
   to copy an SDK-specific timer or environment variable. PI Coffee must verify
   the selected native transport and feed foreground/background/unknown state
   into Checkpoint, PR and cleanup guards. Source:
   [Claude result/background handling](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js#L1136-L1225).
5. **Persisted history needs engine-aware boundaries.** The upstream indexers
   scan native transcript directories and map them back to application sessions.
   Claude excludes subagent and tool-result files to avoid overwriting the
   parent session record. PI Coffee should prefer supported native history APIs;
   unavoidable file readers belong behind versioned adapters with fixtures.
   Sources:
   [Claude synchronizer](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-session-synchronizer.provider.ts#L21-L96),
   [Codex synchronizer](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-session-synchronizer.provider.ts#L21-L93).

## Patterns not adopted automatically

- **Credential-file inspection is not required for a Web shell.** Upstream
  reads native credential files and infers authentication from token contents.
  PI Coffee should ask the native executable or supported status interface for
  a sanitized status. Authentication remains inside each user's VM; Web must
  not collect tokens. Sources:
  [Codex auth provider](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-auth.provider.ts#L49-L92),
  [Claude auth provider](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-auth.provider.ts#L83-L155).
- **Do not copy permission translations.** Upstream translates generic modes
  into Codex sandbox/approval options and Claude SDK tool/permission options.
  PI Coffee preserves each native engine's configuration and approval semantics;
  VM owner privileges do not authorize a permission bypass. Sources:
  [Codex mode mapping](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/codex/codex-runtime.provider.ts#L225-L251),
  [Claude option mapping](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js#L224-L312).
- **Do not copy unrestricted environment forwarding.** The Claude SDK provider
  explicitly passes its server process environment into the child. PI Coffee
  must preserve user-native configuration while avoiding accidental inheritance
  of Pi Relay or Pi-only runtime overrides. Source: Claude option mapping above.
- **Do not adopt extra product scope.** Upstream fork/edit support and broad
  discovery of external native sessions do not override our immutable
  Pi/Codex/Claude Code Task selection, independent clones, or explicit
  cross-engine code handoff. These are PI Coffee design decisions, not claims
  about upstream limitations.

## Official transport evidence and remaining uncertainty

The [official OpenAI App Server documentation](https://developers.openai.com/codex/app-server)
was fetched during this review. It documents default local stdio transport as
newline-delimited JSON, an `initialize`/`initialized` handshake,
`thread/start`, `thread/resume`, `thread/read`, `turn/start`, `turn/interrupt`,
streamed notifications and server-initiated approval requests. It also documents
version-specific schema generation and native account status. This supports
PI Coffee's preferred Codex App Server adapter; use local stdio rather than
exposing an additional network listener. Generate and test contracts against
the actually selected CLI version, not whatever the live documentation later
describes. Native APIs exposing token import are not a requirement to use them.

The following official Claude pages could not be freshly retrieved in this
review: [headless usage](https://code.claude.com/docs/en/headless),
[CLI reference](https://code.claude.com/docs/en/cli-reference),
[legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
and [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview).
HTML/Markdown retrieval attempts returned HTTP 403 or timed out. Therefore this
note does **not** certify exact native CLI stream flags, bidirectional approval
messages, background-task behavior, history retrieval, or current account terms.
The previously accepted native-authentication boundary remains unchanged.
M0 must resolve these details using accessible official documentation and the
pinned native CLI's documented interface before claiming Claude support.
If required native interaction cannot be supported, keep that capability or
engine unavailable and record the blocker; do not replace the route with the
Agent SDK plus presumed subscription authentication.

## Consequences for the M0–M5 work plan

These are research recommendations; the maintained implementation plan owns
the final sequencing and ticket assignment.

| Slice | Research-derived deliverable | Minimum evidence |
|---|---|---|
| M0 | Pin supported CLI versions; confirm transports, native authentication-status method, permissions, background lifecycle and history | Versioned protocol/capability matrix; Claude uncertainty resolved or explicit engine gate |
| M1 | Add neutral adapter boundary, immutable engine binding and legacy Pi migration | Public Host tests prove Pi compatibility, no cross-engine resume and no Pi environment leakage |
| M2 | Implement Codex App Server adapter | Native start/resume/stream/interrupt/history plus approval interaction and process-failure fixtures |
| M3 | Implement Claude native CLI adapter | Same product contract through the validated native transport; background settlement and unknown-state guards |
| M4 | Connect existing Web layout to capabilities and native events | Three choices only at creation; fixed engine afterward; model choices scoped to that engine; reconnect and pending interaction remain usable |
| M5 | Verify shared Gitea workflow and staged deployment | Short real workflow per new engine, independently bound VM/user, clone/commit/push/SHA, one native continuation after reconnect, Pi regression and documented rollback |

Use deterministic adapter/public-seam fixtures for edge cases, then a small
real-CLI acceptance workflow. This research does not justify an exhaustive
paid-model matrix, repeating VM snapshot exercises, or importing the upstream
application wholesale.
