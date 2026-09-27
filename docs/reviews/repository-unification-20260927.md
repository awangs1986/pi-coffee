# Repository reconciliation — 2026-09-27

Status: source integration and local acceptance complete. Publication and deployment identities are recorded in [Server #17](http://gitea:3000/awangs/pi-coffee-server/issues/17).

## Pinned baselines

| Source | Revision | Strength |
| --- | --- | --- |
| GitHub pi-coffee-server/main | 276d843b9544b533b400c54984d73477aadd17a1 | Shared Host, advanced Codex adapter, P0–P4 attention/usage/native history/turn diff, transfer hardening |
| Gitea pi-coffee-server/main | 3e7376d418c3c5eb8562f1e564ac855cf8bcd184 | Complete workbench, gateway, task and Skills UI |
| Gitea pi-coffee/main | 953bba4 | Chat/Work, workspace lifecycle, native-engine binding, Claude, Skills, LSP |

GitHub and Gitea Server had unrelated histories after the earlier repository split. The GitHub main was not simply an older version: deploying either tree alone discarded capabilities from the other. The owner explicitly retained Host in the GitHub repository.

## Acceptance matrix

| Capability | Reconciliation requirement |
| --- | --- |
| Shared Host | Scope HTTP, WS, registries, projects, grants and broadcasts by authenticated identity |
| Engines | Pi Chat default; Work supports immutable Pi/Codex/Claude selection |
| Codex | Preserve GitHub paged history, native empty-thread compatibility, models/effort, tool output, turn diff, usage and native ownership checks |
| Task lifecycle | Independent checkouts, Chat folders, branches, checkpoint/sync/PR, archive retains files, guarded explicit cleanup |
| Workbench | Brand menu, button-based search, compact task footer, opt-in file panel, seven-category Context Usage, Skills |
| Review | Retain branch comparison and native turn comparison as separate labeled scopes; only one right pane opens at a time |
| Security | Gitea OAuth/revocation and Origin checks; scoped transfer expiry/revocation; credential filename and resolved-path checks |
| Source authority | GitHub/Gitea main and deployed release match one commit; both histories remain accessible |

Unmerged `frontend-audit` and `shared-vm-transition` branches were inspected as additional references, not treated as deployed truth. The withdrawn UX prototype is excluded. Their pending findings are not represented as completed features merely because they have later commit dates.

## Verification

- `npm run check`: 49 test files, 313 tests passed, including the combined Host, gateway, native adapters, workspaces, Skills, Pi harness and LSP suites.
- `npm audit`: zero known vulnerabilities in the combined lockfile.
- Real Web → Host → native Codex `gpt-6-luna` task: read a disposable README, created `verification.txt` with `UNIFIED_WORKBENCH_OK`, and returned that marker. Native tool activity was visible; refresh and Host restart restored history. Web rename persisted.
- Browser: Pi-only Chat default; all three Work engines enabled; brand menu, dedicated search with preserved draft, Skills destinations, task path expansion and seven-category Context Usage verified. Context showed system prompt/rules/Skills/tool categories, not cumulative billing totals.
- Browser branch review: a disposable README modification appeared as exactly one added line; Unified/Split choices remained available. The file panel stayed opt-in.
- Sidebar collapsed at 1280×720: document remained 1280×720 and composer stayed within the viewport. No browser console errors were reported during this isolated walk.
- Security regression: cross-user task access and transfer grants, logout during partial upload, native structured questions, and revoked-cookie replay across Web restart. The last regression failed before the epoch/generation fix and passed afterwards. A bounded follow-up review found no remaining blocking finding in those paths.

Local evidence: `/tmp/verify-20260927-unified/` (screenshots), `/tmp/coffee-unify-final-check-3.log`, `/tmp/coffee-unify-auth-red.log`, `/tmp/coffee-unify-auth-green.log`, and `/tmp/coffee-unified-verify/task-result.json`. Synthetic test content only; credentials and native transcripts are excluded from commits and Issues.

Limits: no new paid Claude or Pi prompt was sent in this reconciliation. Native turn-diff events and structured questions were verified with adapter fixtures; the actual Luna turn used command tools, so only branch Diff received a real browser walkthrough. Existing workbench polish items remain: terminal ANSI decoration can appear in Pi extension status, and refreshed checkout summaries may add another transcript card. These do not remove any of the recovered controls and are not claimed fixed here. Old VM reachability and snapshot evidence were not revalidated.

## History preservation

The Agent integration is a normal merge. The unrelated Server history is attached with a tree-preserving merge after its gateway, browser, tests, scripts and documentation were explicitly integrated. This preserves both ancestry paths without overwriting the newer Host/Codex implementation. Generated pelican artwork from Agent history is excluded from the product tree; its original commits remain reachable. Historical deployment documents are marked superseded where source placement conflicts with ADR-0020.
