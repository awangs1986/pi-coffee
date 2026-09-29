# Pi package integration

The package is `pi-coffee`, pinned by a consumer to an immutable GitHub commit. Its Git `prepare` script builds TypeScript and copies prompt text, Skills, the LSP launcher. A packed distribution contains `dist`, package metadata and README; it contains no Host, Web, Relay or browser assets.

## Public interface

Import from `pi-coffee`:

- `resolvePiExtensions(env?)`: ordered individual extension paths for an embedding adapter; preserves existing opt-in and replacement settings.
- `resolvePiSkills(env?)`: bundled LSP Skill paths, with the existing override contract.
- `withCoffeeLspPath(env?)`: the child PATH overlay containing the bundled LSP launcher.
- `stopLspDaemon(sessionId, env?)`: release the owning task's LSP daemon using its existing scoped lifecycle.
- `ContextBreakdown` and `ContextCategoryId`: bounded attribution types, without a Web transport dependency.

The native Pi package manifest loads `dist/src/pi-extension.js`, which installs the same ordered extensions. Use either the manifest entry or the individual integration paths, once per Pi process. Consumer code must not import private `dist/src` implementation files.

Host owns authenticated scope, Conversation directories, sessions and lifetime. Server's Pi adapter continues to use Pi RPC; Codex and Claude adapters remain unchanged. Under [PA-014](../spec/web-search-plugin.md), this package loads the official `pi-web-access` extension directly and no longer owns a Coffee-specific search implementation. Any separate Server Relay remains Server-owned and is not the target Pi search path. Context attribution production belongs here; the Web panel and wire validation belong to Server.

## Consumer upgrade

Validate a fresh Pi clone with `npm ci && npm run check`; inspect `npm pack --dry-run --ignore-scripts --json`. Publish GitHub first, then mirror Gitea. Pin the resulting commit in the Server dependency, regenerate its lockfile and run Server checks from a fresh clone. Record both identities. Deployment is a separate Server release action.

## Extraction evidence

Baseline: Server `112ef53a0e2b04bd9d7cf283faa04754bc84c9ab`. Local checks pass 23 test files / 109 tests plus the separate package-content test. Native Pi package loading, Chat/Work RPC and LSP behavior are covered. Scripted toolchain, subagent and Web-search extension probes pass without external model calls. Server's packed-package consumer check passes 29 files / 210 tests, including a real Pi RPC reply and browser reconnect history through the installed package.

The packaging gate was red before extraction. An initial concurrent packaging check revealed that npm invokes `prepare` even for the inspected dry-run command, racing RPC tests that read the build directory. The package-content test now runs after runtime tests, preserving both checks. Source history and unmerged Gitea branches remain available; no old Host tree was used to replace Server.

Fresh-clone results and the final pair of repository identities are recorded in Pi #70 and Server #19. No production service is restarted by this source migration.

## Web extension ownership

The consumer loads the pinned official `pi-web-access/index.ts` through `resolvePiExtensions()` exactly once. Do not also autoload a separately installed global copy: use Pi's documented package resource filter (`extensions: []`) on that global entry. This keeps the package installed but disables its extension in standalone Pi too; use a separate explicit configuration when standalone Pi should own Web tools. Both legacy `PI_COFFEE_WEB=off` and `PI_COFFEE_WEB_ACCESS=off` now disable the single official integration. `/websearch` and `/curator` are native commands; the Coffee `delegate` argument and `research_seal` no longer exist.

## Native subagent migration (2026-09-28)

Install `npm:pi-subagents@0.73.1` independently through Pi. Coffee no longer
loads the upstream factory, supplies its resource directories, or rewrites its
results. The development-only pin records the tested combination with Pi 0.87.1.
See [subagent ownership and consumer migration gate](../spec/subagents-plugin.md).
Do not install a native copy into a Host profile still using the old bundled
adapter. The Server lifecycle consumer must replace `/coffee-workspace-jobs`
before deployment; package publication alone is not that deployment.

## Independent Harness package

P4 adds `packages/pi-coffee-harness`, built from the same Harness source with no optional runtimes bundled. See its [installation and public API](../../packages/pi-coffee-harness/README.md) and [SPEC](../spec/harness-native-package.md). The aggregate exports above remain for existing Host consumers until P5. Use one Harness distribution per Pi process.
