# PI Coffee source and release authority

GitHub `awangs1986/pi-coffee-server` is the authoritative repository. This repository contains Browser, Web gateway, Relay, Host and native Agent adapters. Gitea `awangs/pi-coffee-server` mirrors the same commits. The former Gitea `pi-coffee` runtime repository and Picode/V5 are historical references.

## Before changes, merges or deployment

1. Read [docs/index.md](docs/index.md), [BACKLOG.md](BACKLOG.md), and the linked Issue for the affected feature.
2. Fetch GitHub and Gitea. Compare commits and feature coverage before reconciling divergent histories. Preserve work on both sides; use normal merge ancestry and never replace a newer capability with an older tree.
3. Read [the unification decision](docs/adr/0020-unified-github-authority.md) when choosing repository boundaries, resolving contradictory older docs, or deploying. Host remains in this repository by the owner's explicit decision.
4. Work from current GitHub main in a clean checkout. Preserve other local branches and uncommitted work.

## Implementation and release

- Keep native Pi/Codex/Claude details behind Agent interfaces. Web authenticates and forwards; Host owns execution and durable task data.
- Select the authenticated user's scope for every HTTP and WebSocket operation. Browser disconnects preserve running sessions.
- Use the red → green loop at public HTTP/WS and browser-controller seams. Run `npm run check`.
- Preserve the acceptance matrix in [the reconciliation report](docs/reviews/repository-unification-20260927.md): a model reply alone does not verify the workbench.
- Push GitHub main first, then fast-forward Gitea main to the identical commit. Fetch and verify both remote SHAs. Deploy from that commit and record the release identity and served asset probe.
- Keep credentials, cookies, snapshots and user transcripts out of commits and Issues.
- Record scope, failures and acceptance evidence in the corresponding Issue. A release is complete only when a fresh clone passes the documented check and the deployed application passes the relevant UI/API probe.
