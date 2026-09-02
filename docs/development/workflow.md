# PI Coffee development workflow

## Start

```bash
git clone http://testpc:3000/awangs/pi-coffee.git
cd pi-coffee
npm install
npm run check
```

If the remote is still empty, use the handoff attachment or ask the repository owner to push the local baseline before beginning implementation.

## Choose work

Read the relevant Gitea Issue first. The current MVP Issues are [#1–#5](http://testpc:3000/awangs/pi-coffee/issues). The 0.1 contract is [`docs/spec/0.1.md`](../spec/0.1.md). Keep one active ticket per change and post evidence before closing it.

## Code seams

- `src/shared/protocol.ts`: versioned Frame codec and limits.
- `src/host/pi-adapter.ts`: only Pi-specific adapter seam.
- `src/host/session.ts`: Session ownership, cursor, and replay.
- `src/host/server.ts`: private Host transport.
- `src/web/host-client.ts`: Web → Host transport adapter.
- `src/web/server.ts`: browser Bridge and static shell.

Tests should cross these public seams. Prefer a fake adapter or local stub over a real credential in CI.

## Change loop

1. Write one failing behavior test at the seam.
2. Implement the smallest vertical slice.
3. Run `npm run check`.
4. Update the relevant specification only if the decision changed.
5. Comment the evidence, commit, and update the Gitea Issue.

## Scope guardrails

Keep this repository independent. V5 is a frozen reference, not a dependency or a patch target. Do not add sandbox/permission machinery to compensate for VM isolation. Do not put secrets, full transcripts, image bodies, or VM credentials into docs or tickets.
