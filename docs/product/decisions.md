> Source authority and repository placement: superseded where conflicting by [ADR-0020](../adr/0020-unified-github-authority.md). GitHub pi-coffee-server owns Web and Host.

# PI Coffee product decisions

This document records the resolved decisions from the design conversation. It distinguishes what the first MVP proves from what the 0.1 release must add. Ticket status lives in Gitea, not here.

## Product and repository

| Decision | Status |
|---|---|
| The product name is **PI Coffee**. | accepted |
| `awangs/pi-coffee` is the independent main repository for this work. | accepted |
| The existing Picode repository is called **V5** and remains frozen. | accepted |
| PI Coffee starts from the unmodified original Pi agent and adds adapters around it. | accepted |

## Native engines (2026-09-23)

Accepted design: add native Codex and Claude Code behind Host Adapters while retaining the existing Browser Shell and shared Conversation Workspace/Gitea services. Each engine keeps its own native behavior and official user authentication. Pi's Harness, Chat/Work prompts, LSP, tools, plugins and context policy remain Pi-only; the trusted VM model does not disable another engine's native permissions.

[ADR-0013](../adr/0013-native-agent-engines.md) refines earlier Pi-only decisions. The [native-engine SPEC](../spec/native-agent-engines.md) is ready for implementation under [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48) and [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). No runtime or deployment completion is claimed.

## Runtime topology

- The **Control Plane/Web VM** runs Debian and hosts the Web Server, browser-facing session routing, the central LLM Relay, and minimal usage/routing metadata.
- Each internal user has one long-lived **User VM** running Linux Mint Xfce Edition. The User VM hosts the Agent Host, Pi processes, native transcripts, context, task files, checkouts, and uploaded files.
- Picode does not create, destroy, snapshot, or repair VMs. The owner restores a VM snapshot manually when needed.
- The Web Server and Agent Host are separate processes even when `npm start` runs both together for a local smoke test.

## Ownership and privacy

- Durable conversation content stays in the User VM: transcript, model context, task/handoff evidence, plugin state, checkout contents, and inbox files.
- The Control Plane may retain only a routing index (user → fixed User VM, opaque IDs, health/cursors) and usage metadata. It must not persist prompt text, tool output, or context正文.
- Browser disconnect is a transport change, not a session cancellation. A Host continues the Pi process and buffers enough Events for reconnection.

## Identity and credentials

- Gitea is the sole human identity source for 0.1. The user signs in through Gitea OAuth; the Control Plane maps that identity to a fixed User VM.
- Gitea is an internal collaboration/relay repository, not the final code archive and not internet-facing. Account permissions are managed by the owner.
- No repository branch-protection policy is required; the owner protects privileged actions through account access.
- For the existing Pi Relay route, the central upstream LLM credential belongs on the Control Plane and is not passed to the User VM. Native Codex and Claude Code use their own official user authentication in the User VM, as defined by ADR-0013; they do not inherit that Relay credential policy.

## LLM Relay

The Relay is a transparent pass-through to the existing CPA reverse proxy. It must preserve both OpenAI-compatible surfaces, ordinary JSON, and SSE streaming:

- base URL: `https://b.awangsawangs.xyz/v1` (deployment configuration, never a key)
- `/v1/chat/completions`
- `/v1/responses`
- `/v1/models`
- `/v1/responses/compact`

The Relay must not add a second model protocol, buffer an entire stream, or write prompt bodies to durable Control Plane storage.

## Browser model

- One browser tab is a Browser Shell.
- One Task corresponds to exactly one Conversation and one local Workspace on its owning User VM. The Shell lists multiple Tasks; reconnecting or restarting Pi resumes the same Task rather than creating another one.
- Refreshing or closing the browser must not stop active Tasks. Reconnection uses opaque Session IDs and Event Cursors.

## Files and images

