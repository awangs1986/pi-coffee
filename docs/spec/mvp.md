# PI Coffee MVP specification

## Goal

Prove one complete conversation path with the original Pi agent, deployed in
the shape the product will keep — **Pi agent in the user's VM, server-side Web
Server and LLM Relay on the server**:

```text
Browser → Web Server (server) → Host (User VM) → original Pi RPC process → streamed Events → Browser
                                     └→ LLM Relay (server, sole upstream key) → CPA
```

The MVP is a transport and ownership proof, not a feature port from V5.

## Deployment shape (owner decision, 2026-09-02)

| Where | What |
|---|---|
| User VM (one per user, Linux Mint Xfce) | Agent Host + original Pi 0.84.4, running as the VM owner. Holds the Host token and its Relay token; **no upstream key**. |
| Server (Debian) | Web Server (browser entry, bridges to the Host) and LLM Relay (the only process with the upstream key). |

A single-machine `npm start` remains the developer smoke, not the MVP
deliverable. Hand-installed systemd units for both machines are in
[`deploy/`](../../deploy/README.md); the procedure is in the
[runbook](../deployment/runbook.md).

## Included

- Separate Relay, Host and Web Server processes with their own secrets.
- A versioned JSON WebSocket frame contract.
- New and resumed in-process Sessions.
- Text prompt and abort commands.
- Pi `message_update`/`text_delta` streaming to the browser.
- Browser disconnect without calling `PiSession.stop()`.
- Bounded cursor replay after reconnect.
- Native Pi session ID propagation with `--session-id`.
- A transparent LLM Relay: Chat Completions and Responses JSON/SSE pass-through,
  `/v1/models`, `/v1/responses/compact`, token swap at the seam, bounded
  content-free metadata (`CP-001`).
- A Codex-style light-theme browser shell (see below) and health endpoints.
- systemd unit and env templates for the server and the User VM.

## Not included

Gitea OAuth and multi-user routing (one Web Server bridges to one User VM in
the MVP), the idempotent Deployment Skill with enrollment, VM lifecycle
management, V5 Guard/permission/snapshot enforcement, task orchestration,
durable Control Plane context, file uploads, image UI, and Host-restart session
recovery. The bundled PI Coffee Harness extension is an add-on to the Host;
its native Git/verify behavior is documented separately and does not revive
those V5 controls.

## Evidence in this checkout

- Protocol seam: [`test/protocol.test.ts`](../../test/protocol.test.ts)
- Host seam and disconnect replay: [`test/host-server.test.ts`](../../test/host-server.test.ts)
- Web bridge and replay: [`test/web-server.test.ts`](../../test/web-server.test.ts)
- Original RPC adapter: [`test/pi-adapter.test.ts`](../../test/pi-adapter.test.ts)
- Full browser → Host → Pi RPC path: [`test/mvp-e2e.test.ts`](../../test/mvp-e2e.test.ts)

Run:

```bash
npm install
npm run check
npm start
```

The tests use a fake RPC process so no credential is needed. A real run additionally needs the normal Pi provider/model configuration in the Host environment. The current adapter is pinned to `@earendil-works/pi-coding-agent@0.84.4`.

## MVP completion criterion for a colleague

From a fresh clone, the colleague can install dependencies, get a green `npm run check`, start `npm start`, open the served page, and reproduce a real or local-mock streamed reply without editing V5 or placing a secret in the repository.

## Real-model evidence

`scripts/smoke-real-model.mjs` drives the browser protocol against a running
stack whose Host has a real provider (the CPA relay via Pi's `models.json`, see
the runbook) and asserts: streamed `text_delta` through `agent_settled`,
strictly increasing cursors, exact bounded replay after a browser disconnect,
zero replay when caught up, and a second turn on the same Session. Its JSON
output is the acceptance evidence for [#5](http://testpc:3000/awangs/pi-coffee/issues/5).

## Browser shell

`public/` is a dependency-free static shell (`index.html`, `app.css`, `app.js`)
served by the Web Server from an allow-list of flat file names. It follows the
familiar Codex layout in a white theme:

- Left sidebar: "新对话", the list of conversations known to this browser, and
  the connection state. Selecting a conversation reopens that Host Session.
- Main column: user messages as light bubbles, assistant text rendered with a
  minimal escaped Markdown subset (fenced code, inline code, bold), tool
  executions as collapsible cards (`tool name`, argument summary, running /
  完成 / 失败, result), and notes for model errors, auto-retry and
  `resync_required`.
- Composer: rounded card, Enter sends, Shift+Enter inserts a newline. While the
  Host reports `isStreaming` the send button becomes a stop button that sends
  `abort`.

The shell keeps a bounded per-conversation display cache in `localStorage`
(last 120 entries, 30 conversations). This is a rendering convenience only:
the Host owns Session state, reconnects use `sessionId` + `after=cursor`, and
removing a conversation from the sidebar does not touch the Host. Durable
history that survives a new browser belongs to 0.1 `SHELL-001` (#10).

## Relay evidence

`test/relay-server.test.ts` covers, against an in-process stub upstream: token
swap and header stripping, JSON and SSE pass-through, chunk-by-chunk streaming
(the first SSE chunk reaches the client while the upstream still holds the
second), upstream error status pass-through, 502 on unreachable upstream, 504
on header timeout, broken upstream stream → broken client connection (never a
clean end), client disconnect → upstream abort, 413 on oversized bodies,
backpressure propagation from a slow client, and content-free metadata.
Real-model runs through the Relay (Host without upstream key) were reproduced
for `openai-completions`, `openai-responses`, a tool call and an image prompt;
evidence is on [#7](http://testpc:3000/awangs/pi-coffee/issues/7).

## Known gaps before calling it deployed

One Web Server bridges to exactly one User VM Host; per-user routing arrives
with Gitea OAuth (`ID-001`). Host-process restart recovery (`REC-001`), the
Deployment Skill (`DEP-001`), and upload/image handling belong to 0.1.
