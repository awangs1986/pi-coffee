# Issue tracker: Gitea

The authoritative issue tracker for this repository is
[`awangs/pi-coffee`](http://gitea:3000/awangs/pi-coffee/issues).
Issue titles, bodies, comments, status, and dependencies there are authoritative.

Use the Gitea API v1 to read, create, and update issues, comments, and labels.
The repository API base is `http://gitea:3000/api/v1/repos/awangs/pi-coffee`.
Authenticate using credentials supplied by the execution environment; never put
credentials in repository files, issues, or logs. GitHub is a later publication
destination, not a parallel issue queue.

## Working conventions

- Before working, read the relevant issue, including comments, labels, and dependencies.
- Read [BACKLOG.md](../../BACKLOG.md). [Issue #1](http://gitea:3000/awangs/pi-coffee/issues/1)
  is the project map; [Issue #13](http://gitea:3000/awangs/pi-coffee/issues/13)
  indexes the historical discussion and backlog. `D-*` and phase IDs are stable
  cross-document identifiers; Gitea issue numbers identify execution tickets.
- When a skill says to publish a task or specification to the issue tracker,
  create a Gitea issue in this repository.
- When a skill says to fetch the relevant ticket, read the Gitea issue and its comments.
- Link parent and child issues in both directions. Record dependencies explicitly
  as `Blocked by: #<number>`; use absolute repository URLs for cross-repository dependencies.
- Resolve existing labels by name using [triage-labels.md](./triage-labels.md).
  Create missing labels as needed, avoid duplicates, and preserve unrelated labels.
- Use map order or numeric ticket prefixes to order work when labels are unavailable.
- Before closing a completed issue, record the implementation commit, check commands,
  and acceptance evidence. A fresh clone must be able to run the documented check or probe.
- If Gitea is unavailable, report pending synchronization; do not create a separate
  authoritative local backlog.

## Repository boundaries

Agent Runtime issues belong to `awangs/pi-coffee`. Browser, identity, routing,
and Relay issues belong to `awangs/pi-coffee-server`. Track cross-repository work
with separate, mutually linked issues.

Picode V5 remains a frozen reference. Do not copy PI Coffee tickets into V5 or
treat its issue list as a PI Coffee queue.

## Pull requests as a triage surface

**PRs as a request surface: no.**
