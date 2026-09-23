# Compact workbench layout acceptance

Related: Server #4. This is a focused follow-up on main; the broader frontend
continuity changes in PR #5 are not included.

## Contract

Preserve the sidebar, conversation/composer and right review pane. Each pane
scrolls within the viewport. Header actions remain inside the conversation
column, using a second row when necessary. Buttons keep single-line labels.

For an existing task, the area below the composer occupies exactly one compact row:
immutable Agent, Chat/Work type, linked Gitea project path, and an up-arrow disclosure.
The disclosure opens an overlay above the row containing VM, local path, branch,
readiness, Details, Copy path, compaction. It must not
increase the footer height or push the composer upward. New or switched tasks
start collapsed. Long content scrolls within the overlay on short viewports.

Long values ellipsize without adding rows. Details exposes the full task ID,
Agent, VM, project, local path, current branch, readiness, remote-check timestamp
and creation error. Copy path uses the complete value. Creation-only repository
and starting-branch inputs remain available when creating a new Work task.
This supersedes the earlier always-expanded full-path presentation requirement;
the complete path remains accessible without increasing the input area's height.

## Diagnosis and evidence

The automatic minimum of the grid row allowed long sidebar/review lists to grow
beyond the viewport. At 1280×796 the deployed sidebar extended to roughly 989px,
and Checkout overlapped the review pane by about 57px. A synthetic fixture with
40 tasks and 90 changed files also reproduced the height defect (2519px at a
720px viewport height). A flat, nonwrapping header overflowed its narrow column.
The footer repeated disabled creation fields and freely wrapped metadata.

The fix constrains grid/flex minimum sizes, groups title/status and operations,
and uses a one-row task footer with upward disclosure. UI controls share compact sizes and typography;
conversation text remains readable. Long input uses a viewport-relative maximum.

Browser measurements through the in-app browser passed at 1440×900, 1280×796,
1110×640, 1100×640, 820×640, 390×844 and 1280×480 with sidebar expanded/collapsed.
No page overflow or out-of-column action was observed; the bound-task footer
initially measured 74.6px; the subsequent owner correction reduces it to 26px. Long input, mobile review closure and complete Details were
also checked. Desktop and mobile screenshots were visually inspected. The
existing narrow-screen review overlay behavior is retained.

The original compact-layout baseline passed 45 tests across 8 files. The browser controller regression now
checks removal of redundant creation inputs, full Details and restoration of
creation controls. Obsolete CSS assertions on exact composer radius/height were
removed; geometry is tested at the real browser seam instead.

## Reproduce from a fresh clone

```sh
npm ci --ignore-scripts
npm run check
node scripts/serve-layout-fixture.mjs
# In another terminal, with Playwright Chromium installed:
node scripts/smoke-compact-layout.mjs
```

The fixture binds loopback and serves the real public assets with synthetic Host
responses. No account, provider key, user transcript or VM write is needed.
`PLAYWRIGHT_EXECUTABLE_PATH` can select an existing Chromium installation.
`PI_COFFEE_LAYOUT_PORT` changes the fixture port. The checked-in geometry probe
matches the read-only measurements executed with the in-app browser; its
standalone Playwright driver is provided for repeatable operator/CI runs.

Deployment and clean-clone results are recorded in the linked Issue/PR. Broader
frontend continuity issues remain tracked in #4; this patch does not close them.

The Context Usage correction is specified in [Context Usage](spec/context-usage.md).

Global project/archive commands are in the upper-left PI Coffee menu; see
[Arena navigation and review](spec/arena-navigation.md).
