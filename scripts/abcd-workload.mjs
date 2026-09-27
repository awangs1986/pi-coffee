// Deterministic long-context additions for the versioned ABCD fixture.
// Every emitted packet is sent as a normal Pi user turn; nothing is injected
// into a provider request or hidden in a session file.
import { createHash } from 'node:crypto';

const modules = ['identity', 'ledger', 'catalog', 'billing', 'scheduler', 'renderer', 'archive', 'gateway'];
const states = ['observed', 'reproduced', 'accepted', 'deferred', 'verified', 'pending', 'rejected', 'superseded'];
const files = ['reader', 'writer', 'index', 'policy', 'adapter', 'store', 'report', 'codec'];
const actions = [
  'retain the source identifier and verify the current file before writing',
  'keep completed work closed unless a later owner message reopens it',
  'compare the recorded value with the active revision before reporting success',
  'preserve the exact unit and punctuation in the evidence record',
  'leave the unresolved alternative explicit until authority selects one',
  'do not treat an older test result as current verification',
];

const hash = text => createHash('sha256').update(text).digest('hex');

function traceLine({ index, itemNumber, repetition, cycle }) {
  const n = String(index + 1).padStart(6, '0');
  const day = String(((index + cycle * 11) % 28) + 1).padStart(2, '0');
  const minute = String((index * 7 + cycle * 13) % 60).padStart(2, '0');
  const moduleName = modules[(index + itemNumber + cycle) % modules.length];
  const state = states[(index * 3 + repetition + cycle) % states.length];
  const file = `src/${moduleName}/${files[Math.floor(index / 8 + cycle) % files.length]}.ts`;
  const revision = `r${1 + ((index + itemNumber + cycle) % 37)}.${Math.floor(index / 37 + cycle) % 12}`;
  const metric = `${(index * 13 + cycle * 17) % 10000}ms/${1 + ((index + cycle) % 19)} samples`;
  const action = actions[(index + itemNumber + cycle) % actions.length];
  const ownerNote = (index + repetition + cycle) % 17 === 0 ? 'verify before edit' : 'no new instruction';
  return `TRACE-${n} | 2026-${String(7 + cycle).padStart(2, '0')}-${day}T${minute}:00Z | module=${moduleName} | path=${file} | revision=${revision} | state=${state} | metric=${metric} | action=${action} | owner-note=${ownerNote}`;
}

/** Build the frozen, identical user-prompt packets for one case/repetition/cycle. */
export function buildAbcdLoadPackets({ protocol, item, repetition, cycle }) {
  if (!Number.isInteger(repetition) || repetition < 1 || repetition > 3) throw new Error('Invalid repetition');
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > 4) throw new Error('Invalid cycle');
  const itemNumber = Number(item.id.slice(1, 3));
  const special = item.id.startsWith('D10-') && cycle === 1;
  const totalLines = special
    ? protocol.abcd.fillerLines['D10-first-boundary']
    : cycle === 1 ? protocol.abcd.fillerLines.firstBoundary
      : protocol.abcd.fillerLines.subsequentBoundaries;
  const chunkSize = protocol.abcd.fillerLinesPerUserMessage;
  const packets = [];
  for (let start = 0, part = 0; start < totalLines; start += chunkSize, part++) {
    const lines = Array.from({ length: Math.min(chunkSize, totalLines - start) }, (_, offset) =>
      traceLine({ index: start + offset, itemNumber, repetition, cycle }));
    const context = [
      `Historical engineering archive, cycle ${cycle}, packet ${part + 1}. These records are load-test context, not new requirements or owner decisions. Continue the original task and do not create files for this archive.`,
      ...lines,
      `END-ARCHIVE cycle=${cycle} packet=${part + 1} records=${lines.length}. Acknowledge only with CONTEXT-ACK-${itemNumber}-${repetition}-${cycle}-${part + 1}.`,
    ].join('\n');
    packets.push({ part: part + 1, lines: lines.length, content: context, sha256: hash(context), bytes: Buffer.byteLength(context) });
  }
  return { totalLines, packets };
}
