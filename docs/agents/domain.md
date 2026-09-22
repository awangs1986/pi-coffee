# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Layout

This repository uses a single-context layout:

- Root `CONTEXT.md` defines domain vocabulary.
- `docs/adr/` records architecture decisions.

## Before exploring, read these

- Read [CONTEXT.md](../../CONTEXT.md) before exploring the codebase.
- Read the [ADRs](../adr/) relevant to the area being changed.
- Follow [AGENTS.md](../../AGENTS.md) and the [documentation index](../index.md)
  to the relevant specialist specifications.

If a domain document is missing, proceed silently. Do not flag its absence or
create an empty placeholder. The `domain-modeling` skill maintains domain docs
when terminology or decisions are actually resolved.

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, tests, designs, and
implementation discussions. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it is invented terminology.
If it is a real vocabulary gap, note it for `domain-modeling`.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, identify the specific ADR and
explain why it should be reconsidered. Do not silently override an accepted decision.

Preserve the responsibility boundary between this Agent Runtime repository and
the independent `awangs/pi-coffee-server` repository.
