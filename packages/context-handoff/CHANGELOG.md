# Changelog

## 0.2.0-experimental.4 — 2026-10-02

- Declare reviewed Pi 1.0 compatibility and update development runtime/typebox pins; retain installed-package coverage on 0.99.1.
- Preserve explicit Host-owned Handoff, native automatic compaction, evidence recovery and visible failure behavior. No new semantic-fidelity claim.

## 0.2.0-experimental.3 — 2026-09-29

- Validate Pi 0.99.1 and declare host-provided typebox as a peer dependency.
- Give Host full control of plugin enablement and Handoff timing; remove internal native-compaction counting and both scheduling flags.
- Preserve the public request marker, same-session installation, original-evidence recovery and generation budgets.
- Remove automatic continuation and native fallback; explicit failures reject, and Host owns retry/resumption decisions.
- Migrate Pi RPC acceptance to explicit calls; keep historical cadence evaluators from silently running invalid comparisons.
- Canonical source remains `pi-coffee/packages/context-handoff`; upgrading a consumer or deploying Host is separate.

## 0.2.0-experimental.2 — 2026-09-29

- Move canonical source to `awangs1986/pi-coffee/packages/context-handoff` and the identical Gitea mirror. Preserve independent package identity, runtime behavior and prior history.
- Install built release artifacts from the monorepo; this version changes packaging and source location only.

## 0.2.0-experimental.1 — 2026-09-29

- Default to explicit manual Handoff; native Pi owns automatic compaction.
- Preserve the same native session, Conversation and history.
- Add the public RPC marker, installed version query and per-entry plugin version.
- Cancel failed explicit Handoff instead of silently substituting native compaction.
- Retain cadence only as an explicitly selected historical evaluation policy.

This is engineering integration evidence, not a claim of improved semantic fidelity.

## 0.1.0 — historical baseline

Automatic configurable cadence, attributed Task State and evidence recovery.
Historical evaluations and their limitations remain in docs/.
