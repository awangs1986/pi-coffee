> Source boundary: [ADR-0021](../adr/0021-pi-only-source-authority.md). This package owns Pi search behavior; Host/Web integration belongs to the Server consumer. Historical branch evidence does not certify current main.

# Web search: bounded context and local evidence

This specification supersedes the earlier Relay-only Serper design. The owner chose the official `pi-web-access` Serper implementation as the default search provider. PI Coffee retains its `web_search` tool and evidence adapter because the upstream tool writes complete search results into Pi history, contrary to the bounded-context contract. The official package is pinned in `package.json`; Coffee calls its `searchWithSerper` provider without copying its request implementation.

## Search and credential boundary

`web_search` and `/websearch` use Serper on the User VM. The official package reads `serperApiKey` from `web-search.json` or `SERPER_API_KEY` from the process environment. Its configuration path is `$PI_CODING_AGENT_DIR/web-search.json` when that variable is set, otherwise `$XDG_CONFIG_HOME/pi/web-search.json` or `~/.pi/web-search.json`. Set `searchProvider` to `serper` for the official package's other search surfaces. Keep the configuration file outside Git with mode 0600. Do not put the key in prompts, tool arguments, research files, session history, logs, or Issues.

Coffee filters the official extension's `web_search`, `/websearch`, and `/curator` registrations so searches initiated through the Coffee harness cannot bypass evidence limits. Other opt-in upstream content/source tools remain available under the capability policy. Search errors are reported; Coffee does not silently switch provider or account.

The prior `PI_COFFEE_SEARCH_URL`, `PI_COFFEE_RELAY_TOKEN`, and Relay-only `PI_COFFEE_SERPER_KEY` search path is no longer used by this Pi adapter. Server deployments that still expose a Relay route must reconcile that separate surface before treating the earlier Relay acceptance criteria as complete. Model authentication and Serper authentication remain separate.

## Evidence and context contract

1. Before a successful tool return, save the bounded source list, URLs, and snippets to the owning Conversation Workspace's `research/` Markdown evidence file (Project Workspace: `.pi-coffee/research/`). Directories use 0700 and files 0600. Evidence is not loaded into model context automatically.
2. Return only a short ranked brief, selected source index, artifact path, and metadata. Tool text is limited to 4096 characters. Complete search results never enter the current turn first.
3. Select the first three distinct URLs in provider order and retain short snippets. Ranking is a heuristic, not verification; open primary sources before making consequential claims. An overlong URL is referenced through the evidence file rather than truncated into a broken link.
4. Save immediately rather than waiting for `agent_end`, so cancellation or a later turn cannot leave complete search results in history. Failed disk writes fail the tool; they do not fall back to returning raw results.
5. `research_seal` may add a verified conclusion of at most 2400 characters to a new evidence file and update the context projection for an existing response ID. It should cite selected sources without repeating the source table.
6. Old sessions receive a compatible context projection. Existing JSONL is not destructively rewritten. A user-requested read of an entire evidence file can still reintroduce its contents, so source reading should stay targeted.

## Chat and Work

Chat keeps `web_search` visible and searches directly, even if `delegate=true`. Work activates Web on demand and delegates research to a native child by default; `delegate=false` searches directly. A child cannot delegate recursively. A failed delegation is reported without silently repeating the search in the parent. Chat receives neither Work-only system instructions nor subagent tools.

`fetch_content`, `source_check`, and `get_search_content` remain optional official web-access capabilities. The upstream cache used by `get_search_content` is distinct from Coffee's local Serper evidence artifact. Fetching a known URL and reading a local artifact have separate purposes.

`PI_COFFEE_WEB`, `PI_COFFEE_WEB_ACCESS`, and `PI_COFFEE_WEB_SUBAGENT_AGENT` still control Coffee's extension and delegation behavior. `PI_COFFEE_RESEARCH_DIR` is only for compatibility with old sessions lacking a Workspace; a registered Conversation must resolve its own `research/` directory as specified in the [Conversation Workspace contract](https://github.com/awangs1986/pi-coffee-server/blob/112ef53a0e2b04bd9d7cf283faa04754bc84c9ab/docs/spec/conversation-workspaces.md).

## Acceptance

The search adapter and Pi RPC tests cover the official provider boundary, source filtering, Chat/Work behavior, immediate evidence persistence, short context projection, and failure semantics. `npm run check` validates the package. A real model probe must separately show that the model chooses `web_search`, Serper returns sources, and the tool result/session retain only a brief and evidence pointer. A fixture probe does not establish live credential validity. Cross-Conversation workspace isolation remains a separate PA-013 acceptance item.
