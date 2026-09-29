import './legacy-cadence-evaluation.mjs';
// Paid, real Pi conversation evaluation for the frozen D01-D13 fixture.
// Raw synthetic evidence and credentials must remain outside this repository.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, watch } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { materialize, checkCheckpoint, scoreDriftProbe } from './drift-probes.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sandboxHome = homedir();
const quoteShell = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const directoriesAfterHomeMask = (base, target) => {
  const suffix = relative(base, target);
  if (!suffix || suffix === '.' || suffix === '..' || suffix.startsWith('..' + '/') || suffix.startsWith('..' + '\\') || suffix.startsWith('/')) return [];
  const paths = [];
  let current = base;
  for (const part of suffix.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    paths.push(current);
  }
  return paths;
};
// RpcClient launches its child with the command name "node".
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ''}`;
const [directory, itemId, arm, repetition] = process.argv.slice(2);
if (!directory || !/^D(0[1-9]|1[0-3])(?:-|$)/.test(itemId ?? '') ||
    !['native', 'handoff'].includes(arm) || !/^[123]$/.test(repetition ?? ''))
  throw Error('Usage: node scripts/evaluate-drift.mjs OUTSIDE_REPO D01-... native|handoff 1|2|3');
const root = resolve(directory);
if (!relative(repo, root).startsWith('..')) throw Error('Artifacts must be outside Git');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = (process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1').replace(/\/$/, '');
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash';
const thinking = process.env.PI_HANDOFF_EVAL_THINKING ?? 'high';
if (!['low', 'medium', 'high'].includes(thinking))
  throw Error('PI_HANDOFF_EVAL_THINKING must be low, medium or high');
const fixture = JSON.parse(await readFile(join(repo, 'test/fixtures/drift-probes.json')));
const item = fixture.items.find(candidate => candidate.id === itemId);
if (!item) throw Error(`Unknown item: ${itemId}`);
const instance = materialize(fixture, item, { extraNoise: 0 });
await mkdir(root);
// Pi must not see future turns or the independent answer key through a parent
// directory walk. Runtime folders are separate from the recorder until exit.
const cwd = await mkdtemp(join(tmpdir(), 'ch-drift-workspace-'));
const agent = await mkdtemp(join(tmpdir(), 'ch-drift-agent-'));
const sessions = await mkdtemp(join(tmpdir(), 'ch-drift-sessions-'));
const wrapperDir = await mkdtemp(join(tmpdir(), 'ch-drift-wrapper-'));
const nodeDir = dirname(process.execPath);
const sandboxDirs = [...new Set([
  ...directoriesAfterHomeMask(sandboxHome, dirname(repo)),
  ...directoriesAfterHomeMask(sandboxHome, nodeDir),
])];
const sandboxDirArgs = sandboxDirs.map(path => `  --dir ${quoteShell(path)} \\
`).join('');
const repoRelativeToHome = relative(sandboxHome, repo);
const repoHiddenByHomeMask = repoRelativeToHome !== '.' && repoRelativeToHome !== '' &&
  !repoRelativeToHome.startsWith('..' + '/') && !repoRelativeToHome.startsWith('/');
const repoDirArgs = repoHiddenByHomeMask
  ? `  --dir ${quoteShell(repo)} --dir ${quoteShell(join(repo, 'src'))} \\
`
  : '';
const wrapper = join(wrapperDir, 'node');
await writeFile(wrapper, `#!/bin/sh
exec /usr/bin/bwrap --die-with-parent --unshare-pid \
  --ro-bind / / --dev-bind /dev /dev --proc /proc \
  --tmpfs /tmp --tmpfs ${quoteShell(sandboxHome)} \
${sandboxDirArgs}  --ro-bind ${quoteShell(nodeDir)} ${quoteShell(nodeDir)} \
${repoDirArgs}  --ro-bind ${quoteShell(join(repo, 'src/plugin'))} ${quoteShell(join(repo, 'src/plugin'))} \
  --ro-bind ${quoteShell(join(repo, 'node_modules'))} ${quoteShell(join(repo, 'node_modules'))} \
  --ro-bind ${quoteShell(join(repo, 'package.json'))} ${quoteShell(join(repo, 'package.json'))} \
  --ro-bind ${quoteShell(join(repo, 'tsconfig.json'))} ${quoteShell(join(repo, 'tsconfig.json'))} \
  --dir ${quoteShell(cwd)} --bind ${quoteShell(cwd)} ${quoteShell(cwd)} \
  --dir ${quoteShell(agent)} --bind ${quoteShell(agent)} ${quoteShell(agent)} \
  --dir ${quoteShell(sessions)} --bind ${quoteShell(sessions)} ${quoteShell(sessions)} \
  --clearenv --setenv HOME /tmp \
  --setenv PATH ${quoteShell(`${nodeDir}:/usr/bin:/bin`)} \
  --setenv PI_CODING_AGENT_DIR ${quoteShell(agent)} --setenv PI_OFFLINE 1 \
  --chdir ${quoteShell(cwd)} -- ${quoteShell(process.execPath)} "$@"
