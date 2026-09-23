# Native Agent activation and recovery

This release adds opt-in Host Adapters for Codex CLI **0.154.0** and Claude Code
CLI **2.1.280**. Other versions remain unavailable until their native interface
is verified. Pi remains the default. Production activation and the two-user
release gate belong to M5; implementation checks do not deploy either service.

## Installation and activation

Install the official CLIs under the existing User VM owner. Use native login or
native provider configuration for that owner. Web/Gitea login does not replace
native authentication. Neither repository stores provider keys or imports native
accounts. Do not place credentials in Issues, task prompts or service command
arguments. Environment-based credentials belong only in the VM's protected
service environment or its existing native configuration.

Set either or both executable paths in the Host service environment:

```sh
PI_COFFEE_CODEX_COMMAND=/absolute/path/to/codex
PI_COFFEE_CLAUDE_COMMAND=/absolute/path/to/claude
```

These values are executable paths, not shell command strings. The Host starts
one native process per active Task in its existing Chat folder or independent
Gitea clone. Native configuration, model defaults, tools and permissions remain
owned by the CLI. For example, an existing read-only Codex configuration still
rejects writes; the Adapter does not change it to a writable or bypass mode.
Pi Harness variables, Skills and extension arguments are not injected.

Deploy the compatible Host before the Server. `GET /api/engines` reports exactly
Pi, Codex and Claude Code, their installation/version and local authentication readiness, and an explicit
reason for disabled engines. This uses local version and native authentication status checks, not an
API billing call or a guarantee that a provider will accept the next request.
Codex uses `account/read` with refresh disabled; Claude uses `auth status --json`. Only configured/required/unknown is exposed, never account details. Native authentication is evaluated by the native engine. Expired credentials
must be repaired using that engine on the VM; preserve the Task binding.

## Verified transports

Codex uses `codex app-server` over private stdio: initialize, thread start/resume,
thread read, turn start/interrupt, model list and native request responses.
The thread returned by start/resume supplies the initial history. Reading turns
from a new empty thread can return `list_turns is not supported yet` in the
pinned CLI; no replacement thread is created to hide that condition.

Claude uses the unmodified CLI with these transport arguments:

```sh
claude --print --input-format stream-json --output-format stream-json \
  --verbose --include-partial-messages --permission-prompts host \
  --permission-prompt-tool stdio --session-id <prepared-uuid>
```

A bound Task uses `--resume <native-id>` instead of `--session-id`. The `stdio`
permission handler is the CLI's control channel; it does not start an MCP server
or substitute the Agent SDK. Omitting it was observed to deny Write without
sending the client a permission request. The Adapter sends native `initialize`,
`interrupt` and `set_model` controls and responds to `can_use_tool`. Required
questions are answered through the same native request, never as an unrelated
new chat message.

Claude's native JSONL history is read only for the bound Task's cwd/session
under `CLAUDE_CONFIG_DIR` (or the native default). It remains a local display
projection; the Web Server does not ingest or convert transcripts. A missing or
damaged history file fails visibly. Native settings and compaction still belong
to Claude.

## Capability limits

| Operation | Codex | Claude Code |
|---|---|---|
| Stream text and tool results | Enabled | Enabled |
| Native model catalogue and selection | Enabled | Enabled |
| Task-scoped stop | Native turn interrupt | Native interrupt control |
| Native approvals and questions | Correlated native RPC responses | Native permission control responses |
| Restore native context/history | Same thread ID | Same session ID and native history |
| Files and Gitea Checkpoint/PR | Existing scoped services | Existing scoped services |
| Inline image input | Not advertised in this release | Not advertised in this release |
| Pi steering, queues, extensions, commands, statistics, compaction | Disabled | Disabled |
| Reasoning selector and native rename | Disabled | Disabled |
| Permanent native history cleanup | Unavailable; archive retains data | Unavailable; archive retains data |

Original uploaded files are retained even when inline input is unavailable.
Models can use their native file tools where those tools support the format.
A selected model is not a promise that the owner's provider grants access to it.

## Failure and writer recovery

Task engine identity is durable before the first prompt. A native binding cannot
be switched to another ID. A failed resume, missing CLI or uncertain first start
never falls back to Pi or a new native Session. Browser reconnect does not kill
the native process. The last 256 accepted native request IDs are retained to
reject accidental replay; clients must not retry uncertain delivery automatically.

Checkpoint, push, PR and cleanup reject active or unknown writers. Native idle
sessions remain connected during Git operations; Host lifecycle locks reject a
racing prompt. Codex inspects native turn/command/child states conservatively.
Claude tracks native background-task snapshots independently of answer completion
and journals uncertainty before a turn. A restart cannot turn an unfinished
background job into an idle claim.

If Claude's binding records `writers: unknown` after a lost process, the VM owner
must inspect the original process group and background work. Stop the Host,
verify no writer for that Task survives and inspect the checkout. Only after
that inspection may the owner reconcile that Task's `nativeBinding.writers` to
`idle` in the workspace metadata, preserving all IDs and files, then restart.
Do not clear uncertainty merely to make a Checkpoint succeed. Unknown initial
native identity similarly requires inspection or an explicitly new Task.

Archive/restore preserves bindings, history and files. Native permanent cleanup
is rejected before deleting any directory. The UI offers archive and restore;
it does not claim that deleting a folder would erase all native history.

To disable activation, remove the two command variables and restart the Host.
Existing native Tasks remain visible but unavailable; retain their data. Roll
back only to a build that understands engine metadata. Do not run an older
Pi-only Host against native Task records.

## Reproducible checks

From fresh clones of both repositories, with Node 22.19 or later and Git:

```sh
npm ci
npm run check
```

Agent tests run executable protocol fixtures through authenticated Host HTTP/WS
and real temporary Git repositories. Server tests drive the actual browser
controller and authenticated forwarding seam. They require no provider keys.
For a live probe, create a disposable Gitea project, choose each native engine,
read a marker, write one file, inspect Diff, Checkpoint and compare local/remote
SHA. Refresh, restore native context and stop one active Task. Upload/download
matching bytes to Chat folders and archive/restore them. Keep provider usage
short and record native permission decisions and any unsupported operations.
See the [dated evidence](../reviews/native-agents-m0-m4-20260923.md).
