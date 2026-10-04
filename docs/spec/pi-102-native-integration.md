# Native Pi 1.0.2 integration

Tracking: [Pi #9](https://github.com/awangs1986/pi-coffee/issues/9).
This updates the version selection in [the Pi 1.0 contract](pi-100-native-integration.md).
The source map and independent package/release boundaries remain unchanged.

| Component | Selected version | Upgrade policy |
| --- | --- | --- |
| Official Pi coding-agent / agent-core / ai / tui | 1.0.2 | Native npm release; consumer lockfiles pin transitive dependencies |
| Official pi-subagents | npm 0.75.0 | Includes the upstream Pi 1.0 background-child fix; replaces unreleased Git snapshot |
| Official pi-web-access | 0.35.0 | Current official release; preserve original schemas and activation |
| Optional official pi-antigravity | 0.9.0 | Current official release; preserve native account/model configuration |
| Coffee Harness | 0.3.1 | Preserve 0.3.0 read-only Git and public optional-plugin integration |
| Coffee LSP | 0.4.6 | Semantic tool, automatic diagnostics, CLI/Skill and lifecycle |
| Context Handoff | 0.2.0-experimental.5 | Explicit same-session experimental Handoff |
| typebox | 1.3.34 | Current shared schema release |

## Native changes

Pi 1.0.2 adds optional `samplingParamsByThinkingLevel` to native model configuration.
Coffee preserves existing model/provider/thinking defaults; no automatic sampling
overrides are introduced. Pi 1.0.1 removed its published npm shrinkwrap and fixed
the old brace-expansion advisory with 5.0.12. Each consumer must retain a lockfile
and inspect its actual dependency audit instead of assuming the upstream release
alone establishes a clean graph. Existing MCP/codemode policy remains unchanged.

## Official delegation

Use official npm 0.75.0 when native tests pass. Its release includes the former
`10694a6` background-child fix, so an unreleased source archive is no longer needed.
Preserve upstream auto/dynamic/eager modes, loaders/executors and fleet status.
Verify a real child reports Pi 1.0.2, then test cancellation/settlement; a successful
plugin import does not verify child compatibility. Upstream external runners and
its new background-command controls are not additional Coffee tools or grants.

## Language servers

Upgrade bundled TypeScript language server to 5.3.0 and Pyright to 1.1.414.
These are official releases compatible with the existing Node >=22.19 contract.
TLS 6.0.1 requires Node >=22.22.2 and is outside that minimum; do not silently
raise the package engine floor. Verify actual installed TypeScript diagnostics,
repair, symbols, repeated saves and daemon shutdown after the server upgrade.
Configurable C#, C/C++, Rust, Go and other servers remain external prerequisites;
this upgrade does not claim fresh acceptance of every executable/platform.
Lens remains uninstalled; Coffee LSP is the supported provider.

## Preserved behavior and acceptance

Chat/Work, 272K/500K context presets, bounded Web/delegation evidence with durable
pointers, native automatic compaction and explicit experimental Handoff remain
unchanged. No automatic cadence, continuation, transcript migration or semantic
fidelity claim is introduced. Official Web stays on dynamic activation, synchronous
retrieval, 6,000-character slices and workflow=none.

Run `npm ci && npm run bootstrap`, `npm run check` and `npm run pack:plugins`.
The installed-package matrix covers Pi 0.99.1, 1.0.0 and 1.0.2 with official npm
plugins, both load orders, activation modes, restoration and Chat isolation.
Publish separate immutable artifacts and mirrored source identities. Host/Web
consumption, fresh-clone checks and live activation remain separate acceptance;
preserve private accounts, project folders and previous artifacts for rollback.
Native model autonomy and semantic-drift evaluations remain separate work.
