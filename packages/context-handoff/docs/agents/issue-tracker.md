# Issue tracker: GitHub

Track new work in GitHub Issues for `awangs1986/context-handoff`:
https://github.com/awangs1986/context-handoff/issues.
Use the `gh` CLI with an explicit `--repo awangs1986/context-handoff` for
issue and pull-request operations; this checkout also has a Gitea remote.

`SPEC.md` remains the behavioral authority. Issues hold work requests,
acceptance criteria and discussion, and link to the relevant maintained spec.
Existing Gitea links identify historical work; follow their full URLs when
consulting that history. Issue numbers are scoped to their repository.

## Conventions

Write multiline issue bodies and comments to a temporary file, then pass
`--body-file <path>` so their content is preserved.

- **Create**: `gh issue create --repo awangs1986/context-handoff --title "..." --body-file <path>`.
- **Read**: `gh issue view <number> --repo awangs1986/context-handoff --json number,title,body,labels,comments,state,url`.
- **List**: `gh issue list --repo awangs1986/context-handoff --state open --json number,title,body,labels,comments`; use `--label` and `--state` filters as needed.
- **Comment**: `gh issue comment <number> --repo awangs1986/context-handoff --body-file <path>`.
- **Apply/remove labels**: `gh issue edit <number> --repo awangs1986/context-handoff --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --repo awangs1986/context-handoff`. Record the outcome in a comment when needed.
- **Label vocabulary**: read `docs/agents/triage-labels.md` when classifying or updating work.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, use the corresponding `gh pr` commands with the same explicit
repository. Read PR comments and diffs; for external-request triage, select
`authorAssociation` values `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`.
Apply the issue label vocabulary and states.

GitHub issues and PRs share a number space. For an ambiguous reference, try
`gh pr view <number> --repo awangs1986/context-handoff`, then
`gh issue view <number> --repo awangs1986/context-handoff`.

## Skill operations

- **Publish to the issue tracker**: create a GitHub issue.
- **Fetch the relevant ticket**: read its body, labels and comments using the command above.

## Wayfinding operations

Used by `/wayfinder`. The map is one issue; tickets are child issues.

- **Map**: create an issue labelled `wayfinder:map`, with Notes,
  Decisions-so-far and Fog sections.
- **Child ticket**: link it to the map through GitHub's sub-issues API.
  If unavailable, list the child in the map's task list and put
  `Part of #<map>` at the top of the child body. Use `wayfinder:<type>`,
  where type is `research`, `prototype`, `grilling` or `task`.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with
  `gh api --method POST repos/awangs1986/context-handoff/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Obtain the numeric database ID with
  `gh api repos/awangs1986/context-handoff/issues/<blocker> --jq .id`.
  It is different from the issue number and node ID.
  If dependencies are unavailable, use a `Blocked by: #<n>, #<n>` line.
  A ticket is unblocked when all blockers are closed.
- **Frontier**: list the map's open children, exclude assigned tickets and those
  with open blockers, then select the first remaining ticket in map order.
  Native `issue_dependencies_summary.blocked_by` counts open blockers;
  otherwise inspect each fallback blocker.
- **Claim**: `gh issue edit <number> --repo awangs1986/context-handoff --add-assignee @me`.
  Claim the ticket before making other tracker changes for that session.
- **Resolve**: comment with the result, close the child, and append a concise
  result and link to the map's Decisions-so-far section.
