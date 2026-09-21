# PI Coffee development workflow

## Start

```bash
git clone http://testpc:3000/awangs/pi-coffee.git
cd pi-coffee
npm install
npm run check
```

The remote `main` is populated. If a future repository migration is ever empty, use the handoff attachment or ask the repository owner to push the versioned baseline before beginning implementation.

## Choose work

Read [`BACKLOG.md`](../../BACKLOG.md), then the relevant Gitea Issue first. The current MVP Issues are [#1–#5](http://testpc:3000/awangs/pi-coffee/issues). The 0.1 contract is [`docs/spec/0.1.md`](../spec/0.1.md). Keep one active ticket per change and post evidence before closing it.

## Code seams

- `src/shared/protocol.ts`: versioned Frame codec and limits.
- `src/host/pi-adapter.ts`: only Pi-specific adapter seam.
- `src/host/session.ts`: Session ownership, cursor, and replay.
- `src/host/server.ts`: private Host transport.
- `src/web/host-client.ts`: Web → Host transport adapter.
- `src/web/server.ts`: browser Bridge and static shell.

Tests should cross these public seams. Prefer a fake adapter or local stub over a real credential in CI.

Use TypeScript/Node for the first implementation. Consider a Rust module only after a measured performance bottleneck is recorded in a ticket; language changes must not widen the Pi or transport seams.

## Specification maintenance

For Pi Agent work, start with the living [main SPEC](../spec/pi-agent.md) and the relevant specialist contract, such as the [Work prompt SPEC](../spec/harness-prompt.md). These are maintained in place; dated reviews preserve evidence, not competing specifications.

Every confirmed discussion decision and behavior change must remain traceable:

- Record the requirement ID (PA/WP), reason and whether it is an owner decision, engineering baseline or unresolved proposal. Never promote an unconfirmed tool list or parameter to an accepted decision.
- Keep target behavior, current implementation, local test results and real-model/deployment acceptance separate. Fixing code without changing the design still requires updating the affected implementation/evidence status when it changes.
- Maintain acceptance criteria in the SPEC. Link dated test/review evidence; update examples with their real tool schemas. A text assertion or stub test is not evidence that a model follows instructions.
- Mark superseded decisions and link their replacement. Update entrypoints and cross-references rather than adding another contradictory “latest decision” banner.
- If Gitea is unreachable, record the pending synchronization locally. Do not claim the Issue was read, updated, accepted or closed. Never include credentials or complete private transcripts.

Current product-mode documentation uses Chat/Work only. Superseded mode text lives in Git history; filenames and source citations may preserve historical names. The Markdown contract check runs within `npm run check`.

## Change loop

1. Read the current SPEC and Issue; identify the requirement and existing evidence. Record newly confirmed decisions or unresolved questions before implementation.
2. For behavior changes, write a failing test at the public seam; implement the smallest complete change. For documentation-only work, validate links, traceability and conflicting statements instead of inventing a runtime test.
3. Run `npm run check`; run relevant loading, browser or deployment probes when that seam changes. Report exactly which evidence is local, simulated or real.
4. Update the maintained SPEC, its implementation/acceptance status and decision history in the same change; keep reference/version and actual command evidence in the linked review.
5. Synchronize the Gitea Issue when available; commit/push only as authorized, and close a ticket only after the repository completion criterion is satisfied.

## Scope guardrails

Keep this repository independent. V5 is a frozen reference, not a dependency or a patch target. Do not add sandbox/permission machinery to compensate for VM isolation. Do not put secrets, complete transcripts, image bodies, or VM credentials into docs or tickets.
