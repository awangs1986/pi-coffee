// Pure, independent scoring of the required post-boundary evidence procedure.
const parsedResult = message => {
  const raw = message?.content?.find?.(part => part.type === 'text')?.text;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
};
const operation = call => {
  if (call.name === 'handoff_evidence_search') return 'search';
  if (call.name === 'handoff_evidence_read') return 'read';
  if (call.name === 'handoff_evidence') return call.arguments?.action;
  return null;
};

export function scoreConfiqaProcedure(entries, marker, expected) {
  const compactions = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === 'compaction');
  const boundary = compactions[3]?.index ?? entries.length;
  const results = new Map(entries.flatMap((entry, index) =>
    entry.type === 'message' && entry.message.role === 'toolResult'
      ? [[entry.message.toolCallId, { index, message: entry.message,
          data: parsedResult(entry.message) }]] : []));
  const calls = entries.flatMap((entry, index) =>
    entry.type === 'message' && entry.message.role === 'assistant' &&
    Array.isArray(entry.message.content)
      ? entry.message.content.map((call, offset) => ({ entry, index, offset, call }))
        .filter(({ call }) => call.type === 'toolCall')
        .map(({ index, offset, call }) => ({ index, offset, id: call.id,
          name: call.name, arguments: call.arguments,
          resultIndex: results.get(call.id)?.index,
          success: results.get(call.id)?.message?.isError === false,
          blocked: results.get(call.id)?.message?.isError === true,
          result: results.get(call.id)?.data }))
      : []).filter(call => call.index > boundary);
  const evidence = calls.filter(call => call.success &&
    (operation(call) === 'search' || operation(call) === 'read'));
  const searches = evidence.filter(call => operation(call) === 'search' &&
    String(call.arguments?.query ?? '').includes(marker) &&
    Array.isArray(call.result?.matches) && !call.result?.error);
  const reads = evidence.filter(call => operation(call) === 'read' &&
    call.result?.integrity === 'verified' && call.result?.role === 'user' &&
    call.result?.anchor === call.arguments?.anchor &&
    String(call.result?.text ?? '').includes(marker) &&
    String(call.result?.text ?? '').includes(expected));
  const writeAttempts = calls.filter(call => call.name === 'write' &&
    /(^|\/)answer\.json$/.test(String(call.arguments?.path ?? '')));
  const writes = writeAttempts.filter(call => call.success);
  const matchingRead = (search, read) => search.resultIndex < read.index &&
    search.result.matches.some(match => match.role === 'user' &&
      match.anchor === read.arguments?.anchor);
  const firstEvidenceSearch = !!evidence.length && searches[0] === evidence[0];
  const verifiedReadAfterSearch = searches.some(search =>
    reads.some(read => matchingRead(search, read)));
  const validChain = searches.some(search => reads.some(read =>
    matchingRead(search, read) && writes.some(write => read.resultIndex < write.index)));
  const firstWrite = writes[0];
  const noPrematureWrite = !firstWrite || searches.some(search => reads.some(read =>
    matchingRead(search, read) && read.resultIndex < firstWrite.index));
  return {
    boundaryPresent: boundary < entries.length,
    firstEvidenceSearch, verifiedReadAfterSearch,
    writeAfterVerifiedRead: validChain, noPrematureWrite,
    valid: boundary < entries.length && firstEvidenceSearch &&
      verifiedReadAfterSearch && validChain && noPrematureWrite,
    searchCalls: searches.length, verifiedReadCalls: reads.length,
    answerWrites: writes.length,
    blockedAnswerAttempts: writeAttempts.filter(call => call.blocked).length,
  };
}
