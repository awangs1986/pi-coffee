> Historical evidence and deployment instructions. For current source authority and deployment, use [ADR-0020](../adr/0020-unified-github-authority.md) and [the unified release procedure](../deployment/unified-release.md).

# Complete workbench recovery — 2026-09-27

## Cause

Deploying GitHub `awangs1986/pi-coffee` main `6e0d7fe` replaced the complete
split Server `b9bdde5` with an older monolithic product lineage. The latest arena
branch was included in GitHub main, but the complete Gitea Server implementation
was not. This was a deployment-source mistake, not a browser cache problem.
The previous connectivity-only acceptance did not cover existing UI behavior.

## Recovery

- Web remains at `http://webserver:3000/` on `192.168.100.101`, using the complete
  Server implementation based on Gitea main `b9bdde5`.
- `99-complete-workbench.conf` selects the split Server entrypoint and protected
  workbench environment. Previous release directories, service configuration and
  routes remain backed up under `/etc/pi-coffee/backups/`.
- Gitea owner `awangs` routes to the complete local Host on `192.168.100.123:8790`.
  Its scoped file service uses port `53319`. Gitea user 6 retains its original
  route. The old linux001/linux002 endpoints were unreachable during recovery;
  this report does not claim either old VM is healthy or migrated.
- The local Host is based on Gitea Agent main `3fb4885`, plus verified Codex
  0.156.1 readiness support. Native Codex uses the existing local login and the
  previously selected Luna/unrestricted service settings. Native Claude uses its
  previously authorized provider configuration, isolated to its CLI wrapper.
- Local data belongs to `/home/awang/.local/share/pi-coffee-workbench/`.
  The monolith's earlier data and Host remain intact; no histories were converted
  or silently rebound. Two empty synthetic tasks were created for UI checks.
- Both existing Gitea product repositories were registered through the Agent
  workspace interface. No remote branch, checkpoint or PR was created by this
  recovery probe. Git identity comes from the authenticated Gitea profile.
- The Git helper returns its protected scoped credential only for the configured
  Gitea scheme, hostname and port. Credentials remain outside Git and evidence.

## Acceptance

`scripts/probe-workbench-release.mjs` reproduced five failures against the
monolith, then passed all five control groups and six matching served assets
against the restored complete Server. The browser independently checked the
actual authenticated DOM before and after: all reported missing IDs changed
from absent to present.

| User-visible behavior | Actual browser result |
| --- | --- |
| New Work Agent selection | Pi, Codex and Claude Code all enabled; Chat remains Pi-only |
| Pi Coffee brand menu | Project, archive, Skills, theme and plugin items open |
| Pi Context Usage | Seven categories including system prompt, rules, Skills and tools; not cumulative input/output |
| Bottom task details | Arrow expands VM, complete task path and local context action |
| Right file/review panel | Closed by default; folder button opens Diff/Checks |
| File Diff | Temporary two-line file appears; opening it shows the actual added lines |
| Local Codex | Empty Work task opens on native 0.156.1 and displays `gpt-6-luna` |
| Sidebar collapse | Composer remains within viewport; no horizontal overflow |

The temporary Diff file was removed after the check. No model prompt was sent;
provider billing and new turn generation were intentionally left to the owner's
manual test. Both services were active with zero automatic restarts.

Fresh-checkout validation: Server `npm run check` — 56 tests / 8 files; Agent —
203 tests / 34 files. Existing Server vendor source-map warnings are non-fatal.
The Codex allowlist test first failed before the targeted version support change,
then passed. A targeted security review found no remaining blocking finding.

## Repository reconciliation still required

The GitHub arena commits and fixes remain preserved. They were not converted
into the complete split Server by this operational recovery. Their compatible
enhancements need deliberate porting and ownership reconciliation before GitHub
main can again be treated as the production release source. Do not claim that
this recovery deploys the older monolith's latest UI changes.
