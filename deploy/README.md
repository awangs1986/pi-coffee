# PI Coffee MVP deployment files

Two machines, three processes. The step-by-step procedure is in
[`docs/deployment/runbook.md`](../docs/deployment/runbook.md) ("MVP split deployment").

| Machine | Process | Unit | Env file | Holds |
|---|---|---|---|---|
| Server (Control Plane / Web VM, Debian) | Relay | `server/pi-coffee-relay.service` | `server/relay.env.example` → `/etc/pi-coffee/relay.env` | the sole upstream LLM key, Relay tokens |
| Server | Web Server | `server/pi-coffee-web.service` | `server/web.env.example` → `/etc/pi-coffee/web.env` | Host token |
| User VM (Linux Mint Xfce, one per user) | Agent Host + original Pi | `uservm/pi-coffee-host.service` | `uservm/host.env.example` → `/etc/pi-coffee/host.env`; `uservm/models.json.example` → `$PI_COFFEE_AGENT_DIR/models.json` | Host token, this VM's Relay token |

Rules baked into these files:

- The upstream key exists only in `relay.env` on the server. No file on a User VM contains it.
- The Host refuses to start on a non-loopback bind without `PI_COFFEE_HOST_TOKEN`; the Relay refuses without `PI_COFFEE_RELAY_TOKENS`.
- The Host unit runs as the VM owner, not a service account: Pi needs that user's shell and files. The VM is the isolation boundary.
- Nothing here creates, snapshots or restores VMs. That stays an owner operation.
- The User VM Host loads the bundled V5 Harness Pi extension by default; use
  `PI_COFFEE_EXTENSIONS=off` only for a transport-only diagnostic.

These are the MVP hand-installed units. The idempotent Deployment Skill with enrollment (`DEP-001`, #9) replaces the manual copy steps in 0.1.
