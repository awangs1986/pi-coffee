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

## Harness prompt baseline

The current V3 prompt result is the content baseline for PI Coffee. Per the maintainer's provenance note, V3 went through three prompt evolutions: a current Claude Code prompt extraction/material pass, a Pi-specific adaptation, and a stabilization pass. PI Coffee derives two Pi-native profiles from that result: `lean` for the stable behavioral core and `full` for the self-contained engineering/TDD guidance layer.

The prompt is appended to Pi's native Base Prompt and is guidance only. It must describe only tools and Host behavior that are actually available in the current session. It must not invent execution controls, identity, permissions, sandboxing, automatic gates, or rollback. The canonical fixtures and renderer are documented in [`docs/spec/harness-prompt.md`](../spec/harness-prompt.md) and tracked by Gitea Issue [#14](http://testpc:3000/awangs/pi-coffee/issues/14).

## Explicit deferrals

V5 feature migration is a later, separately ticketed phase. No current 0.1 ticket is permission to copy V5 implementation or revive its sandbox/worktree design. The first priority is a reliable web conversation seam.
