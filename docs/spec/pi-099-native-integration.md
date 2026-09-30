# Native Pi 0.99 integration

Status: P0–P9 candidate for Gitea review. Production rollout is a separate P10.

## Composition and responsibility

| Component | Selected release | Responsibility |
| --- | --- | --- |
| Official Pi family | 0.99.1 | RPC, sessions, native automatic compaction, package discovery |
| Harness | 0.2.0-rc.1 | Chat/Work, prompt, Git, readiness/trust, result budgets and public work-state bridge |
| Official community pi-web-access | 0.34.0 | Serper/providers, search, native cache and content retrieval |
| Official community pi-subagents | 0.73.1 | Native schemas, launch, cancellation, scheduling and fleet status |
| Coffee LSP | 0.4.4, unchanged | Native semantic tools plus CLI/Skill and server lifecycle |
| Context Handoff | 0.2.0-experimental.3, unchanged | Explicit same-session Handoff and evidence recovery |

Server remains outside these packages. It selects immutable package roots through
Pi's public discovery interface and owns execution and Conversation lifetime.
No aggregate imports, schema rewriting, private plugin imports, MCP bridge, or
copied upstream executors are required. Historical repositories stay historical.

## Tools and bounded evidence

Work retains read/edit/write/bash/git/search_tools, with native web_enable and
subagents_enable loaders when installed. Chat keeps read/edit/write/bash and
web_search when installed, plus installed Handoff recovery tools. Mode switching
still removes disallowed tools at the outgoing model request and call boundary.
LSP remains discoverable through the existing readiness/trust catalog. Native
Pi tool_search only covers deferred/codemode exposure, so replacing the catalog
would lose required policy. No second discovery system is enabled.

Select dynamic web activation, maxInlineContentChars=6000 and workflow=none.
Preserve provider credentials and the user's provider choice. Original web tools
own responseId caching and bounded get_search_content retrieval. Reject
includeContent=true and non-none workflows: no verified upstream API reports
background web settlement. Explicit fetch_content remains available in Work.

Harness caps web/delegation text results at 8000 characters, pointer included.
Long valid text is retained under the session directory, outside the workspace,
in artifacts/<session-id> with private permissions. Read relevant ranges only.
Failures and zero-result searches do not create extra Coffee research artifacts.
This is bounded excerpt plus pointer, not automatic semantic summarization.
Native upstream diagnostic/custom session records may contain empty searches;
this release does not promise deletion of those records. Upstream cache lifetime
and durable Coffee session artifacts have separate retention: archive preserves
session evidence. Permanent deletion through the Server adapter removes the
matching session artifact directory; other sessions are untouched. Deleting a
JSONL file manually does not perform that lifecycle cleanup.

## Lifecycle and context

/coffee-workspace-jobs reads subagents:rpc:v1 status without changing upstream
execution. Active fleet/cleanup capacity or pending tool calls keep the workspace
busy; unavailable status is unknown. Handoff rechecks that state immediately
before compacting. Completed synchronous web operations and native delegates
emit the existing public settlement protocol. Actual outstanding work defers
Handoff; it is never silently converted to native compaction.

Native Pi handles automatic compaction. Manual experimental Handoff keeps its
existing journal, evidence recovery and failure semantics. No anti-drift claim
is added. The seven-category numerical observer moved from the historical
aggregate because native token totals cannot provide the UI attribution view.
It observes public events and does not replace native usage or compaction.

Old Coffee 3/5 scheduler limits are retired. Native upstream scheduling settings
are authoritative; this change does not claim equivalent concurrency limits.
The parent selects its exact Pi package root for upstream children using the
public PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT option.

## Acceptance

Harness installed-package tests cover mode restore, missing optional tools,
public status RPC, valid result retrieval, error/empty artifact exclusion and
background search rejection. The LSP suite covers semantic CLI queries,
diagnostics and cleanup; profiles remain TS/JS, Python, C#, C/C++, Rust and Go.
Missing language servers remain a reported setup state, not fabricated success.
Handoff checks cover same-session commit, native compaction, recovery and failures.
Server verifies the actual upstream child runtime, cancellation, original Serper
search/retrieval, Web/Host RPC and reconnect. All network/model test data is
synthetic; paid-provider quality and cross-language deployment checks belong to P10.
