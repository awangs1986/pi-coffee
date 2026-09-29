# Coffee integration reference

The `reference/` tree preserves complete selected source files from Coffee commit
`03ba7ea83e49cf94fab8a2ed317863b0f27be2ad`. Every copied file has a SHA-256 entry
in [provenance.json](../../provenance.json). No file is modified during import.

| Source | Role |
| --- | --- |
| `src/context/handoff-extension.ts` | Work-only candidate commands, source selection, model synthesis and pressure signal |
| `src/host/pi-segments.ts` | Durable binding, settlement, successor installation, input invalidation and aggregated history |
| `src/host/pi-adapter.ts` | Pi RPC opening/resume, binding recovery, explicit main identity and candidate wiring |
| `src/host/agent-adapter.ts`, `src/shared/protocol.ts` | Existing Coffee Host interfaces and protocol types |
| `src/harness/runtime-mode.ts`, `src/harness/mode.ts` | Work/Chat and main/child identity contracts |
| `src/pi-extensions.ts` | Extension registration and default-off candidate activation |
| `src/context/extension.ts` | Current read-only legacy context-fold adapter; no active folding |
| `src/context/policy.ts` | Existing ingress/request guards, kept as an integration constraint |
| `test/handoff-rollover.test.ts` | Existing P7 real-Pi/local-provider scripted lifecycle tests |

Packet/resolver and CLI sources live in the runnable top-level `src/context/`
directory, also unchanged from Coffee. This snapshot is not a complete Coffee
runtime: relative dependencies such as Harness and search/subagent implementations
are intentionally not duplicated. Build and test the Host integration in the
original pinned Coffee checkout, following its maintained instructions.

The root `npm run check` excludes this reference tree. Do not count its tests as
executed by the extracted package. Its role is to retain the implemented P7 code
and integration contract for the next extraction/integration stage, without
copying the entire Agent Runtime into a new project.

Coffee does not yet import the top-level package. A future migration must update
its dependency and loading paths deliberately, preserve existing packets and
bindings, and validate the public Host seam before deployment.
