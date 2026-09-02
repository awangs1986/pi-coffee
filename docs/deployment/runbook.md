# PI Coffee deployment runbook

This runbook describes the current local smoke deployment and the target internal VM shape. It contains no credentials.

## Local smoke

```bash
cd PI-Coffee
npm install
npm run check
npm run build
npm start
```

Open `http://127.0.0.1:3000/`. Health probes:

```bash
curl http://127.0.0.1:3000/healthz   # Web Server
curl http://127.0.0.1:8788/healthz   # Host
```

The local process uses Pi's normal credential resolution. Tests use a fake RPC process and do not require a key.

## Target VM shape

| VM | OS | Process | Network role |
|---|---|---|---|
| Control Plane/Web VM | Debian | Web Server + LLM Relay + routing metadata | Browser entrypoint; private Host transport |
| User VM (one per internal user) | Linux Mint Xfce Edition | Agent Host + original Pi processes | Execution and durable user content |
| Repository VM | existing internal Gitea | Gitea | OAuth and collaboration relay; no internet exposure |

Picode does not manage VM lifecycle. Snapshot creation and manual restore remain owner operations.

## Split-process settings

Web VM:

```bash
PI_COFFEE_WEB_BIND=0.0.0.0
PI_COFFEE_WEB_PORT=3000
PI_COFFEE_HOST_URL=ws://<user-vm-host>:8788/host
PI_COFFEE_HOST_TOKEN=<transport-token-from-secret-store>
npm run start:web
```

User VM:

```bash
PI_COFFEE_HOST_BIND=0.0.0.0
PI_COFFEE_HOST_PORT=8788
PI_COFFEE_HOST_TOKEN=<transport-token-from-secret-store>
PI_COFFEE_WORKDIR=<user-workspace>
PI_COFFEE_AGENT_DIR=<user-pi-config>
PI_COFFEE_SESSION_DIR=<user-pi-sessions>
npm run start:host
```

The exact systemd units and enrollment flow are a 0.1 ticket. Keep the Web VM's upstream LLM key in its secret store; do not put it in `PI_COFFEE_HOST_*`, Git, Wiki, or Issues.

## Reverse proxy

Terminate TLS and expose only the Web Server to the internal browser network. Forward WebSocket upgrades to `/ws`. Keep the Host port private to the Web VM or an explicitly trusted internal network. Do not publish Gitea or the Host port to the public internet.

## Recovery

1. Check Web and Host `/healthz`.
2. If the Browser is disconnected, reconnect with the stored Session ID; do not kill the Host.
3. If the User VM is damaged, stop routing to it and restore its owner-managed snapshot.
4. Restart Agent Host and verify native Pi session recovery once the 0.1 implementation is installed.
5. Record the incident and evidence in the relevant Gitea Issue.
