# Import verification

Date: 2026-09-24. This record covers the extracted handoff core, not Coffee's
complete runtime or a combined folding/Handoff candidate.

## Source preservation

Fourteen source/test files were copied from Coffee commit
`03ba7ea83e49cf94fab8a2ed317863b0f27be2ad` without edits. All destination SHA-256
values were checked against [provenance.json](../provenance.json). The snapshot
retains an existing extra EOF blank line in `src/host/agent-adapter.ts`; the
whitespace check reports it, and it is kept to preserve exact source hashes.
Maintained Markdown links resolve. Coffee's working
tree remained unchanged. Upstream context-fold was inspected only; its exact
package version/tarball/integrity is recorded in
[context-fold-source.json](context-fold-source.json).

## Extracted package checks

Environment: Node 22.23.2, npm 10.9.8, Linux; Git available to synthetic fixtures.

`npm run check` passed: TypeScript build and **1 test file / 4 existing tests**.
The tests cover attributed packet preparation, predecessor-source recovery,
redaction, checkout staleness, concurrent untracked-file changes, disabled
behavior, invalid provenance, output/range bounds, tampered excerpts and
pre-cancelled preparation. They do not call a real model.

The first fresh dependency resolution failed inside npm Arborist with
`Cannot read properties of null (reading 'edgesOut')`. Because installation had
failed, the attempted build also reported missing `tsc`. The lockfile was then
seeded from Coffee's pinned dependency graph and npm pruned unrelated dependencies;
installation and the check passed. The resulting committed lockfile defines this
package's smaller dependency graph. A subsequent `npm ci --ignore-scripts`
succeeded from that lockfile. No peer-validation bypass was used.

## Not established by this check

- Coffee Host/P7 integration tests are reference sources, excluded from this check.
- The historical 346 Coffee tests are not a new result for this repository.
- No real-model evaluation, semantic continuity comparison, deployment or change
  of production defaults was performed.
- Selected context-fold mechanisms have not been implemented in the imported core.
- Remote repository publication status is reported separately from local checks.
