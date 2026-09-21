# PI Coffee Agent Runtime topology

The complete product topology is maintained in
[`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server/src/branch/main/docs/architecture/topology.md).

This repository occupies the User VM side:

```text
PI Coffee Server ──private WS/HTTP──> Agent Host ──RPC──> original Pi
                                             │
                                             ├── native sessions and context
                                             ├── Conversation checkouts and Git → Gitea
                                             ├── uploads and artifacts
                                             └── extensions, tools, Skills and LSP
```

The Host and Server have independent lifetimes. The Host owns Agent execution
and durable user content. The Server owns browser delivery, identity and fixed
routing. The Interface between them is [`../protocol.md`](../protocol.md).

Target authority: VM owner + unrestricted sudo for execution; Gitea for synchronized code and PR integration. Host owns Git/Gitea code operations; Server forwards and displays their results. [ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md) is accepted; T0–T4 implementation remains pending.
