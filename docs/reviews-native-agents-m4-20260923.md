# M4 native Agent Browser delivery

Status: implemented on `codex/native-agents-m0-m4`; production deployment remains
Agent M5. Server #7 implements Server #6 alongside Agent #49–52. The existing
frontend audit branch was not merged or deployed.

The existing task controls now offer exactly Pi, Codex and Claude Code. Host
readiness disables unavailable options with a reason; Task creation fixes the
choice immediately. Model selection stays separate. Native Tasks hide unsupported
Pi controls, receive native text/tool/approval/question events, and retain Task
scope through reconnect and late responses. Item IDs and cursors prevent duplicate
rendering; pending input IDs remain independently recoverable. An uncertain prompt
is not automatically resent. Tab-local selection wins over another tab's last
selection on refresh.

The gateway only adds authenticated, read-only `/api/engines` forwarding to the
fixed Host. It does not parse native protocols, import credentials, convert
history or operate Git. Existing scoped file/Checkout/Checkpoint/PR flows remain
Host-owned. Native permanent cleanup is unavailable; archive/restore retain data.

The actual Browser operated both native Adapters through a temporary loopback
Web/Host pair and disposable Gitea project. Both read/wrote a file, displayed tools
and Diff, pushed a Checkpoint whose remote SHA matched, restored history and
received native stop results. Claude's real Write approval survived reconnect
and continued the same run when answered. Chat upload/download byte equality and
archive/restore were exercised over the same public workspace/file services.
See the Agent's [joint evidence](http://gitea:3000/awangs/pi-coffee/src/branch/codex/native-agents-m0-m4/docs/reviews/native-agents-m0-m4-20260923.md)
for versions, models, SHAs, real-versus-fixture boundaries and corrected failures.

A responsive Browser probe reproduced the known sidebar collapse defect: removing
the sidebar from grid flow moved the center pane into a zero-width column. Explicit
column placement fixes it without redesigning the three panes. The center measured
about 794px at 1280px with Checkout open, and 390px at 390×844 with Checkout closed.
The narrow composer remained visible and no horizontal document overflow occurred.
New task controls wrap, paths remain copyable, and narrow sidebar open/close works.

Automated controller/gateway tests cover immutable Agent, readiness/legacy Hosts,
scoped Model controls, native messages/tools/questions, replay, uncertain submission,
obsolete socket frames and per-tab selection. `npm ci && npm run check` passes from
a fresh clone; exact revisions and final counts are in Server #7. Native credentials
are not needed for these fixture tests. Production rollout and two-user acceptance
remain M5; no repeat VM snapshot test is required.
