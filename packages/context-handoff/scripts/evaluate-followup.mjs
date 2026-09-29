import './legacy-cadence-evaluation.mjs';
// Give both arms the same fifth user prompt after scoring no-prompt continuation.
// This measures what the retained context can recover when explicitly resumed.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scoreTrace } from './score-evaluation.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Supply an existing paired-run artifact directory');
const initial = JSON.parse(await readFile(join(root, 'score.json')));
const scenario = JSON.parse(await readFile(join(repo, 'test/fixtures/paired-evaluation.json')))
  .find(s => s.id === initial.scenario);
if (!scenario) throw Error('Unknown scenario');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash';
const requests = [], controllers = new Set();
let client;
const proxy = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks), payload = JSON.parse(body.toString('utf8'));
  const n = requests.length;
  const row = { n, kind: payload.tools?.length ? 'agent' : 'native',
    reasoning: payload.reasoning_effort,
    maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
    requestHash: createHash('sha256').update(body).digest('hex'),
    started: new Date().toISOString() };
  requests.push(row);
  if (n >= 24 || body.length > 512000) {
    row.error = 'Follow-up evaluation limit reached'; res.writeHead(429).end(row.error); return;
  }
  await writeFile(join(root, `followup-request-${n}.json`), body);
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 150000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  let raw = ''; const decoder = new TextDecoder();
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body, signal: controller.signal,
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
    await writeFile(join(root, `followup-response-${n}.txt`), raw.replaceAll(key, '[REDACTED]'));
    await writeFile(join(root, 'followup-requests.json'), JSON.stringify(requests, null, 2));
    console.log(`FOLLOWUP REQUEST ${n} ${row.kind} ${row.status ?? row.error} ${row.ms}ms`);
  }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const agent = join(root, 'agent'), cwd = join(root, 'workspace');
const prior = JSON.parse(await readFile(join(agent, 'models.json')));
prior.providers.evaluation.baseUrl = `http://127.0.0.1:${proxy.address().port}/v1`;
await writeFile(join(agent, 'models.json'), JSON.stringify(prior));
const files = (await readdir(join(root, 'sessions'))).filter(name => name.endsWith('.jsonl'));
if (files.length !== 1) throw Error('Expected exactly one original Pi session');
const session = join(root, 'sessions', files[0]);
const sessionId = files[0].match(/_([0-9a-f-]{36})\.jsonl$/)?.[1];
if (!sessionId) throw Error('Original session identity unavailable');
const start = Date.now();
const events = [];
client = new RpcClient({
  cliPath: join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
  cwd, provider: 'evaluation', model,
  args: ['--offline', '--no-extensions', '--extension', join(repo, 'src/plugin/extension.ts'),
    '--handoff-native-limit', initial.arm === 'native' ? '100' : '3',
    '--tools', 'read,write,handoff_evidence', '--session', session],
  env: { PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1' },
});
client.onEvent(e => events.push(e));
let error = null, score;
try {
  await client.start(); await client.setThinkingLevel('high');
  await client.setAutoCompaction(false);
  await client.promptAndWait('Continue the previously authorized task using the existing context and original evidence. Inspect answer.json if it exists; finish or correct it. Follow the original required order and exact field values. Do not ask for another message.', undefined, 240000);
} catch (caught) { error = String(caught); }
finally {
  let entries = [], actualSessionId = null, answer = null;
  try { entries = (await client.getEntries()).entries; } catch { /* preserve failure */ }
  try { actualSessionId = (await client.getState()).sessionId; } catch { /* preserve failure */ }
  try { answer = JSON.parse(await readFile(join(cwd, 'answer.json'))); } catch { /* absent answer */ }
  const expected = { mode: scenario.newMode, limit: scenario.newLimit,
    rejected: scenario.rejected, revision: scenario.finalState.revision,
    verification: 'stale', error: scenario.finalState.error,
    identifier: scenario.identifier, retry_ms: scenario.retryMs,
    source_version: scenario.sourceVersion };
  const combinedRequests = [...JSON.parse(await readFile(join(root, 'requests.json'))), ...requests];
  score = scoreTrace({ entries, requests: combinedRequests, events,
    answer, expected, boundary: 4, requiredSearch: scenario.identifier,
    arm: initial.arm, sessionId, actualSessionId });
  score.scenario = scenario.id; score.repetition = initial.repetition;
  score.error = error; score.followupWallMs = Date.now() - start;
  score.followupRequests = requests.length;
  score.followupDuplicateCalls = Math.max(0, score.duplicateCalls -
    (initial.duplicateCalls ?? 0));
  score.followupUsage = requests.reduce((sum, row) => {
    sum.inputTokens += row.usage?.prompt_tokens ?? 0;
    sum.outputTokens += row.usage?.completion_tokens ?? 0;
    return sum;
  }, { inputTokens: 0, outputTokens: 0 });
  score.protectedIntact = (await readFile(join(cwd, 'audit.log'), 'utf8')) === 'KEEP-AUDIT';
  score.pass = !error && score.sessionStable && score.userMessages === 5 &&
    score.fieldsCorrect === score.fieldsTotal && score.exactKeys &&
    score.procedure.searchAfter > 0 && score.procedure.readAfterSearch &&
    score.protectedIntact;
  await writeFile(join(root, 'followup-entries.json'), JSON.stringify({ entries }, null, 2));
  await writeFile(join(root, 'followup-events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(root, 'followup-score.json'), JSON.stringify(score, null, 2));
  try { await client.stop(); } catch { /* preserve original result */ }
  for (const controller of controllers) controller.abort();
  proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  console.log('FOLLOWUP SCORE ' + JSON.stringify({ scenario: score.scenario,
    arm: score.arm, repetition: score.repetition, pass: score.pass,
    fieldsCorrect: score.fieldsCorrect, procedure: score.procedure,
    duplicateCalls: score.followupDuplicateCalls, followupUsage: score.followupUsage, error }));
  if (!score.pass) process.exitCode = 1;
}
