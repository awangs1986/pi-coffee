# ADR-0022: One Pi repository with independently versioned plugins

Accepted 2026-09-29 by the owner. Maintain Harness, LSP and Context Handoff under
`packages/` in GitHub `awangs1986/pi-coffee`, mirrored with identical history/layout
in Gitea `awangs/pi-coffee`. Keep `pi-coffee-server` independent. This refines the
Pi-side placement of ADR-0021 and supersedes standalone plugin source authority.

Separate repositories made source discovery and mirror/version coordination harder
than the plugin count warrants. A single repository keeps plugin boundaries through
independent manifests, lockfiles, public interfaces, tests, versions and immutable
release tarballs. We rejected different GitHub/Gitea layouts and nested repository
copies because they create another synchronization problem.

Import every standalone main through normal merge ancestry and retain original
releases. Preserve the previous aggregate under `compatibility/aggregate`; existing
consumers keep their explicit legacy pin until the corresponding integration is
separately migrated. Do not copy that legacy runtime over current Server code.

The root is private orchestration. Consumers install individual built artifacts,
not a Git dependency pretending to select a repository subdirectory. Namespaced
`harness/v…`, `lsp/v…`, `context-handoff/v…` tags identify independent releases.
Repository migration alone changes no native Agent behavior or deployed service.
