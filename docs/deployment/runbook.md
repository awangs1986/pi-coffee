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
sudo ./deploy/uservm/install-owner-access.sh "$USER"
sudo systemctl enable --now pi-coffee-host
```

Generate a unique Host token and place the same value in this VM's `host.env`
and the administrator-owned route for this user in PI Coffee Server. Do not put
it in Git or Issue evidence.

## Probes

```bash
curl -s http://127.0.0.1:8788/healthz
npm run probe:owner-access
journalctl -u pi-coffee-host -n 50 --no-pager
```

The expected health role is `host`; `capabilities.ownerEnvironment` and
`capabilities.passwordlessRoot` must both be `true`. `probe:owner-access`
must report the VM owner HOME and UID 0 through `sudo -n`. A non-loopback bind
without `PI_COFFEE_HOST_TOKEN` must fail closed.

The transfer listener defaults to port `53317`. The target unified Web file
gateway is still being implemented; keep the deployed file route consistent
with the Server version and do not expose the Host or transfer listener to
untrusted networks.

## Lifecycle

- Browser or Web gateway disconnect: accepted Agent work continues.
- Web/Relay restart: Host sessions continue. The current Web login cookie is
  process-local and is invalid after a Web restart; sign in through Gitea again
  to reattach to the unchanged Host conversation.
- Idle Pi process stop: native conversation remains and resumes on next open.
- Host restart: completed native history remains; an in-flight turn is marked interrupted and is not replayed automatically.
- VM recovery: owner restores the VM snapshot and then verifies Host token, native credentials and routes.

For the host-admin procedure, failure stops and the redacted evidence template,
use [`vm-snapshot-rollback-task.md`](./vm-snapshot-rollback-task.md). Run
`scripts/vm-snapshot-rollback-wizard.sh` when an operator wants a staged
checklist and evidence draft. The first acceptance run targets the expendable
`linux002` VM and must use an offline disk snapshot with no memory state.

## Owner privileges and Gitea

[ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md) requires the service owner to have unrestricted passwordless sudo, preserving that owner's HOME and Git/Pi configuration. The installation above provisions it with an idempotent validated sudoers script, and Host startup probes `id` plus `sudo -n id -u`; an interactive terminal check alone is insufficient. Do not deploy sudo-blocking service restrictions.

`install-owner-access.sh` validates the generated sudoers fragment with
`visudo`, verifies the service owner/HOME when the unit exists, and runs the
passwordless root probe as that owner. It is idempotent. Review the target VM
and run it explicitly; package installation never changes sudoers by itself.

Configure `PI_COFFEE_GITEA_URL`, `PI_COFFEE_GITEA_OWNER`,
`PI_COFFEE_GITEA_TOKEN` and the stable `PI_COFFEE_VM_ID` in `host.env`. The API
token stays in the environment and Git uses the owner's normal SSH or
credential helper. To verify an expendable repository end to end:

```bash
npm run smoke:gitea-workspaces
```

The smoke creates and deletes a temporary private repository, checkpoints a
file, creates a PR and continues the exact SHA through a second workspace root.
Gitea restores only pushed code; keep VM-native history, unversioned files and
credentials in the VM recovery plan.

When a User VM is cloned, changing only `PI_COFFEE_GITEA_TOKEN` is not enough.
The owner's credential helper may still contain the source VM's Git password or
token. Rotate the API token and the Git credential store independently, then
verify both identities before starting Host. One non-logging way to replace an
HTTP credential is:

```bash
printf 'protocol=http\nhost=gitea:3000\n\n' | git credential reject
read -rsp 'Gitea runtime token: ' PI_COFFEE_GIT_TOKEN; printf '\n'
printf 'protocol=http\nhost=gitea:3000\nusername=%s\npassword=%s\n\n' \
  "$PI_COFFEE_GITEA_OWNER" "$PI_COFFEE_GIT_TOKEN" | git credential approve
unset PI_COFFEE_GIT_TOKEN
```

Also replace the clone's hostname, machine ID, SSH host keys, Host transport
token and stable VM ID, and clear copied workspaces, sessions and task output.
Do not leave the source credential file on the clone as a backup.

## Skills management

The Web Skills page calls the owning Host. No new service or database is needed.
Skill state defaults to `~/.local/share/pi-coffee/skills`; optionally set
`PI_COFFEE_SKILL_ROOT` to an absolute persistent VM directory. Keep this registry,
retained versions and the native user directories in VM backups. Project Skill
files are ordinary checkout changes. Web rollback does not remove Skill files.

After `npm ci --ignore-scripts && npm run check`, run
`node scripts/smoke-skills.mjs` from a Git checkout. It creates an isolated temporary
Host and home, installs the repository's synthetic fixture for all three native
directory mappings, checks Pi discovery, updates/toggles/inspects it, and cleans up.
It does not call a model or touch normal user Skill folders. To probe remote Git,
set `SKILL_SMOKE_SOURCE` to the repository clone URL and `SKILL_SMOKE_REF` to the
release SHA; the optional existing VM Gitea environment supplies authentication.
Never paste tokens into URLs, Issues or browser forms.

If an interrupted mutation leaves `mutation.lock`, stop concurrent management and
inspect its `recovery.json` (target, retained backup, record ID), registry and native
files on the VM. Reconcile the last published registry entry with those files,
restore the retained copy if necessary, then remove only the stale lock. Do not
blindly clear the lock during a running install. Local edits are never silently
reset by Web; preserve them before reconciling an externally edited managed Skill.
