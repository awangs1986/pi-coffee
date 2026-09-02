# PI Coffee MVP specification

## Goal

Prove one complete conversation path with the original Pi agent:

```text
Browser → Web Server → Host → original Pi RPC process → streamed Events → Browser
```

The MVP is a transport and ownership proof, not a feature port from V5.

## Included

- Separate Host and Web Server modules/processes.
- A versioned JSON WebSocket frame contract.
- New and resumed in-process Sessions.
- Text prompt and abort commands.
- Pi `message_update`/`text_delta` streaming to the browser.
- Browser disconnect without calling `PiSession.stop()`.
- Bounded cursor replay after reconnect.
- Native Pi session ID propagation with `--session-id`.
- A plain browser shell and local health endpoints.

## Not included

Gitea OAuth, central LLM Relay, multi-user routing, Deployment Skill, VM lifecycle management, V5 Guard/Worktree code, task orchestration, durable Control Plane context, file uploads, and image UI.

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

## Known gaps before calling it deployed

The current local baseline is not yet present on the remote main branch, and the real CPA/central credential path has not been wired. Host-process restart recovery, authentication, VM systemd units, and upload/image handling belong to 0.1.
