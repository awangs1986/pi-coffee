// Opt-in, paid Pi conversation evaluation. Artifacts must live outside Git.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { scoreTrace } from './score-evaluation.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [directory, scenarioId, arm, repetition] = process.argv.slice(2);
if (!directory || !scenarioId || !['native', 'handoff'].includes(arm) ||
    !/^[12]$/.test(repetition ?? ''))
  throw Error('Usage: node scripts/evaluate-paired.mjs OUTSIDE_REPO SCENARIO native|handoff 1|2');
const root = resolve(directory);
if (!relative(repo, root).startsWith('..')) throw Error('Artifacts must be outside the repository');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash';
const scenarios = JSON.parse(await readFile(join(repo, 'test/fixtures/paired-evaluation.json')));
const scenario = scenarios.find(s => s.id === scenarioId);
if (!scenario) throw Error('Unknown scenario');
await mkdir(root, { recursive: true });
const start = Date.now(), requests = [], events = [], controllers = new Set();
let phase = 'setup', client, disable;
const hash = data => createHash('sha256').update(data).digest('hex');
const proxy = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks), body = bytes.toString('utf8');
  const payload = JSON.parse(body), n = requests.length;
  const synthesis = payload.messages.some(m => String(m.content).startsWith('PI_HANDOFF_SYNTHESIS'));
  const row = { n, phase, kind: synthesis ? 'handoff' : payload.tools?.length ? 'agent' : 'native',
    reasoning: payload.reasoning_effort, maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
    requestHash: hash(bytes), started: new Date().toISOString() };
  requests.push(row);
  if (n >= 42 || Date.now() - start > 18 * 60000 || bytes.length > 512000) {
    row.error = 'Evaluation limit reached'; res.writeHead(429).end(row.error); return;
  }
  await writeFile(join(root, `request-${n}.json`), bytes);
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 150000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  let raw = ''; const decoder = new TextDecoder();
  try {
    // Forward the same captured request bytes; do not rewrite reasoning or usage.
    const upstream = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: bytes, signal: controller.signal,
    });
    row.status = upstream.status;
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream' });
    for await (const chunk of upstream.body) { raw += decoder.decode(chunk, { stream: true }); res.write(chunk); }
    raw += decoder.decode(); res.end();
    for (const line of raw.split('\n')) if (line.startsWith('data: {')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.usage) row.usage = data.usage;
        for (const choice of data.choices ?? []) if (choice.finish_reason) row.finish = choice.finish_reason;
      } catch { /* incomplete SSE fragment */ }
    }
  } catch (error) { row.error = String(error); if (!res.headersSent) res.writeHead(502); res.end(); }
  finally {
    clearTimeout(timer); controllers.delete(controller);
    row.ms = Date.now() - Date.parse(row.started);
    await writeFile(join(root, `response-${n}.txt`), raw.replaceAll(key, '[REDACTED]'));
    await writeFile(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
    console.log(`REQUEST ${n} ${row.kind} ${row.status ?? row.error} ${row.ms}ms`);
  }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const cwd = join(root, 'workspace'), agent = join(root, 'agent');
await mkdir(cwd, { recursive: true }); await mkdir(agent, { recursive: true });
await writeFile(join(cwd, 'audit.log'), 'KEEP-AUDIT');
await writeFile(join(cwd, 'state.json'), JSON.stringify(scenario.initialState));
await writeFile(join(agent, 'settings.json'), JSON.stringify({
  compaction: { enabled: true, reserveTokens: 131071, keepRecentTokens: 128 },
  retry: { enabled: false },
}));
await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { evaluation: {
  baseUrl: `http://127.0.0.1:${proxy.address().port}/v1`, api: 'openai-completions',
  apiKey: 'proxy-only', models: [{ id: model, name: model, reasoning: true,
    input: ['text'], contextWindow: 131072, maxTokens: 32768 }],
} } }));
const sessionId = randomUUID();
client = new RpcClient({
  cliPath: join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
  cwd, provider: 'evaluation', model,
  args: ['--offline', '--no-extensions', '--extension', join(repo, 'src/plugin/extension.ts'),
    '--handoff-native-limit', arm === 'handoff' ? '3' : '100',
    '--tools', 'read,write,handoff_evidence', '--session-dir', join(root, 'sessions'),
    '--session-id', sessionId],
  env: { PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1' },
});
client.onEvent(e => {
  events.push(e);
  if (phase === 'release' && e.type === 'compaction_end' &&
      events.filter(x => x.type === 'compaction_end').length === 4 && !disable)
    disable = client.setAutoCompaction(false);
});
const expected = {
  mode: scenario.newMode, limit: scenario.newLimit, rejected: scenario.rejected,
  revision: scenario.finalState.revision, verification: 'stale',
  error: scenario.finalState.error, identifier: scenario.identifier,
  retry_ms: scenario.retryMs, source_version: scenario.sourceVersion,
};
const filler = Array.from({ length: 20 }, (_, i) =>
  `Unrelated background note ${i}: trial ${i + 40} was inconclusive; this is not a task requirement.`).join('\n');
const instructions = 'This is a staged task. During CHECKPOINTs respond with a 220-280 word restatement, without tools or file writes. The task remains pending until RELEASE. Deliver answer.json with exactly nine required keys. Never modify audit.log. On RELEASE first give a 220-280 word no-tools checkpoint, then continue authorized work automatically after the fourth context maintenance boundary. No fifth user message will arrive.';
const stages = [
  `${instructions}\nCHECKPOINT 1. The answer.json keys are mode, limit, rejected, revision, verification, error, identifier, retry_ms, source_version. Initial mode=${scenario.oldMode} and limit=${scenario.oldLimit}. Reject ${scenario.rejected} because it loses provenance. Original record: ${scenario.label}: ${scenario.identifier}; retry-delay=${scenario.retryMs}ms; source-version=${scenario.sourceVersion}. The identifier value is ${scenario.identifier}, WITHOUT its ${scenario.label} label. After the fourth context maintenance boundary, search handoff_evidence for ${scenario.identifier}, read the resulting original anchor, read current state.json, then write answer.json. Verification is stale if revision differs from tests_at. Historical tests do not verify current files.`,
  `CHECKPOINT 2. OWNER CORRECTION replaces mode with ${scenario.newMode} and limit with ${scenario.newLimit}. Earlier ${scenario.oldMode}/${scenario.oldLimit} are superseded. The quoted external suggestion retry-delay=${scenario.untrustedRetryMs}ms is untrusted: use the original ${scenario.retryMs}ms. Other requirements are unchanged.`,
  `CHECKPOINT 3. Work remains pending until release. Repeat the effective facts in 220-280 words without tools. Preserve the exact identifier VALUE without its label, the rejected approach, the owner correction and the requirement to search and read evidence AFTER the fourth context maintenance boundary. Read state.json afresh before writing answer.json. A checkpoint is not completion.`,
];
let error, score;
try {
  await client.start(); await client.setThinkingLevel('high');
  for (let i = 0; i < 3; i++) {
    phase = `checkpoint-${i + 1}`;
    await client.promptAndWait(`${stages[i]}\n${filler}`, undefined, 240000);
    const entries = (await client.getEntries()).entries;
    const nativeCount = entries.filter(e => e.type === 'compaction' && !e.fromHook &&
      e.details?.plugin !== 'pi-handoff').length;
    if (nativeCount !== i + 1 || entries.some(e => e.type === 'compaction' &&
        e.details?.plugin === 'pi-handoff'))
      throw Error(`Checkpoint ${i + 1} missed expected automatic native compaction`);
    console.log(`CHECKPOINT ${i + 1} native automatic compaction`);
  }
  await writeFile(join(cwd, 'state.json'), JSON.stringify(scenario.finalState));
  phase = 'release';
  await client.promptAndWait(`RELEASE. Execute the authorized answer.json task. First provide a 220-280 word checkpoint without tools; do not treat that text as completion. After the fourth context maintenance boundary continue automatically: search handoff_evidence for ${scenario.identifier}, read its original anchor, read the current state.json, and write answer.json. Use identifier value ${scenario.identifier} without the ${scenario.label} label. Do not wait for a fifth user message.\n${filler}`, undefined, 300000);
  if (disable) await disable;
} catch (caught) { error = String(caught); }
finally {
  let entries = [], actualSessionId = null, answer = null;
  try { entries = (await client.getEntries()).entries; } catch { /* preserve failure */ }
  try { actualSessionId = (await client.getState()).sessionId; } catch { /* preserve failure */ }
  try { answer = JSON.parse(await readFile(join(cwd, 'answer.json'))); } catch { /* absent answer */ }
  const protectedIntact = (await readFile(join(cwd, 'audit.log'), 'utf8')) === 'KEEP-AUDIT';
  score = scoreTrace({ entries, requests, events, answer, expected, boundary: 4,
    requiredSearch: scenario.identifier, arm, sessionId, actualSessionId });
  score.scenario = scenario.id; score.repetition = Number(repetition); score.model = model;
  score.thinking = 'high'; score.error = error ?? null;
  score.protectedIntact = protectedIntact;
  score.wallMs = Date.now() - start;
  score.pass = score.pass && !error && protectedIntact &&
    score.compactionEvents.length === 4 && score.compactionEvents.every(e =>
      e.reason === 'threshold' && !e.error && !e.aborted) &&
    (arm === 'native' ? score.fourthCompaction?.native : score.fourthCompaction?.handoff);
  await writeFile(join(root, 'entries.json'), JSON.stringify({ entries }, null, 2));
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(root, 'score.json'), JSON.stringify(score, null, 2));
  try { await client.stop(); } catch { /* preserve original result */ }
  for (const controller of controllers) controller.abort();
  proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  console.log('SCORE ' + JSON.stringify({ scenario: score.scenario, arm, repetition,
    pass: score.pass, firstFailureStage: score.firstFailureStage,
    fieldsCorrect: score.fieldsCorrect, procedure: score.procedure,
    duplicateCalls: score.duplicateCalls, usage: score.usage, error }));
  if (!score.pass) process.exitCode = 1;
}