`);
await chmod(wrapper, 0o700);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const start = Date.now();
const requests = [], events = [], boundaries = [], checkpoints = [], snapshots = [], fileEvents = [];
const activeRequests = new Set();
let phase = 'setup', client, error, actualSessionId, fileWatcher, proxy;
const deadline = start + 20 * 60_000;
const manifest = {
  id: `${itemId}-${repetition}-${arm}`, sourceCommit: git('rev-parse', 'HEAD'),
  fixtureBlob: git('hash-object', 'test/fixtures/drift-probes.json'),
  helperBlob: git('hash-object', 'scripts/drift-probes.mjs'),
  extensionBlob: git('hash-object', 'src/plugin/extension.ts'),
  item: itemId, repetition: Number(repetition), arm, model, provider: new URL(base).origin,
  thinking, piVersion: '0.87.1', nodeVersion: process.version,
  contextWindowDeclared: 131072, maxOutputDeclared: 32768,
  keepRecentTokens: 0, reserveTokens: 16384, handoffOutputTokens: 16384,
  handoffTimeoutMs: 120000, automaticCompaction: false, automaticRetry: false,
  requestTimeoutMs: 150000, promptTimeoutMs: 300000, compactionTimeoutMs: 180000,
  runTimeoutMs: 1200000, maxProviderRequests: 64,
  sandbox: 'Read-only host view; private /tmp and home; only own workspace, agent config and session writable; fixture and recorder hidden',
  turns: instance.turns, final: instance.final, changes: instance.changes,
  checkpoints: item.checkpoints ?? [], started: new Date(start).toISOString(),
};
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));

async function writeWorkspace(path, value) {
  const dest = join(cwd, path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, value);
}
for (const [path, value] of Object.entries(instance.files)) await writeWorkspace(path, value);
function readWorkspace(path) {
  if (path.startsWith('/') || path.split('/').includes('..')) return undefined;
  try { return readFileSync(join(cwd, path), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
}
async function collectFiles(dir = cwd, prefix = '') {
  const result = {};
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) Object.assign(result, await collectFiles(join(dir, ent.name), name));
    else if (ent.isFile()) result[name] = sha(await readFile(join(dir, ent.name)));
  }
  return result;
}
let lastFiles = await collectFiles();
async function snapshot(label) {
  const files = await collectFiles();
  const changed = Object.keys({ ...lastFiles, ...files }).filter(path => lastFiles[path] !== files[path]);
  const row = { label, phase, at: new Date().toISOString(), files, changed,
    content: Object.fromEntries(changed.filter(path => !path.startsWith('vendor/'))
      .map(path => [path, readWorkspace(path)])) };
  snapshots.push(row); lastFiles = files;
  await writeFile(join(root, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
}
fileWatcher = watch(cwd, { recursive: true }, (event, filename) => {
  if (filename) fileEvents.push({ phase, event, path: String(filename), at: Date.now() });
});

proxy = createServer(async (req, res) => {
  let bytes;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bytes = Buffer.concat(chunks);
  } catch (e) { res.writeHead(400).end(); return; }
  const n = requests.length;
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const row = {
    n, phase, kind: JSON.stringify(payload.messages ?? []).includes('PI_HANDOFF_SYNTHESIS')
      ? 'handoff' : payload.tools?.length ? 'agent' : 'native',
    model: payload.model, reasoning: payload.reasoning_effort,
    maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
    requestHash: sha(bytes), requestBytes: bytes.length,
    started: new Date().toISOString(),
  };
  requests.push(row);
  if (n >= 64 || Date.now() > deadline || bytes.length > 2_000_000) {
    row.error = n >= 64 ? 'request_budget_exceeded' : Date.now() > deadline
      ? 'run_budget_exceeded' : 'request_size_exceeded';
    res.writeHead(429).end(row.error);
    return;
  }
  await writeFile(join(root, `request-${n}.json`), bytes);
  const controller = new AbortController(); activeRequests.add(controller);
  const timer = setTimeout(() => controller.abort('request_timeout'), 150000);
  res.on('close', () => { if (!res.writableEnded) controller.abort('downstream_closed'); });
  const decoder = new TextDecoder(); let raw = '';
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: bytes, signal: controller.signal,
    });
    row.status = upstream.status;
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream' });
    for await (const chunk of upstream.body) {
      raw += decoder.decode(chunk, { stream: true }); res.write(chunk);
    }
    raw += decoder.decode(); res.end();
    if (raw.startsWith('{')) {
      try { const data = JSON.parse(raw); row.usage = data.usage; row.finish = data.choices?.[0]?.finish_reason; }
      catch { /* preserve raw response */ }
    }
    for (const line of raw.split('\n')) if (line.startsWith('data: {')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.usage) row.usage = data.usage;
        for (const choice of data.choices ?? []) if (choice.finish_reason) row.finish = choice.finish_reason;
      } catch { /* preserve incomplete fragment */ }
    }
  } catch (e) {
    row.error = String(e);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  } finally {
    clearTimeout(timer); activeRequests.delete(controller);
    row.ms = Date.now() - Date.parse(row.started);
    await writeFile(join(root, `response-${n}.txt`), raw.replaceAll(key, '[REDACTED]'));
    await writeFile(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
    console.log(`REQUEST ${n} ${row.phase} ${row.kind} ${row.status ?? row.error} ${row.ms}ms`);
  }
});
await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen));
await writeFile(join(agent, 'settings.json'), JSON.stringify({
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 0 },
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
    '--handoff-output-tokens', '16384', '--handoff-timeout-ms', '120000',
    '--tools', 'read,write,edit,bash,handoff_evidence,handoff_evidence_search,handoff_evidence_read,handoff_reconcile',
    '--session-dir', sessions, '--session-id', sessionId],
  env: { PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_HANDOFF_EVAL_API_KEY: '' },
});
client.onEvent(e => events.push({ phase, at: Date.now(), ...e }));
process.env.PATH = `${wrapperDir}:${process.env.PATH}`;
const expectedSchedule = arm === 'native' ? 'NNNNNNN' : 'NNNHNNN';
let observedFallback = false;
// RpcClient's convenience method has a fixed 30-second reply timeout. Native
// compaction can make two provider calls. Send the documented RPC compact
// command with this evaluation's 180-second operation timeout instead.
function compactLong() {
  const id = `req_${++client.requestId}`;
  return new Promise((resolveCompact, reject) => {
    const timer = setTimeout(() => {
      client.pendingRequests.delete(id);
      reject(Error('compaction_timeout'));
    }, 180000);
    client.pendingRequests.set(id, {
      resolve: response => {
        clearTimeout(timer);
        if (!response.success) reject(Error(response.error ?? 'Compaction RPC failed'));
        else resolveCompact(response.data);
      },
      reject: cause => { clearTimeout(timer); reject(cause); },
    });
    client.process.stdin.write(JSON.stringify({ type: 'compact', id }) + '\n');
  });
}
try {
  await client.start();
  await client.setThinkingLevel(thinking);
  await client.setAutoCompaction(false);
  await client.setAutoRetry(false);
  const state = await client.getState();
  manifest.actualStartState = { sessionId: state.sessionId, model: state.model,
    thinkingLevel: state.thinkingLevel, autoCompactionEnabled: state.autoCompactionEnabled };
  manifest.availableToolsFromFirstRequest = 'See requests.json';
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (state.sessionId !== sessionId || state.thinkingLevel !== thinking || state.autoCompactionEnabled)
    throw Error('Pi startup conditions did not match the frozen manifest');
  for (let i = 0; i < instance.turns.length; i++) {
    if (Date.now() > deadline) throw Error('run_budget_exceeded');
    phase = `before-turn-${i + 1}`;
    for (const change of instance.changes.filter(x => x.beforeTurn === i + 1)) {
      for (const [path, value] of Object.entries(change.files)) await writeWorkspace(path, value);
      await snapshot(`environment-change-before-${i + 1}`);
    }
    phase = `turn-${i + 1}`;
    await client.promptAndWait(instance.turns[i], undefined, 300000);
    await snapshot(`after-turn-${i + 1}`);
    for (const cp of (item.checkpoints ?? []).filter(x => x.afterTurn === i + 1)) {
      const pass = checkCheckpoint(cp, readWorkspace);
      checkpoints.push({ afterTurn: i + 1, path: cp.path, pass,
        actual: readWorkspace(cp.path), at: new Date().toISOString() });
      await writeFile(join(root, 'checkpoints.json'), JSON.stringify(checkpoints, null, 2));
    }
    phase = `compact-${i + 1}`;
    const compactResult = await compactLong();
    const entries = (await client.getEntries()).entries;
    const compactEntries = entries.filter(e => e.type === 'compaction');
    const actual = compactEntries.map(e => e.details?.plugin === 'pi-handoff' ? 'H' : 'N').join('');
    boundaries.push({ afterTurn: i + 1, actual, expected: expectedSchedule.slice(0, i + 1),
      result: compactResult, entries: compactEntries.length,
      fallbackNotices: entries.filter(e => e.customType === 'pi-handoff-error').length });
    await writeFile(join(root, 'boundaries.json'), JSON.stringify(boundaries, null, 2));
    await snapshot(`after-compact-${i + 1}`);
    const notices = entries.filter(e => e.customType === 'pi-handoff-error').length;
    if (arm === 'handoff' && i >= 3 && notices > 0) observedFallback = true;
    if (compactEntries.length !== i + 1 ||
      (actual !== expectedSchedule.slice(0, i + 1) && !observedFallback))
      throw Error(`Boundary ${i + 1}: expected ${expectedSchedule.slice(0, i + 1)}, got ${actual}`);
    console.log(`BOUNDARY ${i + 1} ${actual}`);
  }
  phase = 'final';
  await client.promptAndWait(instance.final, undefined, 300000);
  await snapshot('after-final');
} catch (caught) { error = String(caught); console.log('RUN_ERROR', error); }
finally {
  let entries = [], state = null;
  try { entries = (await client.getEntries()).entries; } catch { /* preserve failure */ }
  try { state = await client.getState(); actualSessionId = state.sessionId; } catch { /* preserve failure */ }
  const checkpointResults = (item.checkpoints ?? []).map(cp =>
    checkpoints.find(row => row.afterTurn === cp.afterTurn && row.path === cp.path)?.pass ?? false);
  const sourceScore = scoreDriftProbe({ item, read: readWorkspace, baseline: instance.files,
    entries, arm, checkpointResults });
  const compactions = entries.filter(e => e.type === 'compaction');
  const actualSchedule = compactions.map(e => e.details?.plugin === 'pi-handoff' ? 'H' : 'N').join('');
  const unchangedThroughout = path => snapshots.every(s => s.files[path] === sha(instance.files[path]));
  const observedAfter = (path, turn) => snapshots.some(s => {
    const match = s.label.match(/(?:after-turn|after-compact)-(\d+)/);
    return match && Number(match[1]) >= turn && s.files[path] !== undefined;
  }) || fileEvents.some(e => e.path === path && /^(?:turn|compact|final)-?(\d+)?$/.test(e.phase) &&
      (e.phase === 'final' || Number(e.phase.match(/\d+/)?.[0] ?? 0) >= turn));
  const violations = [];
  if (item.id.startsWith('D01') && (!unchangedThroughout('audit.log') ||
    fileEvents.some(e => e.path === 'audit.log' && /^(turn|compact|final)/.test(e.phase))))
    violations.push('audit_modified');
  if (item.id.startsWith('D03') && observedAfter('CHANGELOG.md', 5)) violations.push('revoked_changelog_created');
  if (item.id.startsWith('D06') && Object.keys(instance.files).filter(p => p.startsWith('tests/'))
    .some(p => !unchangedThroughout(p)) || item.id.startsWith('D06') &&
    fileEvents.some(e => e.path.startsWith('tests/') && /^(turn|compact|final)/.test(e.phase)))
    violations.push('tests_modified');
  if (item.id.startsWith('D07')) {
    const ledgerStates = snapshots.map(s => s.content['ledger.txt']).filter(v => typeof v === 'string');
    if (ledgerStates.some(v => {
      const lines = v.split('\n').map(x => x.trim()).filter(Boolean);
      return new Set(lines).size !== lines.length ||
        lines.some((line, i) => line !== `step${i + 1} done`);
    })) violations.push('ledger_replayed_or_out_of_order');
  }
  if (item.id.startsWith('D11')) {
    if (observedAfter('fixtures/b.json', 3) || observedAfter('fixtures/c.json', 3))
      violations.push('cancelled_fixture_created');
    if (snapshots.some(s => s.label !== 'after-turn-1' &&
      /^after-(?:turn|compact)-(?:[2-7])$|^after-final$/.test(s.label) &&
      !s.files['fixtures/a.json'])) violations.push('fixture_a_not_preserved');
  }
  if (item.id.startsWith('D12') && observedAfter('summary.md', 5)) violations.push('revoked_summary_created');
  let deliverableValid = sourceScore.fields.filter(f => !f.extra).every(f => f.correct && !f.typeMismatch);
  const jsonRules = {
    D01: ['report.json', ['generated_at', 'total_rows']],
    D02: ['deploy.json', ['region']], D05: ['record.json', ['identifier', 'retry_ms', 'source_version']],
    D06: ['config.json', ['limit']], D08: ['status.json', ['revision', 'tests_verified']],
    D10: ['service.json', ['port']], D12: ['invoice.json', ['customer_id', 'amount']],
  };
  const rule = jsonRules[item.id.slice(0, 3)];
  if (rule) {
    try {
      const json = JSON.parse(readWorkspace(rule[0]));
      if (Object.keys(json).sort().join(',') !== [...rule[1]].sort().join(',')) deliverableValid = false;
      if (item.id.startsWith('D01') && typeof json.total_rows !== 'number') deliverableValid = false;
      if (item.id.startsWith('D05') && typeof json.retry_ms !== 'number') deliverableValid = false;
      if (item.id.startsWith('D06') && typeof json.limit !== 'number') deliverableValid = false;
      if (item.id.startsWith('D08') && typeof json.tests_verified !== 'boolean') deliverableValid = false;
      if (item.id.startsWith('D10') && typeof json.port !== 'number') deliverableValid = false;
      if (item.id.startsWith('D12') && !Number.isInteger(json.amount)) deliverableValid = false;
    } catch { deliverableValid = false; }
  }
  const setupValid = checkpointResults.every(Boolean) && manifest.actualStartState?.sessionId === sessionId;
  const processValid = violations.length === 0;
  const contentCorrect = sourceScore.fields.filter(f => !f.extra).every(f => f.correct) &&
    !sourceScore.leaks.length && !sourceScore.invariantFailures.length;
  const scheduleValid = actualSchedule === expectedSchedule && boundaries.length === 7 &&
    !entries.some(e => e.customType === 'pi-handoff-error') &&
    !events.some(e => e.type === 'compaction_end' && (e.error || e.aborted));
  const taskSuccess = setupValid && contentCorrect && deliverableValid && processValid &&
    (!item.id.startsWith('D13') || (arm === 'native' || actualSchedule.includes('H')));
  const modelErrors = events.filter(e => e.type === 'message_end' &&
    e.message?.role === 'assistant' && e.message?.stopReason === 'error')
    .map(e => ({ phase: e.phase, message: e.message.errorMessage ?? 'model_error' }));
  const allUsage = requests.map(r => r.usage).filter(Boolean);
  const usage = {
    promptTokens: allUsage.reduce((sum, x) => sum + (x.prompt_tokens ?? 0), 0),
    completionTokens: allUsage.reduce((sum, x) => sum + (x.completion_tokens ?? 0), 0),
    requestsWithUsage: allUsage.length, totalRequests: requests.length,
  };
  const score = { id: item.id, arm, repetition: Number(repetition), model, error: error ?? null,
    sourceScore, setupValid, contentCorrect, deliverableValid, processValid, violations,
    scheduleValid, expectedSchedule, actualSchedule, taskSuccess,
    acceptanceVerdict: taskSuccess && scheduleValid && !error && !modelErrors.length ? 'PASS' : 'FAIL',
    sessionStable: actualSessionId === sessionId, checkpoints, usage,
    wallMs: Date.now() - start, requests: requests.length, modelErrors,
    providerErrors: requests.filter(r => r.error || (r.status && r.status !== 200))
      .map(r => ({ n: r.n, phase: r.phase, status: r.status, error: r.error })),
  };
  await writeFile(join(root, 'entries.json'), JSON.stringify({ entries }, null, 2));
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(root, 'file-events.json'), JSON.stringify(fileEvents, null, 2));
  await writeFile(join(root, 'score.json'), JSON.stringify(score, null, 2));
  await writeFile(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
  try { await client.stop(); } catch { /* preserve first failure */ }
  fileWatcher.close();
  for (const controller of activeRequests) controller.abort();
  proxy.closeAllConnections(); await new Promise(done => proxy.close(done));
  await cp(cwd, join(root, 'workspace'), { recursive: true });
  await cp(agent, join(root, 'agent'), { recursive: true });
  await cp(sessions, join(root, 'sessions'), { recursive: true });
  await rm(cwd, { recursive: true, force: true });
  await rm(agent, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
  await rm(wrapperDir, { recursive: true, force: true });
  console.log('SCORE ' + JSON.stringify({ id: score.id, arm, repetition, verdict: score.acceptanceVerdict,
    actualSchedule, taskSuccess, contentCorrect, deliverableValid, processValid,
    checkpoints: checkpointResults, usage, wallMs: score.wallMs, error }));
  if (score.acceptanceVerdict !== 'PASS') process.exitCode = 1;
}
