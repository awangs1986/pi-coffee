> Current SPEC revision 3 implementation: [plugin design](plugin-design.md) and [acceptance](plugin-acceptance.md). The content below remains historical.

> Historical import only. The owner restarted the project as a new Pi plugin.
> This document does not describe implementation progress against SPEC revision 2.

# Imported implementation and gaps

Date: 2026-09-24. Source: Coffee
`03ba7ea83e49cf94fab8a2ed317863b0f27be2ad`, branch `codex/pi-0-87-upgrade`.

## Runnable code

`src/context/handoff.ts` is imported unchanged and uses only Node built-ins.
Its three exported operations prepare, read and resolve a handoff packet.
`src/context/handoff-cli.ts` is the unchanged Coffee evidence-recovery CLI.
`test/handoff-packet.test.ts` contains the four unchanged synthetic core tests.

Preparation is disabled by default. When enabled, it selects at most 24 supplied
user/assistant text sources; each is redacted and capped at 3000 UTF-8 bytes.
The total synthesis input is bounded by a 24 KiB budget with instruction reserve.
The generated brief is limited to 8 KiB and the packet to 16 KiB. Preparation has
a 30-second cancellation deadline. The caller injects the synthesis operation;
the core itself does not connect to a model provider.

The brief includes objective, constraints, corrections, completed work with source
IDs, remaining work, next action, uncertainties and general source IDs. Validation
checks required fields and whether cited IDs belong to selected sources. It does
not establish entailment or independently verify completed-work claims.

The checkout fingerprint covers Git HEAD/branch, status/diff and bounded untracked
file content. Changes during synthesis reject the packet. Reading a packet marks
it stale when the current checkout fingerprint differs. A stale marker is not a
full semantic source-validity decision.

Packets and redacted source excerpts are staged and renamed into
`<dataRoot>/artifacts/handoffs/<packetId>/`. Scope/path checks keep them outside
the Git checkout and within the provided Conversation root. The library relies
on its trusted caller to provide the correct Conversation/dataRoot association.
Source hashes verify these saved excerpts, not the original unredacted transcript.
Recovery reads at most 4096 bytes and rejects invalid ranges, split UTF-8 characters
and altered saved source bytes. Explicit range selection is required for paging.

Packet writing uses rename but does not fsync its source files/directories; full
power-loss durability is not established. Host binding persistence separately
uses file/directory sync in the Coffee reference. No stronger durability guarantee
is added by this import.

## Coffee-specific implementation

See [integration README](../integrations/pi-coffee/README.md). The imported
extension chooses first/recent original messages and performs bounded synthesis.
On subsequent handoffs it recovers prior saved excerpts, avoiding direct recursive
summarization of generated briefs. Repeated selection/truncation can still lose
important original history.

P7 implements branch-local successful native Work compaction counts and the
third-success/next-threshold trigger. Host code waits for settled execution and
known-zero child activity, prepares a packet, saves a pending segment, restores
model/settings/main identity, and commits the stable Conversation binding.
Concurrent input/cancellation/code changes invalidate preparation. Recovery keeps
the committed segment or reports ambiguity; it does not replay uncertain actions.
The successor starts idle and history remains aggregated in one Conversation.

These sources depend on Coffee Harness, tool discovery, scheduler/resource state,
protocol and build layout. They are preserved as reference, not advertised as a
standalone plugin. Existing Coffee continues to own the live Host integration.

## Historical acceptance

The [original P7 acceptance report](http://gitea:3000/awangs/pi-coffee/src/commit/03ba7ea83e49cf94fab8a2ed317863b0f27be2ad/docs/testing/harness-p7-acceptance.md)
records Coffee's clean-clone result at source `9ac45a4`: 42 files / 346 tests.
That count is historical Coffee evidence and is not this repository's test count.

Its real-model pilot had 16 attempts / 8 pairs, with 10 request-budget failures
and 6 manual-compaction timeouts, yielding no complete successful pair. Six
successor transitions committed; that establishes neither task completion nor
semantic improvement. Native-only was retained, the candidate stayed default-off,
and P8 deployment was not executed. The pilot has not been rerun for this import.

## Remaining implementation

All CF-01–CF-05 folding adaptation and HF-01–HF-05 semantic improvements in
[SPEC.md](../SPEC.md) remain open. The existing core lacks full historical-source
search, reliable selection of older corrections, per-claim provenance/supersession,
and independent reconciliation with project specifications and verification.
Adding those capabilities is future development, not an accomplishment of moving
the files to this repository.
