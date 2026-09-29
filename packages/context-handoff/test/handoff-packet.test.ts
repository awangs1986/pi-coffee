import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareHandoff, readHandoff, resolveHandoffEvidence } from '../src/context/handoff.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'coffee-handoff-')); const workspace = join(root, 'checkout'); const dataRoot = join(root, 'data');
  mkdirSync(workspace); mkdirSync(dataRoot); writeFileSync(join(workspace, 'app.txt'), 'before\n');
  execFileSync('git', ['init', '-q'], { cwd: workspace }); execFileSync('git', ['add', '.'], { cwd: workspace });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: workspace });
  const options = { enabled: true, conversationId: 'conversation-a', sourceSessionId: 'segment-two', dataRoot, workspace,
    sources: [{ sessionId: 'segment-one', entryId: 'user-original', role: 'user' as const, text: 'Keep the public API unchanged. api_key=fixture-secret' }, { sessionId: 'segment-two', entryId: 'assistant-current', role: 'assistant' as const, text: 'The compiler check passed; next inspect the diff.' }],
    synthesize: async (_input: string, _signal: AbortSignal) => JSON.stringify({ objective: 'Fix the implementation', constraints: ['Preserve API'], corrections: [], completed: [{ text: 'Compiler passed', sources: ['assistant-current'] }], remaining: ['Inspect diff'], nextAction: 'Inspect diff', uncertainties: [], sources: ['user-original', 'assistant-current'] }),
  };
  return { root, options };
}
it('prepares a bounded attributed packet and recovers an original decision from a predecessor session', async () => {
  const { root, options } = fixture(); let input = '';
  try {
    const prepared = await prepareHandoff({ ...options, synthesize: async (text, signal) => { input = text; return options.synthesize(text, signal); } });
    expect(prepared.status).toBe('ready'); expect(input).not.toContain('fixture-secret');
    const current = await readHandoff({ ...options, packetId: prepared.packetId! });
    expect(current.status).toBe('current'); expect(current.packet.predecessorSessionId).toBe('segment-two');
    expect(Buffer.byteLength(JSON.stringify(current.packet))).toBeLessThanOrEqual(16384);
    const evidence = await resolveHandoffEvidence({ ...options, packetId: prepared.packetId!, anchorId: 'user-original', offset: 0, length: 1024 });
    expect(evidence.sessionId).toBe('segment-one'); expect(evidence.text).toContain('Keep the public API unchanged'); expect(evidence.text).not.toContain('fixture-secret');
    writeFileSync(join(options.workspace, 'app.txt'), 'changed\n');
    expect((await readHandoff({ ...options, packetId: prepared.packetId! })).status).toBe('stale');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('refuses a packet if an untracked file changes while synthesis is in flight', async () => {
  const { root, options } = fixture(); const file = join(options.workspace, 'new.txt'); writeFileSync(file, 'first');
  try {
    await expect(prepareHandoff({ ...options, synthesize: async (input, signal) => { writeFileSync(file, 'other'); return options.synthesize(input, signal); } })).rejects.toThrow('Checkout changed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('leaves native-only operation inert and rejects forged provenance, oversized generation and altered evidence', async () => {
  const { root, options } = fixture();
  try {
    expect(await prepareHandoff({ ...options, enabled: false, synthesize: async () => { throw new Error('must not call model'); } })).toEqual({ status: 'disabled' });
    await expect(prepareHandoff({ ...options, synthesize: async () => 'x'.repeat(9000) })).rejects.toThrow('exceeds');
    await expect(prepareHandoff({ ...options, synthesize: async (input, signal) => (await options.synthesize(input, signal)).replaceAll('assistant-current', 'invented-source') })).rejects.toThrow('source');
    const prepared = await prepareHandoff(options);
    await expect(readHandoff({ ...options, conversationId: 'foreign', packetId: prepared.packetId! })).rejects.toThrow('Foreign');
    await expect(resolveHandoffEvidence({ ...options, packetId: prepared.packetId!, anchorId: '../escape' })).rejects.toThrow('identifier');
    await expect(resolveHandoffEvidence({ ...options, packetId: prepared.packetId!, anchorId: 'user-original', length: 5000 })).rejects.toThrow('range');
    writeFileSync(join(options.dataRoot, 'artifacts/handoffs', prepared.packetId!, 'user-original.txt'), 'tampered');
    await expect(resolveHandoffEvidence({ ...options, packetId: prepared.packetId!, anchorId: 'user-original' })).rejects.toThrow('altered');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('does not start a model call when preparation was already cancelled', async () => {
  const { root, options } = fixture(); let calls = 0;
  try {
    await expect(prepareHandoff({ ...options, signal: AbortSignal.abort(), synthesize: async () => { calls++; return '{}'; } })).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
