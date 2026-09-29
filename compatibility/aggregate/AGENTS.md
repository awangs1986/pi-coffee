# PI Coffee — Pi-only source authority

GitHub `awangs1986/pi-coffee` owns the Pi harness, prompts, tools, LSP, subagents, context extensions and Skills. Gitea `awangs/pi-coffee` mirrors the same main commit. Host, Browser, gateway, Relay and native Agent adapters belong to `awangs1986/pi-coffee-server`.

## Before changes

1. Read `docs/index.md`, `BACKLOG.md` and the affected Gitea Issue.
2. For repository placement or consumer integration, read `docs/adr/0021-pi-only-source-authority.md` and `docs/development/package-integration.md`.
3. Fetch both remotes and work from current GitHub main in a clean checkout. Preserve other branches and uncommitted work; compare divergent capabilities before merging.

## Implementation and publication

- Keep Pi upstream unmodified. Consumers use the public package interface; execution transport and durable task ownership stay in the Server repository.
- Use Chat/Work terminology and preserve context/evidence limits. Context redesigns require their own acceptance evidence.
- Use red → green at the Pi RPC, CLI or package-consumer seam. Run `npm run check`; validate a fresh clone and the packed artifact before publishing a package change.
- Keep credentials, snapshots and user transcripts out of source and Issues.
- Push GitHub main first, then fast-forward Gitea main and verify equal SHAs. Record failures, checks and the source identity in the Issue.
- A package publication does not deploy Host or Web. Consumer upgrades and deployment evidence belong to `pi-coffee-server`.
