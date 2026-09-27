# Pi package integration

The package is `pi-coffee`, pinned by a consumer to an immutable GitHub commit. Its Git `prepare` script builds TypeScript and copies prompt text, Skills, the LSP launcher and the Linux child launcher. A packed distribution contains `dist`, package metadata and README; it contains no Host, Web, Relay or browser assets.

## Public interface

Import from `pi-coffee`:

- `resolvePiExtensions(env?)`: ordered individual extension paths for an embedding adapter; preserves existing opt-in and replacement settings.
- `resolvePiSkills(env?)`: bundled LSP Skill paths, with the existing override contract.
- `withCoffeeLspPath(env?)`: the child PATH overlay containing the bundled LSP launcher.
- `stopLspDaemon(options)`: release the owning task's LSP daemon using its existing scoped lifecycle.
- `ContextBreakdown` and `ContextCategoryId`: bounded attribution types, without a Web transport dependency.

The native Pi package manifest loads `dist/src/pi-extension.js`, which installs the same ordered extensions. Use either the manifest entry or the individual integration paths, once per Pi process. Consumer code must not import private `dist/src` implementation files.

Host owns authenticated scope, Conversation directories, sessions and lifetime. Server's Pi adapter continues to use Pi RPC; Codex and Claude adapters remain unchanged. Search extension code belongs here; its network Relay belongs to Server. Context attribution production belongs here; the Web panel and wire validation belong to Server.

## Consumer upgrade

Validate a fresh Pi clone with `npm ci && npm run check`; inspect `npm pack --dry-run --ignore-scripts --json`. Publish GitHub first, then mirror Gitea. Pin the resulting commit in the Server dependency, regenerate its lockfile and run Server checks from a fresh clone. Record both identities. Deployment is a separate Server release action.

## Extraction evidence

Baseline: Server `112ef53a0e2b04bd9d7cf283faa04754bc84c9ab`. Local checks pass 23 test files / 109 tests plus the separate package-content test. Native Pi package loading, Chat/Work RPC and LSP behavior are covered. Scripted toolchain, subagent and Web-search extension probes pass without external model calls. Server's packed-package consumer check passes 29 files / 210 tests, including a real Pi RPC reply and browser reconnect history through the installed package.

The packaging gate was red before extraction. An initial concurrent packaging check revealed that npm invokes `prepare` even for the inspected dry-run command, racing RPC tests that read the build directory. The package-content test now runs after runtime tests, preserving both checks. Source history and unmerged Gitea branches remain available; no old Host tree was used to replace Server.

Fresh-clone results and the final pair of repository identities are recorded in Pi #70 and Server #19. No production service is restarted by this source migration.
