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

## Research notes

- [`harness-prompt-audit-20260902.md`](./research/harness-prompt-audit-20260902.md): V3 prompt provenance/content audit, V5 harness mapping, and the proposed PI Coffee `/harness` boundary.

## Authority order

- Gitea Issues are authoritative for scope, status, dependencies, and acceptance comments: [awangs/pi-coffee/issues](http://testpc:3000/awangs/pi-coffee/issues).
- ADRs are authoritative for hard-to-reverse architectural choices.
- The checked-in code and tests are authoritative for behaviour that is already implemented.
- The product and release specs are authoritative for planned behaviour not yet implemented.
- The Picode V5 repository is not a PI Coffee work queue or source tree.

## Current handoff state

The remote `main` contains the MVP baseline and the discussion backlog at commit `eacb697`. A fresh clone has passed `npm ci && npm run check` (5 test files / 10 tests); see the handoff Issue for the recorded evidence.
