# PI Coffee deployment runbook

This runbook describes the current local smoke deployment and the target internal VM shape. It contains no credentials.

## Local smoke

```bash
cd pi-coffee
npm ci
npm run check
npm start
```

Open `http://127.0.0.1:3000/`. Health probes:

```bash
curl http://127.0.0.1:3000/healthz   # Web Server
curl http://127.0.0.1:8788/healthz   # Host
```

The local process uses Pi's normal credential resolution. Tests use a fake RPC process and do not require a key.

## Real model through the CPA relay (MVP verification)

The Host runs the original Pi, so model access is configured exactly as for a
standalone Pi: a `models.json` in the Pi agent directory. Keep that directory
OUTSIDE the repository and let the key come from the environment; the file
itself then contains no secret.

```bash
mkdir -p ~/pi-coffee-local/agent ~/pi-coffee-local/sessions ~/pi-coffee-local/workdir
cat > ~/pi-coffee-local/agent/models.json <<'EOF'
{
  "providers": {
    "cpa": {
      "baseUrl": "https://awangsawangs.xyz/v1",
      "api": "openai-completions",
      "apiKey": "$PI_COFFEE_CPA_KEY",
      "models": [
        { "id": "gpt-5.4-mini", "reasoning": true, "input": ["text", "image"], "contextWindow": 200000, "maxTokens": 16384 },
        { "id": "gpt-5.5",      "reasoning": true, "input": ["text", "image"], "contextWindow": 200000, "maxTokens": 16384 },
        { "id": "grok-4.6",     "reasoning": true, "input": ["text", "image"], "contextWindow": 200000, "maxTokens": 16384 }
      ]
    }
  }
}
EOF
```

`"apiKey": "$PI_COFFEE_CPA_KEY"` is Pi's environment interpolation: the key is
read from the Host process environment at request time and is never written to
disk by PI Coffee. Provide it only in the shell that starts the Host (or in the
systemd unit's `EnvironmentFile` with `0600` permissions in 0.1). Until the
central Relay (`CP-001`) exists, this is the documented MVP exception to
"the key stays on the Control Plane".

```bash
export PI_COFFEE_CPA_KEY=...            # never commit, never paste into an Issue
export PI_COFFEE_AGENT_DIR=~/pi-coffee-local/agent
export PI_COFFEE_SESSION_DIR=~/pi-coffee-local/sessions
export PI_COFFEE_WORKDIR=~/pi-coffee-local/workdir
export PI_COFFEE_PROVIDER=cpa
export PI_COFFEE_MODEL=gpt-5.4-mini
npm start
```

Then, from a second shell, run the reproducible end-to-end evidence script. It
speaks the browser protocol (open → prompt → streamed `text_delta` →
`agent_settled`), disconnects, reconnects with an older cursor and asserts the
bounded replay, then runs a second turn on the same Session:

```bash
node scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws
```

It exits 0 and prints a JSON evidence block (no secrets) that can be pasted
into the Gitea Issue. Exit 1 with a `FAIL` line means the path is broken; the
first failing step names the seam.

Both `https://awangsawangs.xyz/v1` and `https://b.awangsawangs.xyz/v1` serve the
same model list; use the one your network resolves.

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
PI_COFFEE_EXTENSIONS=<optional-colon-separated-extension-paths>
npm run start:host
```

When `PI_COFFEE_EXTENSIONS` is unset, the Host automatically loads the bundled
V5 Harness adapter. Set it to `off` only for a transport-only diagnostic run;
set it to a colon-separated list when deploying an explicit extension bundle.

`PI_COFFEE_HOST_TOKEN` is mandatory whenever the Host binds to anything other
than loopback: the Host refuses to start otherwise (fail closed), because that
port carries prompts and Pi events for the whole User VM. Generate it with
`openssl rand -hex 32` and give the same value to the Web VM.

The exact systemd units and enrollment flow are a 0.1 ticket. Keep the Web VM's upstream LLM key in its secret store; do not put it in `PI_COFFEE_HOST_*`, Git, Wiki, or Issues.

## Reverse proxy

Terminate TLS and expose only the Web Server to the internal browser network. Forward WebSocket upgrades to `/ws`. Keep the Host port private to the Web VM or an explicitly trusted internal network. Do not publish Gitea or the Host port to the public internet.

## Recovery

1. Check Web and Host `/healthz`.
2. If the Browser is disconnected, reconnect with the stored Session ID; do not kill the Host.
3. If the User VM is damaged, stop routing to it and restore its owner-managed snapshot.
4. Restart Agent Host and verify native Pi session recovery once the 0.1 implementation is installed.
5. Record the incident and evidence in the relevant Gitea Issue.
