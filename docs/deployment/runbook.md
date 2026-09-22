# PI Coffee Server deployment

This repository installs two independent processes on the Debian Server:

| Process | Entrypoint | Holds |
|---|---|---|
| Web gateway | `dist/src/web/main.js` | Gitea OAuth secret and fixed per-user Host routes |
| Optional Relay | `dist/src/relay/main.js` | upstream LLM/Search credentials and per-VM Relay tokens |

Agent Host and Pi run from `awangs/pi-coffee` inside each User VM. Restarting
either process here must not stop work already accepted by an Agent Host.

## Install

```bash
sudo useradd --system --home /opt/pi-coffee-server --shell /usr/sbin/nologin pi-coffee || true
sudo mkdir -p /opt/pi-coffee-server /etc/pi-coffee
sudo chown "$USER" /opt/pi-coffee-server
git clone http://gitea:3000/awangs/pi-coffee-server.git /opt/pi-coffee-server
cd /opt/pi-coffee-server
npm ci --ignore-scripts
npm run check

sudo cp deploy/server/web.env.example /etc/pi-coffee/web.env
sudo cp deploy/server/relay.env.example /etc/pi-coffee/relay.env
sudo chown root:pi-coffee /etc/pi-coffee/*.env
sudo chmod 0640 /etc/pi-coffee/*.env
sudoedit /etc/pi-coffee/web.env
sudoedit /etc/pi-coffee/relay.env

sudo cp deploy/server/pi-coffee-web.service deploy/server/pi-coffee-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-web pi-coffee-relay
```

`routes.json` maps a numeric Gitea user ID to one private `hostUrl` and a unique
`hostToken`. The browser cannot choose a Host URL. Do not place secrets in this
repository or in Issue evidence.

Install the routing file so the systemd service can read it, then verify access
before restarting Web. Replacing it through a root-owned temporary file must
preserve the `pi-coffee` group.

```bash
sudo install -o root -g pi-coffee -m 0640 ./routes.json /etc/pi-coffee/routes.json
sudo -u pi-coffee test -r /etc/pi-coffee/routes.json
sudo systemctl restart pi-coffee-web
```

## Probes

```bash
curl -s http://127.0.0.1:3000/healthz
curl -s http://127.0.0.1:8789/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8789/v1/models
journalctl -u pi-coffee-web -u pi-coffee-relay -n 50 --no-pager
```

Expected health roles are `web` and `relay`. A Relay request without a client
token returns `401`. Logs may contain bounded routing/usage metadata and must
not contain prompts, tool output, credentials or file bodies.

## Network

- Browser to Web: HTTPS/WSS through the single public application entrypoint.
- Web to Agent Host: private WS/HTTP with one token per User VM.
- Agent Host to Relay: private HTTP with one Relay token per User VM.
- Relay and Agent Host ports are not exposed publicly.

The target unified file gateway is specified in ADR-0010. Until it is implemented
and tested, do not close a working legacy file route or claim that file traffic
is covered by the unified entrypoint.

## Recovery

1. Check Web and Relay health.
2. Check the selected User VM Host independently.
3. Restarting Web or Relay does not cancel Host work.
4. Restore a User VM only through its owner-managed snapshot procedure.


### Conversation workspace smoke

After Agent #46 and Server #3 deployment, run
`node scripts/smoke-conversation-workspaces.mjs` with `PI_COFFEE_SMOKE_WEB_URL`,
`PI_COFFEE_GITEA_TEST_USER`, `PI_COFFEE_GITEA_TEST_PASSWORD` supplied through the
operator environment. Set `PLAYWRIGHT_EXECUTABLE_PATH` to installed Chromium if needed.
Optionally select a registered disposable Gitea project with `PI_COFFEE_SMOKE_PROJECT_ID`.
The probe uses real OAuth, creates Chat and Work, uploads/downloads an original PNG,
reloads, archives/restores, and verifies cwd/branch/status. It retains archived synthetic
directories and the remote task branch for inspection. Do not save credentials in evidence.


2026-09-22：Conversation Workspace 部署于 `webserver:3000`，Agent 部署于 linux001/linux002。
Agent 171 项、Server 40 项 clean-clone 检查通过；真实浏览器原图往返、Chat/Work 创建、实际分支/同步、路径复制、刷新、归档恢复与 VM 原生进程/清理通过。
联合证据：[Agent review](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/reviews/conversation-workspaces-20260922.md)。
