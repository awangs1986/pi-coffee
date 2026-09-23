# Context Usage and compact task information

Owner correction, 2026-09-23. Tracked in [Server #4](http://gitea:3000/awangs/pi-coffee-server/issues/4).

## Required presentation

Reproduce the supplied reference's information structure: title `Context Usage`
and close X; `N% Full` at left and `~used / capacity Tokens` at right; one
segmented capacity bar; seven aligned rows with a square swatch, label and
right-aligned token count:

1. System prompt — gray.
2. Tool definitions — purple.
3. Rules — green.
4. Skills — ochre.
5. MCP & dynamic tools — magenta.
6. Subagent definitions — blue.
7. Conversation — red.

Counts describe model-visible context, not accumulated input/output/cache billing.
The [Agent attribution contract](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/context-usage.md)
owns counting, categories, source attribution and accuracy. The browser consumes
only numeric metadata. `~` identifies a local text-token estimate; the capacity
label tooltip exposes the method, last-request/preview basis and timestamp.
Missing measurements display unavailable markers, never invented zero counts.
Media omissions are visible. Codex/Claude controls remain capability-gated.

Open only on clicking the usage chip, not hover/focus. Use a native modal dialog
in the browser top layer, outside the header's filtered stacking context. Close
with X, Escape or backdrop and return focus to the trigger. It must remain inside
the viewport, with internal scrolling on short screens and no conversation/code
painting over the panel. Preserve the surrounding three-pane layout.

## Task footer

An existing task shows one row: immutable Agent, Chat/Work, linked Gitea project
path and an up-arrow disclosure. VM, complete local path, branch, sync status,
Details/Copy and management actions move into the upward overlay. The overlay
scrolls within short viewports and never changes composer/footer geometry.
Switching tasks restores the collapsed state. No visible “Manage” text button.
Creation-only project/branch selectors stay in the new-task flow. Compaction is
an explicit task-details action, separate from viewing usage.

This supersedes the former three-row footer and roadmap's click-to-compact entry.

## Regression evidence

`npm run check` tests actual browser controller behavior through Host frames:
seven categories, source snapshot vs cumulative stats, explicit open/close,
unavailable values and task transitions. `scripts/smoke-compact-layout.mjs`
checks native modal/top-layer state, seven labels, viewport bounds, Escape/focus,
and the one-row footer using the synthetic fixture. It requires no credentials,
user transcript or model call. Browser screenshots additionally verify painting;
DOM hit testing alone did not reveal the original compositing defect.
