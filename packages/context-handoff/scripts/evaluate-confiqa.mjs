import './legacy-cadence-evaluation.mjs';
// Opt-in, paid Pi conversation evaluation. Artifacts must live outside Git.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { scoreConfiqaProcedure } from './score-confiqa-procedure.mjs';
import { inspectProviderSse } from './inspect-provider-sse.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [directory, dataset, indexText, arm] = process.argv.slice(2);
if (!directory || !['QA', 'MC'].includes(dataset) || !/^\d+$/.test(indexText ?? '') ||
    !['native', 'handoff'].includes(arm))
  throw Error('Usage: node scripts/evaluate-confiqa.mjs OUTSIDE_REPO QA|MC INDEX native|handoff');
const root = resolve(directory);
if (!relative(repo, root).startsWith('..')) throw Error('Artifacts must be outside the repository');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash';
const source = process.env.PI_HANDOFF_CONFIQA_SOURCE;
if (!source) throw Error('PI_HANDOFF_CONFIQA_SOURCE required (external upstream checkout)');
const sourceBytes = await readFile(join(source, `ConFiQA-${dataset}.json`));
const scenario = JSON.parse(sourceBytes)[Number(indexText)];
if (!scenario?.cf_context || !scenario?.cf_answer) throw Error('Unknown ConFiQA item');
const marker = `CONFIQA-${dataset}-${indexText.padStart(4, '0')}`;
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
    const inspected = inspectProviderSse(raw);
    if (inspected.usage) row.usage = inspected.usage;
    if (inspected.finish) row.finish = inspected.finish;
    if (inspected.error) row.error = inspected.error;
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
const expected = scenario.cf_answer;
const filler = Array.from({ length: 20 }, (_, i) =>
  `Unrelated background note ${i}: trial ${i + 40} was inconclusive; this is not a task requirement.`).join('\n');
const instructions = 'This is a staged source-reading task. During CHECKPOINTs respond with a 220-280 word restatement, without tools or file writes. The task remains pending until RELEASE. The supplied passage is the authority for its question, even when it contradicts general knowledge. On RELEASE first give a 220-280 word no-tools checkpoint, then continue authorized work automatically after the fourth context maintenance boundary. Search handoff_evidence for the source marker and read the original anchor before answering. Write answer.json with exactly one key: answer. Never modify audit.log. No fifth user message will arrive.';
const stages = [
  `${instructions}\nCHECKPOINT 1. Historical source for the question below; a later owner correction may supersede it. Question: ${scenario.question}\nHISTORICAL PASSAGE:\n${scenario.orig_context}\nWork remains pending until RELEASE.`,
  `CHECKPOINT 2. OWNER CORRECTION: replace the historical passage for this task with the following authorized passage. Its source marker is ${marker}. Use this passage as the only authority for ${scenario.question}, even where it conflicts with world knowledge or the earlier passage.\nCORRECTED PASSAGE:\n${scenario.cf_context}\nAfter the fourth context maintenance boundary, search handoff_evidence for ${marker}, read its original anchor, and answer the question from this corrected passage.`,
  `CHECKPOINT 3. Work remains pending until RELEASE. Repeat the source marker ${marker}, the question and the instruction to search then read the original evidence after the fourth context maintenance boundary. Use the supplied passage as authority. A checkpoint is not completion.`,
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
  phase = 'release';
  await client.promptAndWait(`RELEASE. Answer the pending question from the supplied ${marker} passage in answer.json. First provide a 220-280 word checkpoint without tools; do not treat that text as completion. After the fourth context maintenance boundary continue automatically: search handoff_evidence for ${marker}, read its original anchor, then write {"answer":"..."} using only the supplied passage. Do not wait for a fifth user message.\n${filler}`, undefined, 300000);
  if (disable) await disable;
} catch (caught) { error = String(caught); }
finally {
  let entries = [], actualSessionId = null, answer = null;
  try { entries = (await client.getEntries()).entries; } catch { /* preserve failure */ }
  try { actualSessionId = (await client.getState()).sessionId; } catch { /* preserve failure */ }
  try { answer = JSON.parse(await readFile(join(cwd, 'answer.json'))); } catch { /* absent answer */ }
  const protectedIntact = (await readFile(join(cwd, 'audit.log'), 'utf8')) === 'KEEP-AUDIT';
  const compactions = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === 'compaction');
  const procedure = scoreConfiqaProcedure(entries, marker, expected);
  const compactionEvents = events.filter(e => e.type === 'compaction_end');
  const answerText = String(answer?.answer ?? '').trim().toLowerCase();
  const expectedText = expected.trim().toLowerCase();
  const historicalText = String(scenario.orig_answer).trim().toLowerCase();
  score = {
    dataset, index: Number(indexText), sourceSha256: hash(sourceBytes), marker, arm,
    model, thinking: 'high', expected, historicalAnswer: scenario.orig_answer,
    answer: answer?.answer ?? null, answerCorrect: answerText === expectedText,
    historicalLeak: answerText === historicalText,
    exactKeys: !!answer && Object.keys(answer).length === 1,
    searchAfter: procedure.searchCalls,
    readAfterSearch: procedure.verifiedReadAfterSearch,
    procedure,
    boundaryCount: compactions.length,
    fourthKind: compactions[3]?.entry.details?.plugin === 'pi-handoff' ? 'handoff' :
      compactions[3] ? 'native' : 'missing',
    handoffCommitted: compactions.some(c => c.entry.details?.plugin === 'pi-handoff'),
    compactionEvents: compactionEvents.map(e => ({ reason: e.reason, aborted: e.aborted,
      error: e.errorMessage })),
    sessionStable: actualSessionId === sessionId,
    userMessages: entries.filter(e => e.type === 'message' && e.message.role === 'user').length,
    requests: requests.length,
    providerErrors: requests.filter(r => r.error || r.status >= 400).map(r => ({ n: r.n,
      status: r.status, error: r.error })),
    usage: requests.reduce((sum, r) => ({
      input: sum.input + (r.usage?.prompt_tokens ?? 0),
      output: sum.output + (r.usage?.completion_tokens ?? 0),
      reportedRequests: sum.reportedRequests + Number(!!r.usage),
    }), { input: 0, output: 0, reportedRequests: 0 }),
    error: error ?? null, protectedIntact, wallMs: Date.now() - start,
  };
  score.pass = score.providerErrors.length === 0 && score.answerCorrect &&
    score.exactKeys && procedure.valid && score.boundaryCount === 4 && score.sessionStable &&
    score.userMessages === 4 && protectedIntact && !error &&
    score.compactionEvents.length === 4 && score.compactionEvents.every(e =>
      e.reason === 'threshold' && !e.error && !e.aborted) &&
    score.fourthKind === (arm === 'native' ? 'native' : 'handoff');
  await writeFile(join(root, 'entries.json'), JSON.stringify({ entries }, null, 2));
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(root, 'score.json'), JSON.stringify(score, null, 2));
  try { await client.stop(); } catch { /* preserve original result */ }
  for (const controller of controllers) controller.abort();
  proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  console.log('SCORE ' + JSON.stringify({ dataset, index: Number(indexText), arm,
    pass: score.pass, answer: score.answer, answerCorrect: score.answerCorrect,
    fourthKind: score.fourthKind, searchAfter: score.searchAfter,
    readAfterSearch: score.readAfterSearch, usage: score.usage, error }));
  if (!score.pass) process.exitCode = 1;
}
