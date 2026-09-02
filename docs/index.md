# PI Coffee documentation map

This is the handoff index for the independent PI Coffee repository. It is deliberately short; each linked document is the single source for one kind of knowledge.

## Read in this order

1. [`AGENTS.md`](../AGENTS.md): repository guardrails and completion rule.
2. [`product/decisions.md`](./product/decisions.md): decisions carried over from the design conversation, with their MVP/0.1 status.
3. [`spec/mvp.md`](./spec/mvp.md): the implemented first vertical slice and its evidence.
4. [`spec/0.1.md`](./spec/0.1.md): the next release contract and ticket order.
5. [`architecture/topology.md`](./architecture/topology.md): Host, Web Server, Control Plane, User VM, and data ownership.
6. [`protocol.md`](./protocol.md): the current browser ↔ Web Server ↔ Host frame contract.
7. [`deployment/runbook.md`](./deployment/runbook.md): local smoke run and target VM deployment.
8. [`development/workflow.md`](./development/workflow.md): test, review, and Gitea workflow.
9. [`development/handoff-import.md`](./development/handoff-import.md): import the temporary source attachment if the remote branch is still empty.

## Authority order

- Gitea Issues are authoritative for scope, status, dependencies, and acceptance comments: [awangs/pi-coffee/issues](http://testpc:3000/awangs/pi-coffee/issues).
- ADRs are authoritative for hard-to-reverse architectural choices.
- The checked-in code and tests are authoritative for behaviour that is already implemented.
- The product and release specs are authoritative for planned behaviour not yet implemented.
- The Picode V5 repository is not a PI Coffee work queue or source tree.

## Current handoff state

The local MVP baseline has a Host/Web Server implementation and a ten-test check. The remote repository must contain the same commits before a colleague can clone it; see the handoff Issue and the push note there.
