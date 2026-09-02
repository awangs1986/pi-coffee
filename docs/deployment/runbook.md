# PI Coffee deployment runbook

This runbook covers the MVP deployment shape — **original Pi + Agent Host in a
User VM, Web Server + LLM Relay on the server** — and the single-machine
developer smoke. It contains no credentials.

## Processes and what each one holds

```text
Browser ──HTTP/WS──> Web Server (server) ──WS + Host token──> Agent Host (User VM) ──RPC──> original Pi
                                                                        │
                                                                        └──HTTP + Relay token──> LLM Relay (server) ──upstream key──> CPA
```

| Process | Runs on | `node dist/src/main.js …` | Secrets it holds |
|---|---|---|---|
| LLM Relay | server | `relay` | the sole upstream key; the list of Relay tokens |
| Web Server | server | `web` | the Host token |
| Agent Host (+ Pi) | User VM | `host` | the Host token; this VM's Relay token |

No process on a User VM ever sees the upstream key. Both the Host and the Relay
refuse to start on a non-loopback bind without their token (fail closed).

## Prerequisites (both machines)

- Debian 12 (server) or Linux Mint Xfce (User VM), internal network only.
- Node.js **>= 22.19** (`node -v`). Debian/Mint packages are older; use the
  NodeSource 22.x repository or an official tarball.
- `git`, `curl`. The pinned original Pi (`@earendil-works/pi-coding-agent@0.84.4`)
  and locked `pi-subagents@0.63.0` are installed by `npm ci` inside the
  checkout; nothing else to install for Pi.
- Firewall: the server must reach `USER_VM:8788` (Host); the User VM must reach
  `SERVER:8789` (Relay); browsers reach `SERVER:3000` (or your TLS proxy).
  Do not expose 8788/8789 beyond those two peers.

## Checkout (both machines)

```bash
sudo mkdir -p /opt/pi-coffee /etc/pi-coffee
sudo chown "$USER" /opt/pi-coffee
git clone http://testpc:3000/awangs/pi-coffee.git /opt/pi-coffee
cd /opt/pi-coffee
npm ci --ignore-scripts
npm run check      # all repository tests must pass; this also builds dist/
```

## Server: Relay + Web Server

Generate the two shared secrets once and keep them in a password manager:

```bash
openssl rand -hex 32   # HOST_TOKEN  → web.env and the User VM's host.env
openssl rand -hex 32   # RELAY_TOKEN → relay.env (PI_COFFEE_RELAY_TOKENS) and host.env (PI_COFFEE_RELAY_TOKEN)
```

```bash
sudo useradd --system --home /opt/pi-coffee --shell /usr/sbin/nologin pi-coffee || true
sudo cp deploy/server/relay.env.example /etc/pi-coffee/relay.env
sudo cp deploy/server/web.env.example   /etc/pi-coffee/web.env
sudo chown root:pi-coffee /etc/pi-coffee/*.env && sudo chmod 0640 /etc/pi-coffee/*.env
sudoedit /etc/pi-coffee/relay.env   # PI_COFFEE_UPSTREAM_KEY, PI_COFFEE_RELAY_TOKENS
sudoedit /etc/pi-coffee/web.env     # PI_COFFEE_HOST_URL=ws://USER_VM_IP:8788/host, PI_COFFEE_HOST_TOKEN
sudo cp deploy/server/pi-coffee-relay.service deploy/server/pi-coffee-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-relay pi-coffee-web
```

Checks:

```bash
curl -s http://127.0.0.1:8789/healthz        # {"ok":true,"role":"relay"}
curl -s http://127.0.0.1:3000/healthz        # {"ok":true,"role":"web"}
curl -s -H "Authorization: Bearer $RELAY_TOKEN" http://127.0.0.1:8789/v1/models | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8789/v1/models   # 401: no token, no upstream
journalctl -u pi-coffee-relay -n 20 --no-pager   # one JSON metadata line per request, no bodies
```

## User VM: Agent Host + original Pi

Run as the VM owner (the account whose shell and files Pi should use):

```bash
mkdir -p ~/work ~/.pi-coffee/agent ~/.pi-coffee/sessions
sed "s/SERVER_IP/<server ip>/" deploy/uservm/models.json.example > ~/.pi-coffee/agent/models.json
sudo cp deploy/uservm/host.env.example /etc/pi-coffee/host.env
sudo chown root:"$USER" /etc/pi-coffee/host.env && sudo chmod 0640 /etc/pi-coffee/host.env
sudoedit /etc/pi-coffee/host.env    # HOST_TOKEN, RELAY_TOKEN, replace REPLACE_WITH_VM_OWNER with $USER
sed "s/REPLACE_WITH_VM_OWNER/$USER/g" deploy/uservm/pi-coffee-host.service | sudo tee /etc/systemd/system/pi-coffee-host.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-host
```

