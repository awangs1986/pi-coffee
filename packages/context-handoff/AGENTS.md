# Context Handoff maintenance

Read README.md, SPEC.md, CONTEXT.md and docs/implementation-status.md before changes.
Use Chinese for owner discussion and English for maintained documentation.

- SPEC.md is the behavioral authority for this repository. Separate accepted
  direction, proposed engineering choices, implemented behavior and evidence.
- Treat SPEC revision 2 as a fresh plugin contract. Imported Coffee code/tests are historical reference only; they are not an implementation baseline.
- Keep Pi core unmodified. Folding, native summary compaction and Handoff are
  separate mechanisms; Coffee P7 is a Host rollover implementation.
- Keep the integration reference pinned; do not silently edit snapshot files.
  Changes to runnable imported code must be documented against provenance.json.
- Do not treat this import as authorization to activate a candidate, deploy Coffee,
  change production models, or rerun real-model evaluations.
- Keep original transcripts, evidence bodies, credentials and generated runtime
  packets out of Git. Only synthetic fixtures belong in this repository.
- For behavioral changes, test the public interface and run npm run check.
  Preserve failures and report the actual check scope; do not equate packet
  integrity with correct task continuation.
- Attribute any copied/adapted third-party source and retain its original license.

## Agent skills

### Issue tracker

Track work in GitHub Issues for `awangs1986/context-handoff`. Before tracker operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels, including `ready-for-agent` for fully specified agent work. Before classifying issues, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single context: root `CONTEXT.md` and `docs/adr/`. Before exploring domain concepts or decisions, read `docs/agents/domain.md`.

### Language

The skills are written in English. Reply, ask questions, and report in the language the user writes in. Documents the skills write (specs, tickets, `CONTEXT.md`, ADRs, review findings) follow the language the project's docs already use; if there are none yet, the user's language. Skill names, commands, code identifiers, and file paths stay as they are.
