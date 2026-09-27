# M0–M4 native Agent implementation evidence

Date: 2026-09-23. Scope: Agent #49–52 and Server #7, under Agent #48 / Server #6.
M5 deployment, two-user routing acceptance and release remain open. No production
Host or Web service was replaced. The unrelated frontend audit branch was not
merged. English maintained documentation and Chat/Work terminology are retained.

## Implemented boundary

Tasks choose Pi, Codex or Claude Code at creation. The Host persists that choice
before a prompt, routes through an engine-neutral Adapter and retains the native
binding through disconnect/restart/archive. Native configuration, credentials,
tools and permissions remain with each CLI; Pi customizations remain Pi-only.
The Browser keeps its existing layout and gates controls by Host capability.

Codex CLI 0.154.0 uses App Server stdio. Claude Code CLI 2.1.280 uses its native
stream-json control channel and version-pinned local history projection. No
Agent SDK, new MCP service, provider relay or transcript conversion was added.
See the [activation/recovery guide](../deployment/native-agents.md) for the
supported operation matrix, exact transport flags and explicit limitations.

## Real native and Web/Gitea checks

Tests used temporary processes on the current machine, a loopback Web gateway,
Task-owned native processes, independent clones and a disposable private Gitea
repository. They did not change global native authentication or production
service configuration. Credentials were passed through process environments and
are absent from this evidence, source and Issues.

- Codex model/provider: `gpt-5.6-terra`, the owner-specified Eidolon endpoint.
  Only that model was used after the owner supplied the constraint. An earlier
  M0 native transport probe used the existing native login before that steering.
- Claude model/provider: `claude-sonnet-4-6`, the owner-specified endpoint.
- The actual Browser created each Work Task through the gateway. Agent became
  read-only; the Model catalogue belonged to the chosen engine. Each clone had
  its own cwd and branch despite sharing one Gitea project.
- Both engines read a seeded README, wrote only a disposable `probe.txt`, and
  read it back. Native command/file/tool events appeared in the Browser. Actual
  file bytes, rather than model prose, were the acceptance oracle.
- Codex Checkpoint local/remote SHA:
  `ffe1c34edf33e12ef6dc5574aa2ecc8a24b851f4`.
- Claude Checkpoint local/remote SHA:
  `7f1131b959d0d047baa48ec18822f51ca0f9a4b4`.
- A controlled Host restart restored each native history and original binding.
  Codex recalled its earlier marker without tools. Claude resumed the earlier
  instruction and requested the original marker's Write operation.
- Claude's real Write approval was retained across browser disconnect/reopen;
  approving it continued the same run. Required `can_use_tool` responses use
  the original input. Native question groups and decline/stale-answer behavior
  also have deterministic protocol tests.
- The Browser requested and observed native interruption for both engines.
  Claude's native Bash policy denied the requested sleep operation; its active
  response was then interrupted. This proves native turn cancellation, not a
  claim that a denied command ran. Two-task cancellation isolation is covered
  deterministically at the Host seam.
- Each engine also received a separate Chat folder. Public scoped transfer
  uploaded/downloaded matching original bytes and archive/restore retained them.
  These file-service checks used HTTP; code turns used the actual Browser.
  Attachment SHA256 values were
  `1ffa17cf7316f70c869e57169c8f5e906bc5c1ab8e4d11be75a368b36bd0b0bc`
  and `e70ff8a10bbd080ea13ac25aa18653a45c0f0761fc5262c9c70e60cc168c93b3`.
- Earlier native Claude transport probing observed real
  `background_tasks_changed`, `task_started`, `task_updated` and
  `task_notification` events for a disposable background Bash job. Writer-state
  fault combinations are tested with executable fixtures, not paid matrices.

## Failures found and corrected

1. Codex rejects reading turns from a newly created empty thread. Initial
   history now comes from the authoritative start/resume response; failed resume
   never creates a replacement thread.
2. The existing Codex configuration was read-only and correctly rejected an
   edit. The writable acceptance process explicitly used native
   `workspace-write` / `on-request` settings. Product Adapters set no permission
   bypass and preserve native defaults.
3. Claude requires `--permission-prompt-tool stdio` in addition to host permission
   prompts for client approval. A real Write probe verified the corrected route.
4. Native idle Git operations no longer terminate a healthy native process;
   lifecycle locks still prevent racing prompts and reject active/unknown writers.
5. An invalid approval answer no longer loses the pending dialog. Pending
   approval recovery also works after the event buffer expires.
6. Accepted native request IDs prevent duplicate delivery after Host restart.
   Unknown Task IDs cannot fall back to a new Pi Session.
7. A browser refresh previously used another tab's last selected Task. Selection
   now prefers this tab's session storage; obsolete socket frames are ignored.
8. Collapsing the sidebar removed its grid item and placed the center pane in a
   zero-width column. Explicit pane columns fix the placement without moving
   panes. The measured center width changed from 0 to about 794px at a 1280px
   viewport with Checkout open. At an actual 390×844 viewport, center width was
   390px, composer bottom about 614px, and there was no horizontal overflow.
9. Native user cancellation is rendered as interrupted after terminal evidence,
   rather than being presented as a provider failure.
10. Claude journals unknown writers before submission. Restarting after a
    foreground answer with unfinished background work cannot authorize Checkpoint.

## Automated evidence and limits

Tests follow red → green at the approved public Host HTTP/WebSocket seam and
Browser controller/gateway seam. External executable fixtures speak the native
protocol, while Git operations use real temporary repositories. Coverage includes
immutable Agent identity, disabled CLI versions, missing native authentication, native history recovery, missing
history without replacement, approvals/questions, interruption isolation,
background guards across restart, retained-data cleanup, legacy compatibility,
replayed items, uncertain sends and tab selection.

The final repository/fresh-clone check results and exact revisions are recorded
in the delivery Issues. `npm ci && npm run check` is the clean-clone procedure.
Native CLIs and provider credentials are not required for that check.

Inline images, reasoning controls, Pi-specific queue/steer/stats/extensions,
native rename and permanent native cleanup are not advertised for native engines.
Discovery checks installation/version and local native authentication status, not live provider authorization.
Native expired authentication remains an actionable native configuration error.
This evidence does not claim every native terminal feature, background process
variant, provider model, two-user routing or production deployment was tested.
M5 owns the remaining rollout and combined release acceptance.
