// Structural checks for the frozen 250k ABCD fixture and deterministic workload.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAbcdLoadPackets } from './abcd-workload.mjs';
import { materialize } from './drift-probes.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = JSON.parse(await readFile(resolve(repo, 'test/fixtures/abcd-250k-v1.json'), 'utf8'));
const protocol = fixture.protocol?.abcd;
if (protocol?.id !== 'abcd-250k-v1' || protocol.targetTokens !== 250000 ||
    JSON.stringify(protocol.admissionBand) !== JSON.stringify([245000, 255000]))
  throw new Error('ABCD target or admission band changed');
if (fixture.items?.length !== 13 || new Set(fixture.items.map(item => item.id)).size !== 13)
  throw new Error('Expected 13 uniquely named ABCD cases');
if (JSON.stringify(protocol.cycleTurnIndexes) !== JSON.stringify([[0, 1], [2, 3], [4, 5], [6]]))
  throw new Error('Cycle turn mapping changed');

const seenTurns = protocol.cycleTurnIndexes.flat();
if (JSON.stringify([...seenTurns].sort((a, b) => a - b)) !== JSON.stringify([0, 1, 2, 3, 4, 5, 6]))
  throw new Error('Cycle mapping must cover each of the seven original turns exactly once');

for (const item of fixture.items) {
  if (!/^D(?:0[1-9]|1[0-3])-.+-250k-v1$/.test(item.id) || item.turns?.length !== 7 ||
      item.turns.some(turn => typeof turn !== 'string' || !turn.trim()) ||
      typeof item.final !== 'string' || !item.final.trim() ||
      !item.expected || (!Object.keys(item.expected).length && !(item.invariants?.length)))
    throw new Error(`Malformed case: ${item.id}`);
  const joined = [...item.turns, item.final].join('\n').toLowerCase();
  if (['handoff', 'compaction', 'handoff_evidence', 'context maintenance', 'boundary']
    .some(term => joined.includes(term)))
    throw new Error(`Maintenance vocabulary leaks into user fixture: ${item.id}`);
  for (const checkpoint of item.checkpoints ?? [])
    if (!Number.isInteger(checkpoint.afterTurn) || checkpoint.afterTurn < 1 || checkpoint.afterTurn > 7)
      throw new Error(`Invalid setup checkpoint in ${item.id}`);
  const instance = materialize(fixture, item, { extraNoise: 0 });
  if (instance.turns.length !== 7 || !instance.files || !Object.keys(instance.files).length)
    throw new Error(`Case materialization failed: ${item.id}`);
  for (let cycle = 1; cycle <= 4; cycle++) {
    const first = buildAbcdLoadPackets({ protocol: fixture.protocol, item, repetition: 1, cycle });
    const repeated = buildAbcdLoadPackets({ protocol: fixture.protocol, item, repetition: 1, cycle });
    const independent = buildAbcdLoadPackets({ protocol: fixture.protocol, item, repetition: 2, cycle });
    if (first.totalLines !== (item.id.startsWith('D10-') && cycle === 1
      ? protocol.fillerLines['D10-first-boundary']
      : cycle === 1 ? protocol.fillerLines.firstBoundary : protocol.fillerLines.subsequentBoundaries))
      throw new Error(`Wrong filler count: ${item.id}, cycle ${cycle}`);
    if (first.packets.length !== Math.ceil(first.totalLines / protocol.fillerLinesPerUserMessage) ||
        first.packets.some((packet, index) => packet.sha256 !== repeated.packets[index]?.sha256))
      throw new Error(`Workload is not stable: ${item.id}, cycle ${cycle}`);
    if (first.packets.every((packet, index) => packet.sha256 === independent.packets[index]?.sha256))
      throw new Error(`Repetition seed did not change workload: ${item.id}, cycle ${cycle}`);
  }
}

const selected = ['D01', 'D05', 'D07', 'D10'];
for (const prefix of selected) if (!fixture.items.some(item => item.id.startsWith(`${prefix}-`)))
  throw new Error(`Missing predeclared pilot case ${prefix}`);
console.log(`ABCD_FIXTURE_VALID ${protocol.id}: 13 cases, 7 turns, 4 cycles, deterministic repetitions`);
