# PI Coffee Agent Runtime deployment

This runbook installs the User VM half of PI Coffee. Server installation is in
[`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server/src/branch/main/docs/deployment/runbook.md).

## Install

Run as the VM owner whose files and native Pi credentials the Agent should use:

```bash
sudo mkdir -p /opt/pi-coffee /etc/pi-coffee
sudo chown "$USER" /opt/pi-coffee
git clone http://gitea:3000/awangs/pi-coffee.git /opt/pi-coffee
cd /opt/pi-coffee
npm ci --ignore-scripts
npm run check

mkdir -p ~/work ~/.pi-coffee/agent ~/.pi-coffee/sessions
sudo cp deploy/uservm/host.env.example /etc/pi-coffee/host.env
sudo chown root:"$USER" /etc/pi-coffee/host.env
sudo chmod 0640 /etc/pi-coffee/host.env
sudoedit /etc/pi-coffee/host.env
sed "s/REPLACE_WITH_VM_OWNER/$USER/g" deploy/uservm/pi-coffee-host.service | sudo tee /etc/systemd/system/pi-coffee-host.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-host
```

Generate a unique Host token and place the same value in this VM's `host.env`
and the administrator-owned route for this user in PI Coffee Server. Do not put
it in Git or Issue evidence.

## Probes

```bash
curl -s http://127.0.0.1:8788/healthz
journalctl -u pi-coffee-host -n 50 --no-pager
```

The expected health role is `host`. A non-loopback bind without
`PI_COFFEE_HOST_TOKEN` must fail closed.

The transfer listener defaults to port `53317`. The target unified Web file
gateway is still being implemented; keep the deployed file route consistent
with the Server version and do not expose the Host or transfer listener to
untrusted networks.

## Lifecycle

- Browser or Web gateway disconnect: accepted Agent work continues.
- Web/Relay restart: Host sessions continue.
- Idle Pi process stop: native conversation remains and resumes on next open.
- Host restart: completed native history remains; an in-flight turn is marked interrupted and is not replayed automatically.
- VM recovery: owner restores the VM snapshot and then verifies Host token, native credentials and routes.
