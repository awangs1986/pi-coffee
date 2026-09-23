# Skills management in Web

Owner request, 2026-09-23. Server [#14](http://gitea:3000/awangs/pi-coffee-server/issues/14), Agent [#62](http://gitea:3000/awangs/pi-coffee/issues/62).
The [canonical Host contract](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/skill-management.md)
owns native directories, Git packages, revisions, file protection and activation.

## Browser experience

The upper-left PI Coffee menu contains **Skills**, alongside global project and
archive actions. Opening it uses the existing main content area, closes search /
review, and preserves the current conversation, socket and draft. Closing or
starting/selecting a Task returns to the normal shell. No persistent additional
sidebar, new theme or footer controls are introduced.

The page provides:

- Agent selector: Pi, Codex, Claude Code. Installation is explicit per engine.
- Scope selector: user-level or current Work checkout. Project scope is unavailable
  without an active Work task matching the selected Agent; it does not modify every
  independent clone of the same Project.
- Inventory: name, description, native path, source/ref/commit, managed vs read-only,
  enabled state and local-edit or missing-file problems. Refresh is explicit.
- Collapsed Git install form: clone URL, ref, Skill subdirectory. No credentials
  or dependency-install commands are requested in the browser.
- Managed actions: View, Update, Enable/Disable. Existing/manual/bundled Skills
  expose View only. SKILL.md is rendered as plain text, not executable HTML.
- Explicit Reload current task, enabled only when its fixed Agent matches. Host
  decides foreground/background safety. Writes never auto-abort/restart a run.

Async responses are scoped to the view/selection that requested them. Mutation
buttons disable while pending; uncertain writes are never automatically retried.
The UI reports failure and preserves the form for correction. A 404 from an older
Host produces an unavailable state, not fake inventory or local-only success.
Switching engines or scopes clears stale detail. No Skill contents are cached in
browser storage or persisted by Web Server.

Activation text is explicit: native files are installed on VM, guaranteed discovery
is on the next Agent process start; existing history is unchanged. Pi Chat retains
its zero-system-prompt contract and supports explicit `/skill:name` use. Pi's LSP
Skill stays Pi-only unless the user deliberately installs a separately suitable
package for another Agent.

## Gateway and acceptance

`POST /api/skills` uses the same Gitea session, origin validation and fixed Host
routing as `/api/workspace`. The gateway forwards the body/response and never
clones, installs, parses native Skill packages or owns enabled-state records.
Host rollout precedes Web rollout.

Tests run at the real controller and authenticated HTTP seams. Cover scope/action
payloads, preservation of drafts/runs, escaped detail, error/unavailable states,
stale response handling, and cross-origin rejection. Browser verification checks
actual VM install-to-discovery and compact 1280px / narrow / short layouts without
paid model calls. Fresh-clone npm run check and delivery evidence belong in #14.
