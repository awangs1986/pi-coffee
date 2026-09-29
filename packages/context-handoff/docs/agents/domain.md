# Domain Docs

This repository uses a single context: root `CONTEXT.md` and root `docs/adr/`.

## Before exploring

Read `CONTEXT.md` for domain vocabulary and the ADRs in `docs/adr/` that
touch the area of work. `SPEC.md` remains the behavioral authority, as recorded
in `AGENTS.md`.

If a domain document or ADR directory is absent, proceed silently.
The `domain-modeling` skill creates these lazily when terms or decisions
are resolved.

## File structure

- `CONTEXT.md`: shared domain vocabulary.
- `docs/adr/`: architecture decisions for this repository.

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, proposals, hypotheses,
tests and maintained documentation. Respect its listed synonyms to avoid.
If a needed concept is absent, reconsider the proposed term or note a real gap
for `domain-modeling`.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, identify the ADR and explain why
the decision should be reconsidered.