- Every Conversation has one stable User VM Workspace. Chat Workspaces live under a centralized `chats/<conversation-id>/` root; Work uses the existing independent Gitea Checkout. Runtime Chat/Work mode changes do not move or silently convert that Workspace.
- Uploads are streamed to the current Conversation's inbox. Search evidence, large tool/subagent results and generated images are stored in that same Conversation's `research`, `artifacts` and `images` areas; registered Conversations do not fall back to a global Agent directory.
- A file is persistent in the User VM, checked for name/MIME/size and SHA-256, and never durably stored on the Control Plane.
- Initial limits are 256 MiB per file and 1 GiB per batch.
- Images retain the original bytes. If the selected model accepts image content, the Host sends an image block; otherwise it sends a safe path/reference so the agent can inspect it.
- There is no thumbnail archive on the Control Plane and no malware sandbox in the User VM.
- Product/API routing prevents accidental cross-Conversation access, but directories inside one trusted User VM are not OS security sandboxes: unrestricted Pi/Bash and the VM owner can access everything allowed to that Unix account. The complete contract is [`conversation-workspaces.md`](../spec/conversation-workspaces.md).

## Execution model

- VM isolation is the execution seam. Host/Pi runs as the VM owner with unrestricted passwordless sudo; T0 must verify this from the service process.
- PI Coffee does not reproduce V5's in-process Guard, approval, permission-tier, or command sandbox stack.
- [ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md) replaces platform-managed worktrees and local merge coordination with independent Conversation clones and Gitea PR integration. [T0–T4](../development/t0-t4-gitea-workspaces.md) is the pending implementation plan.

## Deployment automation

The future Deployment Skill is idempotent: install the pinned Pi package, PI Coffee Host, and systemd configuration; accept a one-time Enrollment Token; exchange it for a revocable Host identity; and emit a deployment report. It is a 0.1 deliverable, not required for the local MVP.

## Pi Agent design — current, maintained contract

The owner-confirmed Agent decisions live in the [Pi Agent main SPEC](../spec/pi-agent.md), with stable PA requirement IDs, rationale, open questions, implementation status and acceptance criteria. The [Work prompt SPEC](../spec/harness-prompt.md) owns the WP behavior rules and prompt maintenance process; dated reviews provide evidence, not a second contract.

The 2026-09-20 decisions define the Pi-specific product-mode design. The target has only Chat and Work. Chat has no system prompt, including Pi's native default; Work has a complete development prompt. Exact tool inventories and migration details remain explicitly unresolved in the main SPEC. Agent extensions must remain plugins around the unmodified Pi, with an upgradeable upstream and a restrained tool surface.

The checkout still uses legacy mode routing and appends the Work body to Pi Base. This is implementation status, not a decision to preserve that behavior in Chat. Gitea synchronization for the new decisions is pending connectivity; no external ticket acceptance is asserted.

## Explicit deferrals

V5 feature migration is a later, separately ticketed phase. No current 0.1 ticket is permission to copy V5 implementation or revive its sandbox/worktree design. The first priority is a reliable web conversation seam.

## `pi-subagents` compatibility implementation

This section describes the legacy runtime, not the new Chat/Work policy. Allocation to the new modes remains PA-Q04 in the main SPEC.

The Agent Host loads the locked upstream `pi-subagents@0.63.0` extension and
its resources through local adapters. The upstream module owns the executor;
local plugin adapters handle loading, model policy, admission and bounded
parent-facing output. `subagent` and `bg_wait` remain optional tools exposed
through Harness `search_tools`; target mode allocation remains pending.
`PI_COFFEE_SUBAGENTS=off` is the scoped rollback switch and
`PI_COFFEE_EXTENSIONS=off` disables all extension loading. Real User VM child
execution and browser observability require a separate acceptance ticket.

## Harness compatibility implementation

The current Harness still uses compatibility routing; implementation details remain in code and Git history. Product design is Chat/Work only. Work retains Pi Base and appends its development body; Chat receives no system instructions. Runtime migration is pending. VM isolation remains the execution boundary; no permission kernel or managed snapshots are introduced. See the [plugin seam](../spec/harness-plugin.md).
