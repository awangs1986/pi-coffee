# PI Coffee documentation map

This is the handoff index for the independent PI Coffee repository. It is deliberately short; each linked document is the single source for one kind of knowledge.

## Read in this order

1. [`AGENTS.md`](../AGENTS.md): repository guardrails and completion rule.
2. [`../BACKLOG.md`](../BACKLOG.md): the complete discussion-derived backlog and traceability map ([Gitea Issue #13](http://testpc:3000/awangs/pi-coffee/issues/13)).
3. [`product/decisions.md`](./product/decisions.md): decisions carried over from the design conversation, with their MVP/0.1 status.
4. [`spec/mvp.md`](./spec/mvp.md): the implemented first vertical slice and its evidence.
5. [`spec/0.1.md`](./spec/0.1.md): the next release contract and ticket order.
6. [`architecture/topology.md`](./architecture/topology.md): Host, Web Server, Control Plane, User VM, and data ownership.
7. [`protocol.md`](./protocol.md): the current browser ↔ Web Server ↔ Host frame contract.
8. [`deployment/runbook.md`](./deployment/runbook.md): local smoke run and target VM deployment.
9. [`development/workflow.md`](./development/workflow.md): test, review, and Gitea workflow.
10. [`development/handoff-import.md`](./development/handoff-import.md): import the temporary source attachment if the remote branch is still empty.
11. [`development/wiki-publish.md`](./development/wiki-publish.md): owner procedure for mirroring these pages into Gitea Wiki.
12. [`spec/harness-prompt.md`](./spec/harness-prompt.md): the canonical V3-derived, Pi-native Lean/Full prompt contract.
13. [`spec/harness-plugin.md`](./spec/harness-plugin.md): V5 8/10 tool tables, Pi extension wiring, and User VM-native adapters.
14. [`spec/subagents-plugin.md`](./spec/subagents-plugin.md): locked `pi-subagents` integration, optional-tool semantics, and rollback switches.
15. [`spec/web-search-plugin.md`](./spec/web-search-plugin.md): Relay-backed Serper search, native subagent delegation, and Markdown research closure.

## Research notes

- [`harness-prompt-audit-20260902.md`](./research/harness-prompt-audit-20260902.md): V3 prompt provenance/content audit, V5 harness mapping, and the proposed PI Coffee `/harness` boundary.
- [`pi-subagents-audit-20260903.md`](./research/pi-subagents-audit-20260903.md): upstream source/version audit and Pi 0.84.4 loading evidence.
- [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): what the Codex-style browser shell has (A/B/C) and what is still missing (D/E/F/G), with the order to build it.
- [`pi-web-evaluation-20260903.md`](./research/pi-web-evaluation-20260903.md): `ARCH-001` evaluation of agegr/pi-web against the PI Coffee deployment shape and ADRs; recommends keeping the Host/Web seam and borrowing its extension-UI, native-session-history and reconnection designs.
- [`pi-web-access-audit-20260903.md`](./research/pi-web-access-audit-20260903.md): official `pi-web-access@0.27.0` loading audit, tool conflict isolation, and Serper credential boundary.
- [`handoff-completeness-audit-20260903.md`](./research/handoff-completeness-audit-20260903.md): coverage audit for today's design discussion and current implementation gaps.
- [`gitea-full-audit-20260903.md`](./reviews/gitea-full-audit-20260903.md): current `main` code, Issues, PRs, validation evidence, risks, and release gates.
- Web delivery tickets: [WEB-001 / #23](http://testpc:3000/awangs/pi-coffee/issues/23) (code slice) and [WEB-002 / #24](http://testpc:3000/awangs/pi-coffee/issues/24) (real VM acceptance).

## Authority order

- Gitea Issues are authoritative for scope, status, dependencies, and acceptance comments: [awangs/pi-coffee/issues](http://testpc:3000/awangs/pi-coffee/issues).
- ADRs are authoritative for hard-to-reverse architectural choices.
- The checked-in code and tests are authoritative for behaviour that is already implemented.
- The product and release specs are authoritative for planned behaviour not yet implemented.
- The Picode V5 repository is not a PI Coffee work queue or source tree.

## Current handoff state

The remote `main` contains the MVP in its deployment shape: Agent Host + original Pi for the User VM, Web Server + LLM Relay for the server, the Codex-style browser shell, systemd/env templates in `deploy/`, and a real-model evidence script (`scripts/smoke-real-model.mjs`). It also loads the locked `pi-subagents@0.63.0` extension and the native Web adapter; `scripts/smoke-subagents.mjs` verifies Web/subagent registration without a model key. A fresh clone passes `npm ci && npm run check`; the three-process path has been reproduced on a workstation across a LAN interface with the Host holding no upstream key. Installing it on the real server and User VM is the owner's step, driven by the task brief on [#5](http://testpc:3000/awangs/pi-coffee/issues/5); Relay evidence is on [#7](http://testpc:3000/awangs/pi-coffee/issues/7).
