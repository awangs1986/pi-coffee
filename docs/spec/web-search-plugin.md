> Source boundary: [ADR-0021](../adr/0021-pi-only-source-authority.md). This is the accepted target design for Pi. Current implementation differences are listed below; a specification change alone is not a runtime migration.

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

The official cache is stored under the Pi configuration directory, which can be shared across Conversations. That conflicts with PA-013's per-Conversation search-evidence boundary unless the Host can isolate the official cache without changing the plugin. This is an unresolved migration gate, not an implicit exception to PA-013. Historical Coffee evidence remains in its existing location and must not be deleted by this change.

The Harness-wide large-tool-result policy remains responsible for bounded model requests, including results from official Web tools. It may archive an oversized result and return a short preview and path using the same rule as other tools, but it must not reinterpret provider ranking, invent a source index, or create a second Web API. The final provider-request budget remains a separate backstop. Neither a collapsed UI view nor an upstream cache proves that the model request is small. Measure the actual `web_search` result, stored session entry, and final model payload during acceptance.

## Implementation gap and acceptance

At this specification revision, main still loads Coffee's `web_search` and `research_seal`, suppresses the official search and curator commands, calls the official private Serper module through a Coffee transport, and automatically delegates Work research. The generic large-tool-result policy does not yet include `web_search`. The preceding local Serper smoke probe validates that old adapter path, not this target design. Do not claim the official-only migration is complete from that evidence.

Migration is complete only when:

1. Pi loads one official `pi-web-access` extension directly, with no Coffee Web search registration or registration-filter adapter. Chat and Work still show the intended tools at the intended times, with no duplicate names.
2. Native search commands work, Serper is selected by default without a per-call provider argument, and missing key, 400, timeout, and cancellation errors are reported accurately.
3. A real Pi session with `eidolon/gpt-5.6-terra` independently discovers/activates Web in Work and calls the official tool; Chat calls it directly. Any subagent use is an independent model choice.
4. Multi-query and long-result probes quantify tool content, session history, upstream cache, and final model payload. The generic large-result guard and final budget prevent an oversized request without a search-specific adapter. Verify official cache ownership across two Conversations. If context or cache isolation cannot meet the accepted boundaries, report the gap instead of claiming the prior pointer-only contract.
5. `npm run check`, the packed-package consumer probe, and a fresh-clone check pass. The Server consumer revision and each deployed VM are verified separately; a Pi repository commit is not a Host deployment.
