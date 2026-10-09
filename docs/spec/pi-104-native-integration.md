# Native Pi 1.0.4 integration

Tracking: [Pi #11](https://github.com/awangs1986/pi-coffee/issues/11),
[Server #67](https://github.com/awangs1986/pi-coffee-server/issues/67).
This selects a new tested combination under the existing [Pi 1.0 contract](pi-100-native-integration.md).

| Component | Selected version | Selection |
| --- | --- | --- |
| Official coding-agent / agent-core / ai / tui | 1.0.4 | Exact native npm releases and consumer lockfiles |
| Official pi-subagents | 0.76.1 | Upstream release; public activation, child runtime and settlement |
| Official pi-web-access | 0.37.0 | Upstream release; unchanged original tool schemas |
| Optional official pi-antigravity | 0.9.0 | Latest official release; native credentials and model catalog |
| Coffee Harness | 0.3.3 | Chat/Work, registered opt-in Chat tools, bounded evidence |
| Coffee LSP | 0.4.7 | Semantic queries, automatic diagnostics, CLI/Skill, lifecycle |
| Context Handoff | 0.2.0-experimental.6 | Explicit same-session invocation; native automatic compaction |
| Independent MISHU | 0.1.7 | Existing opted-in Chat coordination; Gitea source exception |
| typebox | 1.3.36 | Shared public schema package |
| TypeScript language server / Pyright | 5.3.0 / 1.1.414 | Latest official releases compatible with Node >=22.19 |

## Native changes and boundaries

Pi 1.0.4 supports wildcard tool selection and `--no-mcp`, fixes hidden-tool prompt
guidance, and improves native MCP shutdown and codemode image handling. Coffee
continues using native public package roots and active-tool selection. New flags
do not enable MCP, codemode or additional Coffee tools. Preserve hidden-tool
boundaries, both extension load orders, upstream eager/auto/dynamic activation,
Chat's zero-system behavior and MISHU's independent authorization checks.

Pi 1.0.3 renames provider `azure-openai-responses` to `azure`. Native configuration
preparation belongs to Server and must back up auth, models and settings before
renaming provider references. The `azure-openai-responses` API identifier and
`AZURE_OPENAI_*` environment names stay unchanged. Conflicting old/new entries
must fail visibly without changing configuration. Existing native sessions keep
their original history; Pi documents a model fallback and lost prompt cache when
resuming sessions carrying the old provider. Do not rewrite transcripts to hide it.

Native sampling, model/thinking defaults, 272K/500K presets, evidence retention,
read-only Git and manual experimental Handoff remain unchanged. Official Web uses
dynamic activation, synchronous workflow=none and 6,000-character retrieval
slices. Large web/delegation results retain bounded excerpts and original-evidence
pointers; failed or empty searches do not create new Coffee research artifacts.

No installed language-server prerequisite is implied for C#, C/C++, Rust, Go or
other external servers. TypeScript language server 6.0.1 requires Node >=22.22.2;
retain 5.3.0 under the existing Node >=22.19 contract. Lens stays retired.

## Acceptance and delivery

Run `npm ci && npm run bootstrap`, `npm run check` and `npm run pack:plugins`.
Retain installed-package coverage on Pi 0.99.1, 1.0.0 and 1.0.2 with their reviewed
upstream combination; add Pi 1.0.4 with current official Web/subagents. Validate
real background-child version, cancellation/settlement, mode restoration,
registered Chat tools, automatic LSP diagnostics and daemon release. Run the
current Server/MISHU native HTTP/RPC fixtures, including Handoff and reconnect.
Use official patched source-map-js 1.2.2 to remove the inherited advisory and
audit the actual lock graphs.

Build independent immutable package artifacts and verify fresh-clone installation
and source/checksum identity. Deliver PRs; the owner merges and publishes plugin
artifacts before merging consumers with those immutable URLs. Candidate cache
verification is not public release availability. Production deployment, real-model
autonomy and semantic-fidelity evaluations remain separate acceptance.
