# The agent seam admits Codex CLI (app-server) next to Pi

Status: accepted (owner decision, 2026-09-27)

## Context

The two internal users only ever touch the web page; the VM admin manages the model
account(s) on the shared User VM (ADR-0010). The admin has both a subscription login and an
API key, and wants the same web page to drive **Codex CLI** logged in once on the VM, with
each user keeping their own separate sessions. Nothing about the Browser Shell, the Web
Server, or the Host session lifetime depends on Pi specifically: they depend on
`PiSessionFactory` / `PiSession` and on the event vocabulary the browser already renders.

## Decision

- **Codex is a second implementation of the existing seam, not a second product.**
  `src/host/codex-adapter.ts` implements `PiSessionFactory`/`PiSession` on top of
  `codex app-server` (JSON-RPC over stdio). The Host, Web Server, browser, protocol codec and
  per-user registries are unchanged; `PI_COFFEE_AGENT=codex` picks the factory in `main.ts`.
- **One `codex app-server` process per user, sharing one `CODEX_HOME`.** The admin logs
  Codex in once (`codex login` or an API key in `CODEX_HOME`). Each Gitea user gets their own
  app-server child, started in `<WORKDIR>/<user>`, so a crash or stall for one user never
  reaches the other; every child reads the same credentials and writes rollouts to the same
  `CODEX_HOME/sessions`. Sessions of user A are listed only from A's cwd (`thread/list {cwd}`)
  and the Host still keys everything by login name, so the other user's threads stay out of
  sight exactly as with Pi. **No occupancy lock or turn-taking gate is added**: the two
  users' sessions run concurrently against the one login.
- **Codex thread ids are the session ids.** Codex mints UUIDv7 thread ids itself; a
  PI Coffee session id that predates its thread is remembered in
  `<cwd>/.pi-coffee/codex-threads.json` and every later call (resume, rename, delete, list)
  is translated through that file. Codex's own rollout files remain the durable conversation
  store (ADR-0008); nothing is copied to the Web Server.
- **Event translation is one-way and lossy on purpose.** `turn/started`→`agent_start`,
  `item/agentMessage/delta`→`text_delta`, reasoning deltas→`thinking_delta`,
  `commandExecution`/`fileChange`/`mcpToolCall`/`webSearch` items→`tool_execution_start/end`
  with Pi tool names (`bash`, `edit`, …) so the existing renderers apply, `turn/completed`→
  `agent_settled` (a `failed` turn also emits an assistant `message_end` with `stopReason:
  "error"`). Codex features without a browser affordance (plans, compaction) are surfaced
  as notes or ignored.
- **Approvals reuse the extension dialog.** With `PI_COFFEE_CODEX_APPROVAL=on-request` or
  `untrusted`, Codex's `item/*/requestApproval` server requests become
  `extension_ui_request{method:"confirm"}`; the browser's answer maps to
  `accept`/`decline`. The default (`never`, with `danger-full-access`) mirrors Pi's
  Execution Seam in the isolated VM (ADR-0005). Steer/follow-up/abort map to
  `turn/steer`, a Host-side queue flushed on `turn/completed`, and `turn/interrupt`.
- **Model selection is Codex's catalog.** `model/list` is exposed under provider `codex`;
  `PI_COFFEE_MODEL` and `PI_COFFEE_CODEX_EFFORT` set the defaults per turn. The Relay is not
  used when Codex is the agent: Codex talks to OpenAI with the VM's login.

## Consequences

- The Host now depends on a second CLI at runtime (`PI_COFFEE_CODEX_BIN`, default `codex`
  on PATH). Admin login, config.toml, MCP servers and skills are Codex's own and live in
  `CODEX_HOME`, shared by the two users.
- The Pi-only surfaces (`getCommands`, `getExtensions`, `/`-commands, the bundled V5
  harness and pi-subagents) are empty under Codex. The browser hides what is empty.
- A brand-new Codex thread is only persisted after its first turn; opening and abandoning
  an empty session under Codex leaves nothing behind and is not listed (Pi lists it).
- Testing follows the fake-Pi pattern: `test/fixtures/fake-codex-app-server.mjs` speaks the
  JSON-RPC subset the adapter uses and `test/codex-adapter.test.ts` proves the seam
  (create/list/resume across processes, cwd isolation, tool and error translation, approval
  round-trip, abort/follow-up, rename/models/stats/delete, history projection).
