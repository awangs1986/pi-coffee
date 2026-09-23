# M0–M5: native Codex and Claude Code delivery

Status: **planned implementation; no milestone has passed acceptance**. Date: 2026-09-23.

Canonical requirements: [native-engine SPEC](../spec/native-agent-engines.md), [ADR-0013](../adr/0013-native-agent-engines.md), and [Browser Shell SPEC](http://gitea:3000/awangs/pi-coffee-server/src/branch/main/docs/spec/native-agent-browser.md).
Parents: [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48) and [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6).

This is the native-engine M0–M5 sequence, not a reopening of the earlier Pi MVP or T0–T4 migration. Each milestone has one delivery Issue; M4 belongs to Server and the other five belong to Agent. This publication only defines work, dependencies and acceptance. Installing or running native engines and deployment happen during implementation, not during plan preparation.

## Boundaries retained

- One user keeps one dedicated User VM and official native-engine authentication; Web remains separately deployed. Shared-account/shared-VM proposals are not adopted.
- Every Task has one Workspace and an immutable Agent choice: Pi, Codex or Claude Code. Bind at creation, including before the first prompt. Host validation, retries and archive/restore preserve it. Model selection stays within that Agent; another Agent requires a new Task.
- Pi Harness, prompts, Chat/Work policies, LSP Skill/CLI, plugins and context policies stay Pi-only. Native engines retain native settings, tools and permission behavior; no automatic bypass flags.
- Host owns execution, native bindings, history projection, file scope and ordinary Git/Gitea operations. Server owns the existing Browser Shell and transparent gateway. No new MCP service, platform worktrees, context conversion or credential relay.
- Preserve the current three-pane layout. Reuse the accepted frontend correctness fixes through normal review; this plan does not merge the unrelated frontend branch.

## Dependency and delivery map

| Milestone | Deliverable | Repository | Required predecessor | Issue |
|---|---|---|---|---|
| M0 | Pin native interfaces and resolve transport feasibility | Agent | Existing SPEC | [pi-coffee #49](http://gitea:3000/awangs/pi-coffee/issues/49) |
| M1 | Add engine-neutral Host contract and durable Task binding; keep Pi working | Agent | M0 | [pi-coffee #50](http://gitea:3000/awangs/pi-coffee/issues/50) |
| M2 | Implement native Codex Adapter | Agent | M1 | [pi-coffee #51](http://gitea:3000/awangs/pi-coffee/issues/51) |
| M3 | Implement native Claude Code Adapter | Agent | M1 | [pi-coffee #52](http://gitea:3000/awangs/pi-coffee/issues/52) |
| M4 | Expose three Agents through the existing Browser Shell | Server | M1 for fixtures; M2 and M3 for real acceptance/activation | [pi-coffee-server #7](http://gitea:3000/awangs/pi-coffee-server/issues/7) |
| M5 | Prove shared Gitea/file workflows, compatibility and staged release | Agent, with Server evidence | M2, M3 and M4 | [pi-coffee #53](http://gitea:3000/awangs/pi-coffee/issues/53) |

Execution order: M0 → M1 → M2 and M3 → M4 real integration → M5. M2 and M3 can proceed independently after M1. M4 controller work can start against M1 fixtures while the Adapters are implemented; fixture success does not authorize native-engine activation. If Claude's native interface fails M0's mandatory capability gate, record that blocker explicitly rather than substituting SDK subscription authentication. Codex-specific M0 evidence may unblock M1/M2 only after the Issue records that limited scope; M3 and the combined release remain blocked.

## M0 — Pin native interfaces and prove the transport boundary

**Problem and outcome.** ClaudeCodeUI and T3 Code are useful technical prior art, but their transport, authentication and lifecycle decisions are not automatically suitable for PI Coffee. Resolve version-specific uncertainty before building a generic Adapter around assumptions.

**Work.**

1. Inspect pinned ClaudeCodeUI and T3 Code source alongside official upstream documentation. Record CLI versions, supported local interfaces, native settings/authentication behavior and the provenance of each conclusion in a capability matrix.
2. Prefer Codex App Server over local stdio. For Claude, validate the unmodified official CLI's supported streaming/programmatic route. Keep SDK authentication separate; do not patch the binary, extract tokens or substitute undocumented provider calls.
3. Use disposable local workspaces to demonstrate one prompt, a file-reading tool event, authoritative native Session ID, continuation of that Session, history retrieval suitable for reconnect, targeted interruption, and required user-input/approval handling. Record whether each question requires a native RPC response or a later user message; preserve that distinction. Distinguish a resumed model context from a history projection: one does not prove the other.
4. Define foreground/background/unknown writer reporting and how to establish quiescence for Git and cleanup when native child-state reporting is limited. Do not call unknown idle or use a machine-wide process kill.
5. Produce an Adapter operation/capability matrix and minimal sanitized protocol fixtures. Specify mandatory baseline versus optional features, including model selection, images, queueing, steering, compaction and native history deletion. Readiness probes must not generate paid turns.

**Testing and exit.** The small real transport probes are the M0 evidence, not a production implementation. Record exact CLI versions, commands, observed native IDs in sanitized form, supported operations and unresolved gaps. Required conversation continuation, history reconstruction, controlled execution and actionable required input must have a supported path before the corresponding Adapter can be accepted. Unsupported optional features are explicitly disabled. Missing credentials mean blocked real evidence, not a fabricated pass. No central credential or transcript persistence is introduced.

**Scope limits.** No browser work, generic plugin framework, new permission layer, package replacement or production activation. Do not count source inspection as a successful local CLI probe.

## M1 — Establish the shared Host contract and migrate Pi behind it

**Problem and outcome.** The current Host lifecycle and Browser Events assume Pi. Create one additive public contract while preserving deployed Pi behavior.

**Work.**

1. Define Agent registry/configuration, health/version/readiness, supported operations, native presentation Events with stable item IDs, native input requests and run/writer states. Define ordering, duplicate suppression and expired-cursor resynchronization so native history and replay do not duplicate visible entries. Publish concrete HTTP/WebSocket schemas and old/new compatibility behavior in the Agent-owned protocol.
2. Persist engine, native Session binding and creation state separately from Conversation ID. Default legacy records to Pi without renaming native history or moving directories. Make creation retries idempotent and ambiguous starts recoverable without replaying a prompt.
3. Reject attempts to change a Task's engine, including before its first prompt and during failed creation or archive/restore. Reject unsupported engines and inappropriate model commands instead of silently falling back.
4. Put the existing Pi Adapter behind the common interface. Keep its native Events compatible with deployed clients, and confine Pi startup environment, Skills, prompts and Relay configuration to its Adapter.
5. Make Host lifetime, history/replay, native request correlation, stop confirmation, pending-input recovery and writer-aware workspace guards consume the common interface. Establish an explicit safe quiescence path; unknown writers block Checkpoint/PR/cleanup.
6. Preserve independent clone, Chat directories, scoped file operations and existing Gitea APIs. Supply the registered cwd to every Adapter. Keep configuration/credential ownership in the user VM.

**Testing and exit.** Red → green at the public Host HTTP/WebSocket seam using deterministic native-process fixtures, existing Pi integration tests and actual temporary Git repositories. Cover legacy migration, fixed engine, native-ID collisions across engines, lost acknowledgements, reconnect/restart, stale native answers, duplicated Events and expired cursors, cancellation isolation, background/unknown guards, and Pi environment isolation. Old clients still operate Pi; new clients work with old Hosts. Publish a fixture set M4 can consume. A fresh clone passes repository checks. This milestone does not advertise real Codex/Claude support.

**Scope limits.** No rewrite of the agent loop, Gitea workspace manager or Web gateway; no Pi event removal before compatible rollout. Do not import a reference application's event-sourcing database, provider catalog or frontend cache architecture merely to add two Adapters.

## M2 — Deliver the native Codex Adapter

**Problem and outcome.** Run the user's own Codex in its Task Workspace and expose supported behavior through M1's contract.

**Work.**

1. Implement the pinned M0 local App Server interface: initialization, thread creation/resume, turn submission, streamed items, supported interruption and native requests. Start with one Task-owned App Server runtime per active Task, with explicit process/run cleanup; connection loss does not end that runtime. Avoid process pooling in this milestone. Process native notifications in order and correlate native requests independently of visible message IDs.
2. Persist the returned native binding before treating creation as complete. Reconnect combines native history with a bounded in-flight tail, without replaying an uncertain prompt. Host/process failure reports interrupted or unknown state honestly. A failed resume must not silently start a fresh native thread while the Browser shows old history; retain the binding and offer explicit recovery or new-Task creation.
3. Load native Codex configuration and official authentication; never inject Pi prompts, LSP, plugins, model Relay or automatic permission bypasses. Native readiness errors retain the Task and Workspace.
4. Expose verified model/reasoning/image capabilities and native approval/input interactions. Unsupported operations return explicit capability errors. Preserve native history on archive; cleanup reports native data retained when supported deletion is unavailable.
5. Exercise ordinary edits through Codex in an existing independent Checkout and local Chat Workspace. Map terminal/background state into the existing Checkpoint/PR/cleanup guards and file services.

**Testing and exit.** First run the shared public contract against Codex protocol fixtures, including partial/out-of-order failure boundaries, request correlation, interruption and recovery, including a missing/failed native resume that must not fall back to a fresh thread. Then run one short real Codex code flow and local-file flow on the pinned CLI: read/edit a harmless file, inspect Diff, confirm a Gitea Checkpoint SHA, resume history and verify targeted stop. Reuse that evidence in M5 rather than repeating paid cases unnecessarily. Verify native input/approval behavior with a deterministic fixture plus the required real probe from M0. Record what was real, mocked or unsupported. Pi regression remains green.

**Scope limits.** No Codex prompt/tool redesign, native terminal feature parity, account import UI or external App Server listener.

## M3 — Deliver the native Claude Code Adapter

**Problem and outcome.** Run the user's unmodified Claude Code with its native behavior and official authentication through the same Host contract.

**Work.**

1. Implement the supported CLI transport pinned by M0 for prompt streaming, authoritative native identity, continuation, history access and targeted cancellation. Keep transport differences inside the Claude Adapter.
2. Preserve native project/user settings, tools, Skills, context and permissions. Do not use Pi Harness or automatically select a bypass mode. Do not substitute Agent SDK plus subscription credentials for the selected native CLI route.
3. Correlate native questions/permission requests with the correct Task/run. Persist binding and reconstruct reconnect/history correctly, including failures before and after initial ID acknowledgement.
4. Advertise only verified model/image/interaction capabilities. Respect native lifecycle and background limitations; support safe quiescence or block conflicting actions with a reason. Expired authentication remains recoverable without replacing the Task.
5. Reuse Chat directories, Checkout/Gitea and scoped files. Archive is non-destructive; cleanup accurately reports remaining native data. Keep original attachments even where inline model input is unsupported.

**Testing and exit.** Use the same public Host suite as M2 with Claude protocol fixtures for streaming, input, resume, uncertain delivery, interruption and process failure. Run one short real Claude code flow and local-file flow, including an edit, Diff, confirmed Gitea Checkpoint SHA, resume/history and targeted stop. M0 must have resolved the required native transport; a SDK-only demonstration or a resume that cannot supply required history is not acceptance. Keep Pi tests green and record supported versions and capability gaps.

**Scope limits.** No binary patches, private API calls, extracted tokens, SDK-authentication substitution or browser-owned Claude process.

## M4 — Integrate three Agents into the existing Browser Shell

**Problem and outcome.** Let users select and operate supported Agents without changing the established layout or pretending that all Pi controls apply to them.

**Work.**

1. Add exactly Pi, Codex and Claude Code to existing new-task controls. Disabled/unavailable entries explain Host readiness. The Agent becomes a compact read-only indicator immediately after Task creation, including before any prompt.
2. Keep Model selection separate and scoped to the bound Agent. Pi's Chat/Work runtime controls and custom LSP/plugin surfaces remain Pi-only. Hide or explain unsupported native actions and metrics.
3. Render normalized streamed messages, tool results, errors, native questions/approvals, foreground/background/unknown states and confirmed stop results. Use stable item IDs when incremental tool updates or replay update an existing entry. Retain old Pi rendering during compatibility rollout.
4. Preserve Task selection epochs, late-response rejection, uncertain-submit recovery and reconnect history. Never create another native Session or auto-resend a prompt to make the UI appear recovered.
5. Preserve complete copyable paths, VM/project/branch/sync context, original file uploads/previews, Diff/Checks, Checkpoint and Gitea PR. Explain writer-state rejections and retained-data cleanup results.
6. Keep the left task list, center conversation/composer and right changes panel. Verify sidebar collapse/expand, narrow windows and native request dialogs. Gateway forwarding stays independent of native protocols.

**Testing and exit.** Browser controller and HTTP/WebSocket gateway tests use M1's documented fixtures. Cover the three choices, immutable Agent, separate model selection, stale responses, duplicate/replayed items, disabled features and legacy Hosts. Run a focused responsive probe for the known sidebar/layout risks. After M2/M3, prove the existing browser actually operates both native Adapters; use these same runs for M5 evidence. Both source fixtures and real-engine screenshots alone are insufficient: verify outgoing requests and resulting Host/Workspace state.

**Scope limits.** No new dashboard, theme redesign, provider credential form, server-side Git engine or implicit merge/deploy of the unrelated frontend audit.

## M5 — Verify the combined workflow and release incrementally

**Problem and outcome.** Prove the completed platform flow and deploy compatible components without turning a small two-user product into an exhaustive test program.

**Work.**

1. Run both repositories' documented checks from fresh clones and record exact Agent/Server revisions plus native CLI versions. Review the M0 capability matrix against actual M2/M3 implementation.
2. Through the real Web gateway, complete one code Task per new Agent: select Gitea Project/start branch, obtain an independent clone, inspect cwd/branch, read/edit/run a harmless check, inspect Diff, Checkpoint/push with verified SHA, and create a Gitea PR. Start the second engine's new Task from a verified code Checkpoint and confirm its starting SHA and independent native context; do not silently transfer unversioned files or transcripts. Reuse already-valid M2–M4 evidence for the same revisions.
3. Complete one local Chat/file flow per new Agent: upload/download matching bytes, native supported consumption, browser reconnect, retained Workspace/history on archive and restore. Exercise explicit cleanup only on disposable Tasks and report retained native state honestly.
4. Use the two existing users and their existing separate VMs for a focused fixed-routing and cross-user access check. Run different-engine Tasks against the same test Project and confirm independent directories/branches; do not require a two-users-by-three-engines paid-turn matrix.
5. Test browser/gateway reconnect with native work alive, targeted stop, and one controlled Host/process interruption. Use fixtures for the larger fault matrix. Confirm uncertain delivery is not automatically replayed and unknown writers cannot race Checkpoint/PR/cleanup.
6. Deploy compatible Host first, then capability-gated Server. Verify a legacy Pi Task still works. Document how to disable native-engine activation without deleting bindings/files/history, and verify rollback to a version that understands the new metadata. Do not blindly start an older Pi-only binary against new records.
7. Record the user's short manual checklist: choose each Agent, see it fixed, change an allowed model where supported, send/read/edit, refresh, inspect path/Diff/sync/PR and archive/restore. Record unverified optional features explicitly.

**Testing and exit.** All required SPEC acceptance IDs have evidence linked below. Both native workflows pass through actual Web/Host/Gitea; test substitutes are identified. No regression in Pi or cross-user routing. There is one reproducible deployment/runbook and one sanitized evidence record linked from both parent Issues. Only then close M5 and consider parent implementation acceptance. A missing native authentication or mandatory interface remains a specific blocker, not a partial feature labeled complete.

**Scope limits.** No new VM provisioning, repeat snapshot rollback exercise, exhaustive model/provider matrix, performance program, GitHub publication or cross-engine transcript transfer. An automated cross-Agent handoff button remains a separate future scope; ordinary new-Task creation from a verified code Checkpoint is sufficient.

## Acceptance ownership

| Canonical acceptance | Primary milestone | Final integration evidence |
|---|---|---|
| NE-AC01–03: legacy Pi, fixed identity, collision handling | M1 | M5 |
| NE-AC04–06: readiness, native configuration, capabilities | M0, M2, M3 | M4/M5 |
| NE-AC07–10: reconnect, failure, native input, targeted stop | M1, M2, M3 | M4/M5 |
| NE-AC11–13: files, independent clones, Gitea correctness | M1, M2, M3 | M4/M5 |
| NE-AC14–16: writers, archive/cleanup, code continuation | M1, M2, M3 | M5 |
| NE-AC17–18: compatibility and credential/data boundaries | M0, M1, M4 | M5 |

Repository checks are mandatory, but existing Pi tests do not prove native-engine support. Tests should assert public behavior and resulting files/Gitea state, not Adapter class names or exact model wording. Keep real model usage short and bounded; test failure combinations deterministically at the public seam.

## Reference and publication status

ClaudeCodeUI's pinned main Codex path uses Codex SDK and its Claude path uses Agent SDK; its App Server helper serves fork/edit operations. Borrow explicit native identity, stable item IDs, bounded replay and background-settlement lessons, not its authentication inspection, generic permission translations or execution transport by assumption. PI Coffee still prefers Codex App Server and requires verification of the native Claude CLI route.

T3 Code supplies a more direct reference for Codex App Server integration and has implemented Codex and Claude drivers, but its Claude path also uses Agent SDK. Borrow Task-owned process scope, ordered notifications and correlated native requests. Do not copy its permission-bypass defaults, injected prompt/MCP configuration or broader persistence architecture. A source-level resume-to-new-thread fallback is specifically not adopted: displayed old history must not be mistaken for restored native context.

See the [pinned ClaudeCodeUI research](../research/claudecodeui-native-engines-20260923.md) and [pinned T3 Code research](../research/t3code-native-engines-20260923.md) for source-backed reuse decisions. This research is design input, not a completed M0 native CLI experiment. Milestone Issues hold live status, blockers and acceptance evidence; this document holds the maintained implementation sequence.
