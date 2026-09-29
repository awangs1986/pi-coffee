// Historical runners assume plugin-owned cadence and automatic continuation.
// Stop before creating artifacts, children or provider requests. Scorers and
// recorded results remain usable; a new runner must schedule explicit requests.
throw new Error(
  "Historical cadence evaluator: incompatible with Host-owned Handoff (SPEC revision 7). " +
  "Use the original pinned evaluation revision for reproduction; new evaluations must " +
  "schedule HANDOFF_REQUEST explicitly in the driver. See docs/host-integration.md.",
);
