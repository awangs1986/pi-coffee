# OMP LSP source provenance

Upstream: https://github.com/can1357/oh-my-pi (MIT).
Current comparison/port pin: `b1a8b875cf81ec2fdc3cc397a2d4b6a9a777543d`.
Initial extraction pin: `3d3ec7e907acfd74d650f6fd632e98d7a820ff66`.
Copyright and permission notice: [LICENSE](./LICENSE). Both this notice and the
license ship under `dist/third_party/oh-my-pi`.

Paths below are relative to the pinned upstream repository.

| Local file | Upstream source | Adaptation |
| --- | --- | --- |
| `src/lsp/message-framing.ts` | `packages/coding-agent/src/jsonrpc/message-framing.ts` | Copied decoder; 16 MiB frame bound; initial pin |
| `src/lsp/uri.ts` | `packages/coding-agent/src/lsp/utils.ts`, URI helpers and `EquivalentUriMap` | Extracted helpers; Node URL APIs replace Bun; no TUI imports |
| `src/lsp/diagnostics.ts` | `packages/coding-agent/src/lsp/diagnostics.ts`, `waitForDiagnostics` and its helpers | Extracted polling, settle window, cold empty-report guard and pull failure distinction; Node timers and a small client interface |
| `src/lsp/client.ts` | `packages/coding-agent/src/lsp/client.ts` | Adapted persistent diagnostics, disk reconciliation, dynamic capabilities, ordered bounded writes, request-local cancellation and bounded process shutdown to Node streams |
| `src/lsp/daemon.ts` | `packages/coding-agent/src/lsp/client.ts`; shutdown guard in `packages/coding-agent/src/lsp/mux/server.ts` | Adapted configuration retirement, initialization backoff and shutdown guard inside Coffee's existing daemon; no mux/broker port |
| `src/lsp/registry.ts` | `packages/coding-agent/src/lsp/defaults.json` (blob `569e8cb5`, upstream `5a6e431aa0ca0b49f28eeb7c1f8558b86c06d25a`) and `packages/coding-agent/src/lsp/config.ts` | Built-in server table (commands, file types, root markers, linter flags, selected settings) transcribed and extended (csharp-ls, typescript-native selection, install hints, `npm` ids); config merge order, `hasRootMarkers` glob, project-local executable search and `$PID`-style substitution re-implemented for Coffee's single-server-per-file model; tlaplus/pylsp/ty/expert/rubocop/phpactor/helm_ls/nil/vim/emmet/swiftlint omitted |
| `src/lsp/profiles.ts` | `packages/coding-agent/src/lsp/config.ts` (`getServersForFile`, `selectTypescriptServer`, `resolveCommand`) | Server selection over the registry: language servers before linters, root markers, TypeScript 5 vs 7 flavour; Coffee retains csharp-ls, env overrides and project-owned settings |
| `test/lsp-port.test.ts`, `test/lsp-cli.test.ts` | `packages/coding-agent/test/tools/lsp-regressions.test.ts`, `lsp-diagnostics-freshness.test.ts`; `packages/coding-agent/test/lsp/idle.test.ts` | Independent public CLI regressions for equivalent failure classes; upstream tests were not copied verbatim |

Coffee-specific adaptations preserve its saved-file, read-only Skill → CLI
contract, Unicode positions, JSON/coverage limits and task ownership. No report
means `inconclusive`, including known stale versions. A new complete diagnostic pull
must complete instead of returning a cached report for the same document version.
The operation budget includes daemon startup/queue time. Batch timeouts retain
already-confirmed findings. Rust uses push diagnostics and save-triggered checks;
OMP's disabled check-on-save defaults are intentionally not imported.

No OMP runtime package, Agent, TUI, model tool framework, context policy, mux
architecture, formatting or editor mutation machinery is introduced. Pi remains
unmodified at 0.87.1. Coffee's snapshot scanning and external CLI transport are
local integration code, not a claim of verbatim upstream provenance.
