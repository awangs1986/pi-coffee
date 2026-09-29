// Pure scoring of a real Pi conversation. Expected outcomes come from the
// scenario fixture, never from the generated Task State or final answer.
const calls = entries => entries.flatMap((entry, index) =>
  entry.type === 'message' && entry.message.role === 'assistant' &&
  Array.isArray(entry.message.content)
    ? entry.message.content.filter(c => c.type === 'toolCall')
      .map(c => ({ index, name: c.name, arguments: c.arguments }))
    : []);

export function scoreTrace({ entries, requests, events, answer, expected, boundary,
                             requiredSearch, requiredRead, arm, sessionId, actualSessionId }) {
  const compactions = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === 'compaction');
  const handoffs = compactions.filter(({ entry }) => entry.details?.plugin === 'pi-handoff');
  const fourth = compactions[3];
  const split = fourth?.index ?? entries.length;
  const allCalls = calls(entries);
  const before = allCalls.filter(c => c.index < split);
  const after = allCalls.filter(c => c.index > split);
  const assistantAfter = entries.slice(split + 1).some(e =>
    e.type === 'message' && e.message.role === 'assistant');
  const operation = (c, action) =>
    c.name === `handoff_evidence_${action}` ||
    c.name === 'handoff_evidence' && c.arguments?.action === action;
  const afterSearch = after.filter(c => operation(c, 'search') &&
    String(c.arguments?.query ?? '').includes(requiredSearch));
  const afterRead = after.filter(c => operation(c, 'read'));
  const readAfterSearch = afterRead.some(r => afterSearch.some(s => s.index < r.index));
  const correct = Object.fromEntries(Object.entries(expected).map(([key, value]) =>
    [key, JSON.stringify(answer?.[key]) === JSON.stringify(value)]));
  const exactKeys = answer && Object.keys(answer).length === Object.keys(expected).length;
  const handoffState = handoffs[0] ? (() => {
    try { return JSON.parse(handoffs[0].entry.summary).state; } catch { return null; }
  })() : null;
  const nativeSummary = arm === 'native' && fourth ? String(fourth.entry.summary ?? '') : null;
  const nativeSummaryIndicators = nativeSummary === null ? null : {
    identifierPresent: nativeSummary.includes(expected.identifier),
    correctedModePresent: nativeSummary.includes(String(expected.mode)),
    correctedLimitPresent: nativeSummary.includes(String(expected.limit)),
    rejectedApproachPresent: nativeSummary.includes(String(expected.rejected)),
    recoveryProcedureMentioned: /search|recover|original|evidence/i.test(nativeSummary),
  };
  const exactRecord = handoffState?.exactValues?.find(x => x.field === 'identifier');
  const pendingSearch = handoffState?.steps?.find(x =>
    x.phase === 'after_handoff' && x.status === 'pending' &&
    (x.text.includes(requiredSearch) || x.authorization?.quote?.includes(requiredSearch)) &&
    /search/i.test(x.text));
  const stateChecks = arm === 'handoff' ? {
    statusActive: handoffState?.status === 'active',
    exactIdentifier: exactRecord?.value === expected.identifier,
    exactLabelSeparated: !!exactRecord && exactRecord.value !== exactRecord.quote,
    postBoundarySearchPending: !!pendingSearch,
    nextActionMatchesFirstPending: !!pendingSearch &&
      handoffState.nextAction === handoffState.steps.find(x => x.status === 'pending')?.text,
  } : null;
  const signatures = new Map();
  for (const c of after) {
    const key = JSON.stringify([c.name, c.arguments]);
    signatures.set(key, (signatures.get(key) ?? 0) + 1);
  }
  const duplicateCalls = [...signatures.values()].reduce((n, count) => n + Math.max(0, count - 1), 0);
  const usage = requests.reduce((sum, row) => {
    sum.inputTokens += row.usage?.prompt_tokens ?? 0;
    sum.outputTokens += row.usage?.completion_tokens ?? 0;
    sum.reportedRequests += row.usage ? 1 : 0;
    return sum;
  }, { inputTokens: 0, outputTokens: 0, reportedRequests: 0 });
  const fieldsCorrect = Object.values(correct).filter(Boolean).length;
  const synthesis = requests.filter(r => r.kind === 'handoff');
  const stage = !fourth && synthesis.some(r => r.finish === 'length')
    ? 'handoff_synthesis_truncated'
    : !fourth && synthesis.length ? 'handoff_synthesis_or_validation_failed'
    : !fourth ? 'boundary_not_reached'
    : arm === 'handoff' && handoffs.length !== 1 ? 'handoff_not_installed'
    : arm === 'handoff' && Object.values(stateChecks).some(x => !x) ? 'handoff_state'
    : arm === 'native' && !assistantAfter ? 'native_not_resumed'
    : fieldsCorrect !== Object.keys(expected).length || !exactKeys ||
      !afterSearch.length || !readAfterSearch ? 'continuation'
    : 'none';
  return {
    arm, boundary, sessionStable: actualSessionId === sessionId,
    fourthCompaction: fourth ? {
      native: fourth.entry.details?.plugin !== 'pi-handoff',
      handoff: fourth.entry.details?.plugin === 'pi-handoff',
    } : null,
    nativeCount: compactions.filter(({ entry }) => !entry.fromHook &&
      entry.details?.plugin !== 'pi-handoff').length,
    handoffCount: handoffs.length,
    userMessages: entries.filter(e => e.type === 'message' && e.message.role === 'user').length,
    compactionEvents: events.filter(e => e.type === 'compaction_end')
      .map(e => ({ reason: e.reason, aborted: e.aborted, error: e.errorMessage })),
    stateChecks, state: handoffState,
    nativeSummaryIndicators,
    answer, correct, fieldsCorrect, fieldsTotal: Object.keys(expected).length,
    exactKeys: !!exactKeys,
    procedure: {
      searchBefore: before.filter(c => operation(c, 'search')).length,
      searchAfter: afterSearch.length,
      readAfter: afterRead.length,
      readAfterSearch,
    },
    toolCallsAfter: after.length, duplicateCalls,
    modelRequests: requests.length,
    synthesisAttempts: synthesis.map(r => ({ finish: r.finish, status: r.status,
      maxTokens: r.maxTokens, ms: r.ms })),
    elapsedMs: requests.reduce((n, row) => n + (row.ms ?? 0), 0),
    usage,
    cost: { currency: 'USD', actualBilled: null,
      note: 'Provider price and billed amount unavailable; compare reported tokens only.' },
    firstFailureStage: stage,
    pass: stage === 'none' && actualSessionId === sessionId &&
      entries.filter(e => e.type === 'message' && e.message.role === 'user').length === 4,
  };
}
