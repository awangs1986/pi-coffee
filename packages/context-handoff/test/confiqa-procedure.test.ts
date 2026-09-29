import { describe, expect, it } from 'vitest';
import { scoreConfiqaProcedure } from '../scripts/score-confiqa-procedure.mjs';

const marker = 'CONFIQA-QA-0007';
const expected = 'English';
const anchor = 'session/source/hash';
const boundary = Array.from({ length: 4 }, (_, i) =>
  ({ type: 'compaction', id: `c${i}` }));
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall',
    id, name, arguments: args }] },
});
const result = (id: string, content: unknown, isError = false) => ({ type: 'message', message: {
  role: 'toolResult', toolCallId: id, isError,
  content: [{ type: 'text', text: JSON.stringify(content) }],
} });
const search = call('s', 'handoff_evidence_search', { query: marker });
const found = result('s', { matches: [{ role: 'user', anchor }] });
const read = call('r', 'handoff_evidence_read', { anchor });
const verified = result('r', { role: 'user', anchor, integrity: 'verified',
  text: `${marker}: its official language is ${expected}` });
const write = call('w', 'write', { path: 'answer.json',
  content: JSON.stringify({ answer: expected }) });
const written = result('w', { ok: true });

describe('ConFiQA conversation procedure', () => {
  it('requires search, verified read, then answer write after boundary', () => {
    const score = scoreConfiqaProcedure([
      ...boundary, search, found, read, verified, write, written,
    ], marker, expected);
    expect(score.valid).toBe(true);
  });

  it('rejects a correct answer written before the required search', () => {
    const score = scoreConfiqaProcedure([
      ...boundary, read, verified, write, written, search, found,
      call('r2', 'handoff_evidence_read', { anchor }),
      result('r2', { role: 'user', anchor, integrity: 'verified',
        text: `${marker}: ${expected}` }),
    ], marker, expected);
    expect(score.valid).toBe(false);
    expect(score.firstEvidenceSearch).toBe(false);
    expect(score.noPrematureWrite).toBe(false);
  });

  it('rejects reading a different or unverified source', () => {
    const wrong = result('r', { role: 'user', anchor: 'other',
      integrity: 'verified', text: `${marker}: ${expected}` });
    const score = scoreConfiqaProcedure([
      ...boundary, search, found, read, wrong, write, written,
    ], marker, expected);
    expect(score.valid).toBe(false);
  });

  it('rejects a missing fourth boundary', () => {
    const score = scoreConfiqaProcedure([
      ...boundary.slice(0, 3), search, found, read, verified, write, written,
    ], marker, expected);
    expect(score.valid).toBe(false);
    expect(score.boundaryPresent).toBe(false);
  });

  it('accepts recovery after a blocked premature write while recording the attempt', () => {
    const blocked = call('blocked', 'write', {path:'answer.json',content:'{"answer":"old"}'});
    const rejected = result('blocked', {error:'Search original evidence first'}, true);
    const score = scoreConfiqaProcedure([
      ...boundary, blocked, rejected, search, found, read, verified, write, written,
    ], marker, expected);
    expect(score.valid).toBe(true);
    expect(score.blockedAnswerAttempts).toBe(1);
    expect(score.answerWrites).toBe(1);
  });

  it('requires the read result before a write proposed in the same tool batch', () => {
    const batch = { type:'message', message:{role:'assistant',content:[
      read.message.content[0], write.message.content[0],
    ]}};
    const score = scoreConfiqaProcedure([
      ...boundary, search, found, batch, verified, written,
    ], marker, expected);
    expect(score.valid).toBe(false);
    expect(score.noPrematureWrite).toBe(false);
  });
});
