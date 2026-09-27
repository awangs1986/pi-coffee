# Pi native compaction source reference

This directory contains unmodified TypeScript source files from the MIT-licensed
Pi coding agent **0.87.1** release. The release tag resolves to commit
`f07218c4d4bbc12bef056a7058c3dd49dfe41abe` in
[`earendil-works/pi`](https://github.com/earendil-works/pi).

The source files were extracted from the published package's source maps and
compared byte-for-byte with the corresponding files at that upstream commit.
Their SHA-256 hashes and source paths are recorded in the repository's
[`provenance.json`](../../provenance.json). The upstream MIT license is preserved
in [`LICENSE`](LICENSE).

## Files

- `src/core/compaction/compaction.ts` and `utils.ts`: native summarization prompt,
  history selection, cut-point planning, and compaction generation.
- `src/core/agent-session.ts`: automatic/manual compaction entry points and
  session lifecycle.
- `src/core/session-manager.ts` and `messages.ts`: session projection and model
  message conversion used by compaction.

This is a read-only source snapshot for comparison. It is not compiled or loaded
by the Context-handoff plugin. The A arm runs the pinned Pi 0.87.1 package as its
native baseline; keep its Pi version and settings fixed when comparing results.
