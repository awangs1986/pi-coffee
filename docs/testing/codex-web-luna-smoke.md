# Codex Web Luna smoke test

This is a bounded, real-native deployment test, not a load test. Use the GitHub
`awangs1986/pi-coffee` **latest main** for both the Web Server and local Host.
Do not substitute an older Gitea checkout or the previously separate Server tree.

## Topology and prerequisites

- Web Server: the operator-designated LAN server.
- Host and Codex CLI: the operator's current computer, with its existing native login.
- The Web Server holds only the private Host transport credential and its own Web
  authentication configuration. Codex credentials remain on the local computer.
- Use a dedicated synthetic smoke workspace and conversation. Preserve other
  services, conversations, native configuration and login files.
- Resolve the requested Luna model against the installed Codex model catalog or
  supported local provider configuration. Record the exact model id. Do not
  silently fall back to another model if Luna is unavailable.

## Procedure

1. Fetch GitHub `main` into a clean local checkout. Record `git rev-parse HEAD`
   and verify it matches the GitHub main ref. Run `npm ci && npm run check`.
2. Deploy that same commit on the Web Server. Build there, preserve existing
   deployment secrets outside Git, and record the deployed commit. Use a
   recoverable release directory; do not overwrite an unrelated dirty checkout.
3. Start the local Host with `PI_COFFEE_AGENT=codex`, the existing native
   `PI_COFFEE_CODEX_HOME`, the exact Luna model and a dedicated test workspace.
   Bind the private Host transport with a strong token. Keep the token out of
   browser code and records. Configure Web to reach that Host over the LAN.
4. Verify Web and Host health, Web authentication and private transport routing.
   Confirm the visible model is Luna. These checks do not send a model prompt.
5. In the actual browser, open the deployed Web URL and a new synthetic
   conversation. Send **once**:
   `Reply exactly PI_COFFEE_LUNA_SMOKE_OK. Do not use tools or change files.`
6. Observe the native reply arrive through the page, the run settle, and the
   message remain after refreshing/reopening the same conversation. Do not resend
   after uncertain delivery: inspect the existing conversation/native result.
7. Re-read GitHub main and both deployment revisions. A successful result must
   identify the commit that was actually exercised; if main advanced before
   deployment, fetch and deploy the new main before the prompt.

## Evidence and verdict

Record only: GitHub/deployed/local revision, Codex CLI version, exact model,
Web URL, health/authentication outcome, whether the single prompt settled with
the synthetic marker, and whether reload retained it. A screenshot may show the
synthetic conversation only. Never record login files, tokens, cookies, passwords,
private project content or unrelated native history.

A PASS requires the real browser → deployed Web → local Host → native Codex →
Luna round trip and history reload. A fixture-only pass, a CLI-only response or a
healthy Web endpoint is insufficient. Record a concrete failure instead of
claiming success if native authentication, model availability or routing fails.

## Predeployment verification for the arena branch merge

The merge candidate contains the seven commits through `e72cc08b` plus focused
repairs verified with red → green public-seam tests:

- Malformed session signatures are rejected without crashing authentication.
- OAuth callbacks are bound to the initiating browser and cannot be replayed.
- Native thread ownership is checked before resuming or deleting a conversation.
- Transfer grants/events include the owning user even for identical session ids.
- File preparation, listing and download require a Host-issued grant.
- A native child closing its input pipe reports an error instead of an uncaught
  stream exception.

The clean installation's build and **126 tests in 19 files** passed on 2026-09-27.
The targeted follow-up review found no remaining blocking findings in these
repairs. Dependencies were unchanged: npm audit reports two existing test-tool
advisories (Vitest critical and its mocker moderate); no Vitest UI server is used
for this check or the production service. This predeployment result does not
claim that the real Luna smoke has already run.

