# Final prompt acceptance — 2026-09-29

Scope: [Issue #1](https://github.com/awangs1986/pi-coffee-harness/issues/1),
[PR #2](https://github.com/awangs1986/pi-coffee-harness/pull/2).
The deliverable is a standalone native Pi software-development prompt package.
Server deployment, aggregate-package migration and npm publication are separate.

## Acceptance evidence

Runtime: Pi 0.87.1, Node 24.19.0, npm 10.9.3. The suite builds a tarball,
installs it into an isolated consumer through Pi's real package manager, starts
the native RPC process and captures requests with a local scripted HTTP provider.
`npm run check` covers 49 Harness tests and 2 package tests.

| Requirement | Result | Evidence |
| --- | --- | --- |
| Standalone Pi package and public API | PASS | Installed tarball, public exports, one Harness command, no private Host imports |
| Core Work tools function | PASS | Native Git status returns a synthetic tracked workspace marker |
| Optional guidance follows active tools | PASS | Renderer covers subagents, recall and LSP; native LSP activation updates the immediate next request within the same turn |
| Mode and capability restoration | PASS | Native session restarts restore Chat/Work and active LSP |
| Chat isolation | PASS | Outgoing request has no system/developer messages; optional tool filtering holds even when another extension activates LSP |
| Pi/custom system compatibility | PASS | Work retains native Pi base; explicit custom system text also survives activation and Harness refresh |
| Dynamic UTF-8 ceiling | PASS | Base 9,393 bytes; all optional guidance 10,283 bytes; limit 12,711 bytes, checked at render and request boundaries |
| Invalid Work body blocks requests | PASS | Empty/comment-only, missing, unresolved-marker and oversized Unicode bodies produce zero provider requests; repair restores Work; Chat still works |
| Other provider payload shapes | PASS (synthetic) | OpenAI Responses, Anthropic and Google system containers preserve metadata, unrelated instructions and user/tool text |
| Prompt scope | PASS (review) | Software development only; focused correctness, caller impact, stale-read recovery, regression and acceptance guidance |

The byte ceiling applies to the rendered development body plus selected guidance.
Pi base, runtime facts, schemas, project context and history are outside that bound.

## Final audit corrections

1. Activation originally refreshed guidance only on the next user turn. A native
   failing test reproduced the mismatch; refresh now runs before each model request.
2. An early abort did not prevent Pi from starting a new request controller.
   A native failing test observed an unwanted request with a corrupt body;
   validation now also runs at the actual provider boundary.
3. Optional guidance could hide an empty base body. Each selected source file now
   independently rejects empty content and unresolved markers.

Standards review: no remaining blocker after these fixes; replacement is restricted
to the Harness-owned system block. Spec review: all Issue #1 requirements covered,
including same-turn refresh. Native custom-prompt and failure-path probes then passed.

## Limits and release record

The native provider probe uses the OpenAI-compatible API. Other provider formats
have synthetic payload coverage, not live provider certification. The scripted
provider verifies integration, not model quality or autonomous task success.
There is no web UI or production deployment in this scope.

This extracted repository has no docs/index.md, BACKLOG.md or feedback-loop guide;
Issue #1, package scripts and the native package surface define acceptance.
The same-name Gitea Harness mirror could not be authenticated and is unverified;
no Server mirror was substituted. GitHub is this package's source authority.
Fresh-clone check results and final merge identity are recorded on Issue #1 / PR #2.