Checks:

```bash
curl -s http://127.0.0.1:8788/healthz        # {"ok":true,"role":"host"}
journalctl -u pi-coffee-host -n 20 --no-pager
```

`"apiKey": "$PI_COFFEE_RELAY_TOKEN"` in `models.json` is Pi's environment
interpolation: the token comes from the Host's environment at request time and
is never written to disk by PI Coffee.

The Host automatically loads the bundled V5 Harness and `pi-subagents`
extension. The `subagent` and `bg_wait` tools remain optional until activated
through Harness `search_tools`, so the frozen Simple/Full base counts stay
8/10. Set `PI_COFFEE_SUBAGENTS=off` to keep only Harness; set
`PI_COFFEE_EXTENSIONS=off` for a transport-only diagnostic, or provide a
colon-separated list of explicit extension paths to replace the defaults.
The package's built-in commands and prompt templates are visible in the Pi RPC
command list after startup.

## End-to-end evidence

From the server (or any machine that can reach the Web Server):

```bash
cd /opt/pi-coffee
node scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws
```

It speaks the browser protocol (open → prompt → streamed `text_delta` →
`agent_settled`), disconnects, reconnects with an older cursor and asserts the
bounded replay, then runs a second turn on the same Session. Exit 0 and a JSON
evidence block (no secrets) means the whole two-machine path works; paste that
block into the Gitea Issue. Exit 1 names the first failing seam.

Then open `http://SERVER:3000/` in a browser and use the shell.

## Failure semantics you should see

| Fault | What the browser shows | Recovery |
|---|---|---|
| Web Server cannot reach the Host | `错误（host_unavailable）` note | fix network/token; the Host and its Pi Sessions are untouched |
| Host token mismatch | Web logs 401 from the Host; browser gets `host_unavailable` | make `PI_COFFEE_HOST_TOKEN` identical on both sides |
| Relay down or Relay token wrong | `模型调用失败：…` note after the prompt | `systemctl status pi-coffee-relay`; check `PI_COFFEE_RELAY_TOKEN(S)` |
| Upstream (CPA) error | `模型调用失败：…` or Pi's auto-retry note; Relay log line has `outcome: upstream_error` | upstream side |
| Browser closed / refreshed / opened on another machine | nothing — the run continues on the Host; the browser reloads the conversation list and history from Pi's session store in the User VM | none needed |
| Idle Pi process stopped (`PI_COFFEE_IDLE_TIMEOUT_MS`, default 10 min) | nothing visible; the next open resumes the conversation from the store | none needed |
| Host restarted | browser reconnects; every completed conversation is listed and readable; a message that was mid-stream at the crash is cut at its last completed message | resend the last prompt; mid-run recovery is `REC-001` (0.1) |

## Developer smoke on one machine (no VMs)

```bash
npm ci && npm run check && npm start        # Host + Web on loopback, Pi with its default credentials
```

安装或升级后可先运行 `npm run smoke:subagents`；它使用离线临时目录验证
`pi-subagents` 扩展和命令注册，不需要模型凭据。

`npm start` (`all`) also starts the Relay when `PI_COFFEE_UPSTREAM_KEY` is set.
To test a Host that has **no** upstream key on one machine, run three shells:

```bash
# 1. Relay
PI_COFFEE_UPSTREAM_KEY=… PI_COFFEE_RELAY_TOKENS=t1 npm run start:relay
# 2. Host (models.json baseUrl http://127.0.0.1:8789/v1, apiKey "$PI_COFFEE_RELAY_TOKEN")
PI_COFFEE_RELAY_TOKEN=t1 PI_COFFEE_AGENT_DIR=… PI_COFFEE_PROVIDER=cpa PI_COFFEE_MODEL=gpt-5.4-mini npm run start:host
# 3. Web
npm run start:web
node scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws
```

Both `https://awangsawangs.xyz/v1` and `https://b.awangsawangs.xyz/v1` serve the
same model list; use the one your network resolves.

## Reverse proxy

Terminate TLS and expose only the Web Server to the internal browser network.
Forward WebSocket upgrades on `/ws`. Keep 8788 (Host) and 8789 (Relay) private
to their peers. Do not publish Gitea, the Host or the Relay to the public
internet.

## Recovery

1. Check `/healthz` on Relay, Web and Host.
2. If the browser is disconnected, reconnect; do not kill the Host.
3. If the User VM is damaged, stop routing to it and restore its owner-managed snapshot.
4. Record the incident and evidence in the relevant Gitea Issue.
