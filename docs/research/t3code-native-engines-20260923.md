# T3 Code native-engine integration reference

Date: 2026-09-23. Status: pinned-source research for M0–M5, not execution
evidence. Canonical requirements remain the
[native-engine SPEC](../spec/native-agent-engines.md),
[ADR-0013](../adr/0013-native-agent-engines.md), and
[implementation plan](../development/native-agents-m0-m5.md).

## Provenance and implemented engines

Inspected `pingdotgg/t3code` default-branch HEAD
[`6975efd3dd52c95dd978ff26f591139d8c5c2503`](https://github.com/pingdotgg/t3code/tree/6975efd3dd52c95dd978ff26f591139d8c5c2503).
No dependencies were installed and no upstream application or tests were run.
The repository declares an
[MIT license](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/LICENSE).
This note recommends patterns without importing implementation code.

Both Codex and Claude have registered drivers and substantive adapter
implementations; they are not merely roadmap labels. The
[driver registry](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/builtInDrivers.ts#L23-L57)
also registers Cursor, Grok, OpenCode and Antigravity. Registration and source
presence establish implementation scope, not successful local authentication
or runtime acceptance for PI Coffee.

| Reference | Codex main transport | Claude main transport |
|---|---|---|
| T3 Code at the commit above | Native App Server through an in-repository typed stdio client | Claude Agent SDK `query` |
| Claude Code UI at the separately researched commit | Codex SDK; App Server helper for fork/edit | Claude Agent SDK `query` |
| PI Coffee accepted direction | Native App Server, local stdio | Unmodified native CLI through a validated programmatic interface |

Sources: T3
[Codex runtime](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1290-L1360),
[Claude adapter](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/ClaudeAdapter.ts#L1-L27),
and our [Claude Code UI research](./claudecodeui-native-engines-20260923.md).
Neither project proves that our chosen Claude native CLI route has the needed
bidirectional approval, background-task and history behavior. M0 retains that
verification gate; SDK authentication must not be presumed interchangeable.

## Codex process, protocol and native session ownership

The Codex adapter keeps a map keyed by application thread ID. Starting a
session allocates a dedicated scope and creates a session runtime; that runtime
spawns its own App Server child with workspace, executable, environment and
native-home settings. Its event consumer belongs to the session scope rather
than the initiating request. This is a **per active application thread runtime**
design, not one process created by each browser connection and not one shared
chat process for every task. Sources:
[adapter session creation](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexAdapter.ts#L2250-L2350),
[child process creation](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1290-L1360).

The child stdio bridge connects child stdout/stdin to the typed client.
The runtime installs request/notification handlers, performs
`initialize`/`initialized`, and opens or resumes the provider thread.
Its generator pins an OpenAI source revision, demonstrating why a reproducible
schema matters; that upstream revision is not our supported CLI version.
Sources:
[stdio bridge](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/packages/effect-codex-app-server/src/_internal/stdio.ts#L12-L25),
[initialization](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L2430-L2458),
[schema generator](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/packages/effect-codex-app-server/scripts/generate.ts#L20-L24).

PI Coffee can use the same process-lifetime principle inside the User VM Host.
Browser disconnects must not own or terminate the child. A small adapter can
provide this without importing the Effect stack or the upstream orchestration
framework. Pin and validate the actual deployed CLI/schema pair in M0/M2.

## Ordering, approvals, reconnect and persistence

- **Ordered native events:** T3 registers notifications into a queue and drains
  them serially. This avoids asynchronous handlers reordering related native
  state changes. PI Coffee needs ordered per-session normalization and stable
  event IDs before browser replay. Source:
  [notification queue](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L2348-L2370).
- **Actual request/response approvals:** command and file approvals create a
  pending decision tied to platform/native identifiers, emit a request event,
  and wait for an answer. Responses resolve that specific decision; missing
  pending requests produce an error, and unknown server RPC requests receive
  method-not-found. PI Coffee should preserve native choices and expiration,
  not turn an approval into an ordinary assistant paragraph. Sources:
  [command approval](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L2056-L2110),
  [answer handling](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L2628-L2657).
- **Native state and presentation state are different:** a persisted provider
  binding includes provider, instance, runtime state and resume cursor. T3's
  orchestration separately commits domain events, projections and command
  receipts in one transaction, then publishes. A restored display does not by
  itself prove native context was resumed. Sources:
  [session directory](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/ProviderSessionDirectory.ts#L64-L89),
  [commit-before-publish](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L273-L341).
- **Reconnect does not mean retry every mutation:** the connection architecture
  has one retry owner per environment, durable subscription recovery, and
  distinct transport/data-freshness states. It retains applied state and cursor
  together and does not automatically replay failed mutations. PI Coffee can
  adopt these correctness rules while retaining VM-owned history and its own
  browser-cache policy. Source:
  [connection runtime](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/docs/internals/connection-runtime.md).
- **Blocking and asynchronous questions differ:** T3 documents that a native
  async question can be a notification answered by a new user message, whereas
  a blocking question requires an RPC reply. It also documents retained question
  activity across reconnect/restart. M0 must enumerate the supported forms in
  the pinned CLI; normalization must preserve their answer mechanism. Source:
  [provider protocol constraints](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/docs/internals/providers.md#protocol-traps).

## Behaviors deliberately not adopted

1. **No silent fresh context after failed resume.** T3's Codex open-thread helper
   catches selected recoverable resume errors and calls `thread/start`. Our
   immutable Task/native-session contract instead requires an explicit failure
   or visible recovery decision; old displayed messages must not falsely imply
   that a new native thread remembers them. Source:
   [resume fallback](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L722-L777).
2. **No inherited permission bypass.** T3 documents an initially permissive
   thread setting. Its Codex mode mapping can disable approvals/sandboxing and
   its Claude mapping enables `bypassPermissions` with the SDK bypass flag.
   PI Coffee keeps native configuration and approvals; VM owner privileges
   alone do not select these settings. Sources:
   [permission guide](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/docs/user/permission-modes.md),
   [Codex mapping](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L509-L543),
   [Claude mapping](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4879-L4942).
3. **No automatic prompt/tool additions.** T3 appends runtime instructions to
   the Claude preset and supplies attachment-directory grants and, when present,
   an application MCP session. Those are T3 product choices, not requirements
   for connecting a Web client to native engines. PI customizations remain
   Pi-only. Source:
   [Claude query options](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4900-L4960).
4. **No account switching or shared native homes.** T3 offers compatible Codex
   account switching with a shared session home and shadow credential home.
   PI Coffee continues one user/VM, native user authentication and fixed
   Pi/Codex/Claude Code selection per Task. Source:
   [Codex account guide](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/docs/user/providers-codex.md).
5. **No replacement of Gitea workflow.** T3's hidden-ref checkpoints coordinate
   provider-conversation rollback with files. PI Coffee continues independent
   clones, explicit code Checkpoints/push/SHA confirmation and Gitea PRs. Do not
   import upstream worktree, rollback, event-store or multi-environment product
   scope merely because the source contains it. Source:
   [T3 architecture](https://github.com/pingdotgg/t3code/blob/6975efd3dd52c95dd978ff26f591139d8c5c2503/docs/internals/overview.md#turn-completion-and-checkpoints).

## M0–M5 acceptance implications

| Slice | Specific lesson to carry into the maintained plan |
|---|---|
| M0 | Pin CLI/schema; enumerate approval/question shapes, background semantics and native persistence; keep Claude native CLI feasibility unresolved until directly verified |
| M1 | Persist engine/native binding separately from presentation state; fixed engine and legacy Pi default; no silent resume replacement |
| M2 | Use Host-owned Codex App Server lifetime, ordered events, correlated native requests and explicit process-failure handling |
| M3 | Borrow lifecycle tests from both references while implementing the selected native Claude transport; do not substitute SDK presets or bypass flags |
| M4 | Keep existing layout; distinguish reconnect from stale history; restore pending interactions; reject duplicate/stale answers and scope models to the fixed engine |
| M5 | Demonstrate native continuation after reconnect/restart and the existing Gitea flow; confirm staged Host/UI compatibility and rollback against persisted records |

The useful synthesis is T3's direct App Server integration plus both projects'
session/event lifecycle lessons. It does not change PI Coffee's repository,
VM, credential, Gitea, or immutable-engine boundaries. Tests and source code
inspected here are references; only our own pinned-CLI/public-Host/browser
acceptance can establish shipped support.
