> Source boundary: [ADR-0021](../adr/0021-pi-only-source-authority.md). The source implementation now loads the official extension directly. Deployment acceptance is tracked separately in Pi #71; the owner accepted upstream cache placement.

# Web search: official pi-web-access only

## Decision

Use the pinned, unmodified official `pi-web-access` extension as the sole Pi web integration. It owns `web_search`, `fetch_content`, `source_check`, `get_search_content`, and its native commands. PI Coffee must not register another `web_search`, wrap or replace the official tool, import `serper.ts` as a private provider API, or maintain a second search result, sealing, or evidence protocol. Remove the Coffee `research_seal` tool and the adapter that suppresses official registrations. Keep ordinary Chat/Work tool visibility and the Harness-wide context budget; those are not search provider implementations.

The previous Coffee search adapter, automatic Web research delegation, and search-specific `research/` artifact contract are superseded by this decision. Historical artifacts and sessions remain readable; do not rewrite or delete them as part of migration.

## Provider and VM configuration

Serper is the default search provider, selected through official `web-search.json` configuration with `searchProvider: "serper"`. The official extension reads its key from `serperApiKey` or `SERPER_API_KEY`. Its configuration path is `$PI_CODING_AGENT_DIR/web-search.json` when that variable is set; otherwise it is `$XDG_CONFIG_HOME/pi/web-search.json` or `~/.pi/web-search.json`. Keep the file outside Git, accessible only to the VM user (0600, with a private parent directory). Do not put credentials in prompts, sessions, artifacts, logs, or Issues.

The target VM defaults are `searchProvider: "serper"`, `workflow: "none"`, and `maxInlineContentChars: 4000`. The native `workflow: "none"` avoids a browser curator approval step during an agent search. `maxInlineContentChars` bounds official fetched-content and retrieval slices; it does **not** bound `web_search` results. Explicit native `provider` arguments can override the configured default, so this is a Serper default, not a Serper-only enforcement rule. Provider errors, including account-specific query restrictions, remain visible; no Coffee fallback provider is added.

## Chat, Work, and subagents

Chat exposes the official `web_search` beside read, edit, write, and bash. It does not receive Work instructions or subagent tools. Work discovers and activates official Web tools on demand; search and content/source tools may remain separate visibility groups so unnecessary schemas stay hidden. Every exposed Web tool still comes from the one official extension. Generic capability metadata controls visibility only and must not change tool parameters or results. Native `/websearch` and `/curator` commands remain owned by the official extension.

Web search no longer delegates automatically. Work may separately activate the existing `subagent` capability and ask a child to use the official search tool when the task warrants it. The official `web_search` schema has no Coffee `delegate` argument. Chat remains direct because it has no subagent capability.

## Context and evidence boundary

Official `web_search` content is a Pi tool result and may enter session history. PI Coffee no longer promises that every search first becomes a private Markdown file or that the result always contains only a 4096-character brief and pointer. The official package's cache and `get_search_content` retrieval follow its own documented limits and lifecycle; they are not Coffee `research/` artifacts.

The owner explicitly accepted the official shared Pi configuration-directory cache on 2026-09-27 in Pi #71. This is a narrow exception to PA-013's per-Conversation search-evidence placement rule. Current-session native records govern API retrieval; the cache is not part of a Coffee task bundle. Native Agent directories are unchanged. Include the official cache/native store separately when backing up; deleting a task bundle does not promise deletion of upstream cached data. Attachments and other Coffee-owned data retain task-scoped directories. Historical Coffee evidence remains in its existing location and must not be deleted by this change.

The Harness-wide large-tool-result policy remains responsible for bounded model requests, including results from official Web tools. It may archive an oversized result and return a short preview and path using the same rule as other tools, but it must not reinterpret provider ranking, invent a source index, or create a second Web API. The final provider-request budget remains a separate backstop. Neither a collapsed UI view nor an upstream cache proves that the model request is small. Measure the actual `web_search` result, stored session entry, and final model payload during acceptance.

## Implementation gap and acceptance

The source migration removes Coffee search transport, `research_seal`, automatic search delegation, private Serper imports and registration filtering. The `web` and `web-access` capabilities now describe upstream definitions without wrapping execution. The generic large-result guard includes `web_search`; historical artifacts and native sessions are untouched. Official Serper fixture acceptance covers direct Chat/Work, explicit researcher children, multi-query and provider failure, with oversized search output absent from persisted tool results and model requests. The native extension may also append complete search data in its own custom session entries; the generic guard bounds tool-result messages and model requests, not those upstream recovery entries. These deterministic probes are not a live-model discovery evaluation. See [Pi #71](http://gitea:3000/awangs/pi-coffee/issues/71) for source/release identities and outstanding deployment gates.

Migration is complete only when:

1. Pi loads one official `pi-web-access` extension directly, with no Coffee Web search registration or registration-filter adapter. Chat and Work still show the intended tools at the intended times, with no duplicate names.
2. Native search commands work, Serper is selected by default without a per-call provider argument, and missing key, 400, timeout, and cancellation errors are reported accurately.
3. A real Pi session with `eidolon/gpt-5.6-terra` independently discovers/activates Web in Work and calls the official tool; Chat calls it directly. Any subagent use is an independent model choice.
4. Multi-query and long-result probes quantify tool content, session history, upstream cache, and final model payload. The generic large-result guard and final budget prevent an oversized request without a search-specific adapter. Verify native retrieval uses the current session and document the accepted shared filesystem cache. If context or cache isolation cannot meet the accepted boundaries, report the gap instead of claiming the prior pointer-only contract.
5. `npm run check`, the packed-package consumer probe, and a fresh-clone check pass. The Server consumer revision and each deployed VM are verified separately; a Pi repository commit is not a Host deployment.
