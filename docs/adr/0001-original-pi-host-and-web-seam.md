# Original Pi Agent behind a separate Host and Web Server seam

Status: accepted

PI Coffee starts as an independent application that consumes the published original `@earendil-works/pi-coding-agent` package through its documented RPC client. A Host owns each long-lived Pi Session, while a Web Server only serves the browser and relays versioned conversation Frames. This keeps the MVP small and makes the Pi adapter replaceable without coupling the browser to Pi internals; browser disconnects therefore detach a Bridge but do not stop a Session. V5 features are deliberately not migrated until this seam is proven.

## Considered options

- Forking or modifying the V5 repository first: rejected because it would mix an unproven transport with the frozen V5 baseline.
- Letting the Web Server instantiate Pi directly: rejected because browser connection lifetime would become session lifetime and a later split into User VMs would be expensive.
- Spawning the original Pi RPC process behind the Host: accepted because it preserves the upstream runtime and gives the Host a narrow, testable adapter.

Native-engine scope update (2026-09-23): [ADR-0013](./0013-native-agent-engines.md) extends the Host to Codex and Claude Code while preserving Pi behavior. Its explicit authentication, native-permission, history and repository boundaries govern that planned extension; this earlier Pi-specific decision does not imply native-engine support is already implemented.
