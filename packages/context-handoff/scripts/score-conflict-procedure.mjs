// Independent procedure score for two equally authoritative conflicting sources.
const parsed = message => {
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
const verifiedText = reads => {
  const fragments = reads.map(read => {
    const {start,end,text} = read.result;
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        end - start !== Buffer.byteLength(text, 'utf8'))
      return {text};
    return {start,end,bytes:Buffer.from(text, 'utf8')};
  });
  const sections = fragments.filter(fragment => fragment.bytes)
    .sort((a,b) => a.start - b.start).reduce((merged, fragment) => {
      const last = merged.at(-1);
      if (!last || fragment.start > last.end) {
        merged.push({...fragment});
        return merged;
      }
      const overlap = last.end - fragment.start;
      if (overlap > 0 && !last.bytes.subarray(last.bytes.length - overlap)
        .equals(fragment.bytes.subarray(0, overlap))) {
        merged.push({...fragment});
        return merged;
      }
      if (fragment.end > last.end) {
        last.bytes = Buffer.concat([last.bytes,fragment.bytes.subarray(overlap)]);
        last.end = fragment.end;
      }
      return merged;
    }, []).map(section => section.bytes.toString('utf8'));
  return [...sections,...fragments.filter(fragment => !fragment.bytes)
    .map(fragment => fragment.text)];
};

export function scoreConflictProcedure(entries, markers, alternatives, options = {}) {
  if (!Array.isArray(markers) || markers.length !== 2 ||
      !Array.isArray(alternatives) || alternatives.length !== 2)
    throw Error('Two markers and two alternatives are required');
  const startAfter = options.startAfter ?? 'fourth-compaction';
  const answerPath = options.answerPath ?? 'answer.json';
  if (!['fourth-compaction','fifth-user'].includes(startAfter))
    throw Error('Unknown procedure boundary');
  const targetsAnswer = call => {
    const path = String(call.arguments?.path ?? '');
    return path === answerPath || path.endsWith(`/${answerPath}`);
  };
  const boundary = entries.findIndex((entry, index) =>
    startAfter === 'fourth-compaction'
      ? entry.type === 'compaction' &&
        entries.slice(0, index + 1).filter(item => item.type === 'compaction').length === 4
      : entry.type === 'message' && entry.message.role === 'user' &&
        entries.slice(0, index + 1).filter(item =>
          item.type === 'message' && item.message.role === 'user').length === 5);
  const results = new Map(entries.flatMap((entry, index) =>
    entry.type === 'message' && entry.message.role === 'toolResult'
      ? [[entry.message.toolCallId, {index, message:entry.message,
          data:parsed(entry.message)}]] : []));
  const calls = entries.flatMap((entry, index) =>
    entry.type === 'message' && entry.message.role === 'assistant' &&
    Array.isArray(entry.message.content)
      ? entry.message.content.filter(part => part.type === 'toolCall').map(part => {
          const result = results.get(part.id);
          return {index,name:part.name,arguments:part.arguments,
            success:result?.message?.isError === false,
            blocked:result?.message?.isError === true,
            resultIndex:result?.index,result:result?.data};
        }) : []).filter(call => indexAfter(call.index, boundary));
  const evidence = calls.filter(call => call.success &&
    ['search','read'].includes(operation(call)));
  const writes = calls.filter(call => call.name === 'write' && call.success &&
    targetsAnswer(call));
  const firstWrite = writes[0];
  const recovered = markers.map((marker, i) => {
    const searches = evidence.filter(call => operation(call) === 'search' &&
      String(call.arguments?.query ?? '').includes(marker) &&
      Array.isArray(call.result?.matches));
    return searches.some(search => search.result.matches.some(match => {
      if (match.role !== 'user') return false;
      const reads = evidence.filter(call => operation(call) === 'read' &&
        call.result?.integrity === 'verified' && call.result?.role === 'user' &&
        call.result?.anchor === match.anchor &&
        call.result?.anchor === call.arguments?.anchor &&
        typeof call.result?.text === 'string' &&
        search.resultIndex < call.index &&
        (!firstWrite || call.resultIndex < firstWrite.index));
      const sections = verifiedText(reads);
      return sections.some(text => text.includes(marker)) &&
        sections.some(text => text.includes(alternatives[i]));
    }));
  });
  const firstEvidenceSearch = evidence.length > 0 &&
    operation(evidence[0]) === 'search' && markers.some(marker =>
      String(evidence[0].arguments?.query ?? '').includes(marker));
  return {
    boundaryPresent: boundary >= 0,
    firstEvidenceSearch,
    recovered,
    answerWrites: writes.length,
    blockedAnswerAttempts: calls.filter(call => call.name === 'write' &&
      call.blocked && targetsAnswer(call)).length,
    valid: boundary >= 0 && firstEvidenceSearch && recovered.every(Boolean) &&
      writes.length > 0,
  };
}

function indexAfter(index, boundary) {
  return boundary >= 0 && index > boundary;
}
