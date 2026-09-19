# PI Coffee product decisions

This document records the resolved decisions from the design conversation. It distinguishes what the first MVP proves from what the 0.1 release must add. Ticket status lives in Gitea, not here.

## Product and repository

| Decision | Status |
|---|---|
| The product name is **PI Coffee**. | accepted |
| `awangs/pi-coffee` is the independent main repository for this work. | accepted |
| The existing Picode repository is called **V5** and remains frozen. | accepted |
| PI Coffee starts from the unmodified original Pi agent and adds adapters around it. | accepted |

## Runtime topology

- The **Control Plane/Web VM** runs Debian and hosts the Web Server, browser-facing session routing, the central LLM Relay, and minimal usage/routing metadata.
- Each internal user has one long-lived **User VM** running Linux Mint Xfce Edition. The User VM hosts the Agent Host, Pi processes, native transcripts, context, task files, worktrees, and uploaded files.
- Picode does not create, destroy, snapshot, or repair VMs. The owner restores a VM snapshot manually when needed.
- The Web Server and Agent Host are separate processes even when `npm start` runs both together for a local smoke test.

## Ownership and privacy

- Durable conversation content stays in the User VM: transcript, model context, task/handoff evidence, plugin state, worktree contents, and inbox files.
- The Control Plane may retain only a routing index (user → fixed User VM, opaque IDs, health/cursors) and usage metadata. It must not persist prompt text, tool output, or context正文.
- Browser disconnect is a transport change, not a session cancellation. A Host continues the Pi process and buffers enough Events for reconnection.

## Identity and credentials

- Gitea is the sole human identity source for 0.1. The user signs in through Gitea OAuth; the Control Plane maps that identity to a fixed User VM.
- Gitea is an internal collaboration/relay repository, not the final code archive and not internet-facing. Account permissions are managed by the owner.
- No repository branch-protection policy is required; the owner protects privileged actions through account access.
- The unique upstream LLM credential belongs on the Control Plane. The User VM must not receive it once the central Relay is enabled.

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
- The Shell can host multiple Tasks and Pi Sessions in 0.1; the MVP UI starts with one conversation while the Host registry already supports more than one Session.
- Refreshing or closing the browser must not stop active Tasks. Reconnection uses opaque Session IDs and Event Cursors.

## Files and images

- 0.1 uploads are streamed to the current Task's User VM inbox, by default `.picode/inbox/` in that Task's worktree.
- A file is persistent in the User VM, checked for name/MIME/size and SHA-256, and never durably stored on the Control Plane.
- Initial limits are 256 MiB per file and 1 GiB per batch.
- Images retain the original bytes. If the selected model accepts image content, the Host sends an image block; otherwise it sends a safe path/reference so the agent can inspect it.
- There is no thumbnail archive on the Control Plane and no malware sandbox in the User VM.

## Execution model

- VM isolation is the execution seam. Inside a User VM, Pi has the normal shell and file rights required by the owner.
- PI Coffee does not reproduce V5's in-process Guard, approval, permission-tier, or command sandbox stack.
- Worktrees are later task/repository organization, not a security mechanism. They are not part of the first MVP.

## Deployment automation

The future Deployment Skill is idempotent: install the pinned Pi package, PI Coffee Host, and systemd configuration; accept a one-time Enrollment Token; exchange it for a revocable Host identity; and emit a deployment report. It is a 0.1 deliverable, not required for the local MVP.

## Pi Agent design — current, maintained contract

The owner-confirmed Agent decisions live in the [Pi Agent main SPEC](../spec/pi-agent.md), with stable PA requirement IDs, rationale, open questions, implementation status and acceptance criteria. The [Work prompt SPEC](../spec/harness-prompt.md) owns the WP behavior rules and prompt maintenance process; dated reviews provide evidence, not a second contract.

The 2026-09-20 decisions supersede the old V3-derived Lean/Full and Simple/Full product-mode design. The target has only Chat and Work. Chat has no system prompt, including Pi's native default; Work has a complete development prompt. Exact tool inventories and migration details remain explicitly unresolved in the main SPEC. Agent extensions must remain plugins around the unmodified Pi, with an upgradeable upstream and a restrained tool surface.

The checkout still uses legacy mode routing and appends the Work body to Pi Base. This is implementation status, not a decision to preserve that behavior in Chat. Gitea synchronization for the new decisions is pending connectivity; no external ticket acceptance is asserted.

## Explicit deferrals

V5 feature migration is a later, separately ticketed phase. No current 0.1 ticket is permission to copy V5 implementation or revive its sandbox/worktree design. The first priority is a reliable web conversation seam.

## `pi-subagents` compatibility implementation

This section describes the legacy runtime, not the new Chat/Work policy. Allocation to the new modes remains PA-Q04 in the main SPEC.

The Agent Host loads the locked upstream `pi-subagents@0.63.0` extension and
its resources through local adapters. The upstream module owns the executor;
local plugin adapters handle loading, model policy, admission and bounded
parent-facing output. `subagent` and `bg_wait` remain optional tools exposed
through Harness `search_tools`, outside the legacy 8/10 base tool counts.
`PI_COFFEE_SUBAGENTS=off` is the scoped rollback switch and
`PI_COFFEE_EXTENSIONS=off` disables all extension loading. Real User VM child
execution and browser observability require a separate acceptance ticket.

## Harness compatibility implementation

The existing native Pi Harness retains the historical V5 tool-table reference
`awangs/picode@778a3d534ba41f331210037a8c791bdfc0dabe7f`: Simple has 8 base tools
and Full has 10, with registered recovery and optional tools accounted for
separately. It now reads one Work body, not two Lean/Full fixtures. These tables
are compatibility behavior, not the new Work inventory or a reason to inject
instructions into Chat. VM isolation remains the execution boundary; Guard,
permission tiers, managed snapshots and enforced development gates are not
reintroduced. See the [compatibility SPEC](../spec/harness-plugin.md).
