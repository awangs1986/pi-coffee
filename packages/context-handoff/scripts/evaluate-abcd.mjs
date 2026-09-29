// One isolated, real-Pi arm for the ABCD 250k evaluation.
// Synthetic transcripts, provider captures, generated handoffs and credentials
// stay outside Git. The API key is held only by this parent-side proxy.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, watch } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { materialize, checkCheckpoint, scoreDriftProbe } from './drift-probes.mjs';
import { buildAbcdLoadPackets } from './abcd-workload.mjs';

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
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ''}`;
const [directory, itemId, arm, repetitionText] = process.argv.slice(2);
const arms = new Set(['A', 'B', 'C', 'D']);
if (!directory || !/^D(0[1-9]|1[0-3])-.+-250k-v1$/.test(itemId ?? '') ||
    !arms.has(arm) || !/^[123]$/.test(repetitionText ?? ''))
  throw new Error('Usage: node scripts/evaluate-abcd.mjs OUTSIDE_REPO D01-...-250k-v1 A|B|C|D 1|2|3');
const root = resolve(directory);
if (!relative(repo, root).startsWith('..')) throw new Error('Artifacts must be outside Git');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw new Error('PI_HANDOFF_EVAL_API_KEY is required');
const base = (process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.commandcode.ai/provider/v1').replace(/\/$/, '');
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'meta/muse-spark-1.3-contributor';
const thinking = process.env.PI_HANDOFF_EVAL_THINKING ?? 'medium';
if (!['low', 'medium', 'high'].includes(thinking)) throw new Error('PI_HANDOFF_EVAL_THINKING must be low, medium or high');
const fixture = JSON.parse(await readFile(join(repo, 'test/fixtures/abcd-250k-v1.json'), 'utf8'));
const item = fixture.items.find(x => x.id === itemId);
if (!item) throw new Error(`Unknown long-context case ${itemId}`);
const repetition = Number(repetitionText);
const attemptId = process.env.PI_HANDOFF_EVAL_ATTEMPT_ID ?? `r${repetition}`;
const instance = materialize(fixture, item, { extraNoise: 0 });
const pluginEnabled = arm === 'C' || arm === 'D';
const skillEnabled = arm === 'B';
const nativeLimit = arm === 'C' ? '3' : arm === 'D' ? '0' : undefined;
const expectedSchedule = ({ A: 'NNNN', B: 'NNNB', C: 'NNNC', D: 'HHHH' })[arm];
await mkdir(root, { recursive: true });

// Each Pi process sees only its own workspace, agent config, session files,
// pinned skill and (for C/D) the plugin. The scorer and answer key are not mounted.
const cwd = await mkdtemp(join(tmpdir(), 'ch-abcd-workspace-'));
const agent = await mkdtemp(join(tmpdir(), 'ch-abcd-agent-'));
const sessions = await mkdtemp(join(tmpdir(), 'ch-abcd-sessions-'));
const wrapperDir = await mkdtemp(join(tmpdir(), 'ch-abcd-wrapper-'));
const handoffTmp = await mkdtemp(join(tmpdir(), 'ch-abcd-os-tmp-'));
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
const skillSource = process.env.PI_HANDOFF_ORIGINAL_SKILL_PATH;
const skillDir = join(agent, 'skills', 'handoff');
const skillFile = join(skillDir, 'SKILL.md');
if (skillEnabled) {
  if (!skillSource) throw new Error('PI_HANDOFF_ORIGINAL_SKILL_PATH must point to the pinned original Handoff SKILL.md');
  await mkdir(skillDir, { recursive: true });
  await cp(skillSource, skillFile);
}
const wrapper = join(wrapperDir, 'node');
await writeFile(wrapper, `#!/bin/sh
exec /usr/bin/bwrap --die-with-parent --unshare-pid \
  --ro-bind / / --dev-bind /dev /dev --proc /proc \
  --tmpfs /tmp --dir /tmp/handoff --bind ${quoteShell(handoffTmp)} /tmp/handoff \
  --tmpfs ${quoteShell(sandboxHome)} \
${sandboxDirArgs}  --ro-bind ${quoteShell(nodeDir)} ${quoteShell(nodeDir)} \
${repoDirArgs}  --ro-bind ${quoteShell(join(repo, 'src/plugin'))} ${quoteShell(join(repo, 'src/plugin'))} \
  --ro-bind ${quoteShell(join(repo, 'node_modules'))} ${quoteShell(join(repo, 'node_modules'))} \
  --ro-bind ${quoteShell(join(repo, 'package.json'))} ${quoteShell(join(repo, 'package.json'))} \
  --ro-bind ${quoteShell(join(repo, 'tsconfig.json'))} ${quoteShell(join(repo, 'tsconfig.json'))} \
  --dir ${quoteShell(cwd)} --bind ${quoteShell(cwd)} ${quoteShell(cwd)} \
  --dir ${quoteShell(agent)} --bind ${quoteShell(agent)} ${quoteShell(agent)} \
  --dir ${quoteShell(sessions)} --bind ${quoteShell(sessions)} ${quoteShell(sessions)} \
  --clearenv --setenv HOME ${quoteShell(sandboxHome)} --setenv TMPDIR /tmp/handoff \
  --setenv PATH ${quoteShell(`${nodeDir}:/usr/bin:/bin`)} \
  --setenv PI_CODING_AGENT_DIR ${quoteShell(agent)} --setenv PI_OFFLINE 1 \
  --chdir ${quoteShell(cwd)} -- ${quoteShell(process.execPath)} "$@"
`);
await chmod(wrapper, 0o700);

const sha = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const started = Date.now();
const runDeadline = started + 7200_000;
const requests = [], events = [], transitions = [], occupancies = [], checkpoints = [], snapshots = [], fileEvents = [];
const activeRequests = new Set();
let phase = 'setup', client, proxy, fileWatcher, error = null, sessionSegment = 'primary';
let actualStartSessionId = null, finalSessionId = null, handoffDocument = null;
let outgoingEntries = null;
const requestTimeoutMs = 300_000;
const transitionTimeoutMs = 600_000;
const manifest = {
  protocol: fixture.protocol.abcd.id,
  arm, expectedSchedule, item: item.id, repetition, attemptId,
  candidate: 'SPEC revision 5 zero-native-cadence candidate',
  sourceCommit: git('rev-parse', 'HEAD'),
  configBlob: git('hash-object', 'src/plugin/config.ts'),
  extensionBlob: git('hash-object', 'src/plugin/extension.ts'),
  testBlob: git('hash-object', 'test/pi-plugin.test.ts'),
  evaluatorBlob: git('hash-object', 'scripts/evaluate-abcd.mjs'),
  fixtureBlob: git('hash-object', 'test/fixtures/abcd-250k-v1.json'),
  workloadBlob: git('hash-object', 'scripts/abcd-workload.mjs'),
  skillEnabled,
  skillCommit: skillEnabled ? 'c55ee46073ed923f86ce59a5eb3b6d895095d1b7' : null,
  skillBlob: skillEnabled ? '2eb98a51b97bb5bac461a26ad14828eeac827909' : null,
  skillSha256: skillEnabled ? sha(await readFile(skillFile)) : null,
  model, provider: new URL(base).origin, thinking,
  piVersion: '0.87.1', nodeVersion: process.version,
  declaredContextWindow: 524288, maxOutputTokens: 32768,
  targetTokens: fixture.protocol.abcd.targetTokens,
  admissionBand: fixture.protocol.abcd.admissionBand,
  nativeLimit: nativeLimit ?? null,
  keepRecentTokens: 20000, reserveTokens: 16384, handoffOutputTokens: 16384,
  handoffTimeoutMs: 120000, automaticCompaction: false, automaticRetry: false,
  requestTimeoutMs, transitionTimeoutMs, maxRequestsPerTransition: 32,
  noKeyInChildEnvironment: true,
  sandbox: 'Pi sees only its synthetic workspace, own agent/session dirs, pinned skill, and the plugin source for C/D; answer key and recorder are not mounted.',
  originalTurns: instance.turns,
  finalTask: instance.final,
  environmentChanges: instance.changes,
  checkpoints: item.checkpoints ?? [],
  started: new Date(started).toISOString(),
};
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));

async function writeWorkspace(path, value) {
  if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Unsafe fixture path ${path}`);
  const dest = join(cwd, path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, value);
}
function readWorkspace(path) {
  if (path.startsWith('/') || path.split('/').includes('..')) return undefined;
  try { return readFileSync(join(cwd, path), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
}
async function collectFiles(dir = cwd, prefix = '') {
  const out = {};
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) Object.assign(out, await collectFiles(join(dir, ent.name), path));
    else if (ent.isFile()) out[path] = sha(await readFile(join(dir, ent.name)));
  }
  return out;
}
let previousFiles = {};
async function snapshot(label, detail = {}) {
  const files = await collectFiles();
  const paths = new Set([...Object.keys(previousFiles), ...Object.keys(files)]);
  const changed = [...paths].filter(path => previousFiles[path] !== files[path]);
  snapshots.push({ label, phase, at: new Date().toISOString(), ...detail, files, changed,
    content: Object.fromEntries(changed.filter(path => !path.startsWith('vendor/')).map(path => [path, readWorkspace(path)])) });
  previousFiles = files;
  await writeFile(join(root, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
}
try {
  for (const [path, value] of Object.entries(instance.files)) await writeWorkspace(path, value);
  previousFiles = await collectFiles();
  fileWatcher = watch(cwd, { recursive: true }, (event, filename) => {
    if (filename) fileEvents.push({ phase, event, path: String(filename), at: Date.now() });
  });
} catch (caught) {
  error = String(caught).replaceAll(key, '[REDACTED]');
  await writeFile(join(root, 'setup-error.json'), JSON.stringify({ stage: 'initial_workspace_snapshot', error }, null, 2));
  fileWatcher?.close();
  await Promise.all([cwd, agent, sessions, wrapperDir, handoffTmp].map(path => rm(path, { recursive: true, force: true })));
  throw caught;
}

proxy = createServer(async (req, res) => {
  const chunks = [];
  try { for await (const chunk of req) chunks.push(chunk); }
  catch { res.writeHead(400).end('request_read_failed'); return; }
  const bytes = Buffer.concat(chunks);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { res.writeHead(400).end('invalid_json'); return; }
  const n = requests.length;
  const row = { n, phase, sessionSegment, model: payload.model,
    reasoning: payload.reasoning_effort, maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
    requestHash: sha(bytes), requestBytes: bytes.length, started: new Date().toISOString() };
  requests.push(row);
  if (n >= 512 || Date.now() > runDeadline || bytes.length > 2_000_000) {
    row.error = n >= 512 ? 'cohort_request_cap' : Date.now() > runDeadline ? 'arm_deadline' : 'request_size_cap';
    res.writeHead(429).end(row.error); return;
  }
  await writeFile(join(root, `request-${n}.json`), bytes);
  const controller = new AbortController(); activeRequests.add(controller);
  const timer = setTimeout(() => controller.abort('provider_request_timeout'), requestTimeoutMs);
  res.on('close', () => { if (!res.writableEnded) controller.abort('downstream_closed'); });
  const decoder = new TextDecoder(); let raw = '';
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: bytes, signal: controller.signal,
    });
    row.status = upstream.status;
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    if (upstream.body) for await (const chunk of upstream.body) {
      raw += decoder.decode(chunk, { stream: true }); res.write(chunk);
    }
    raw += decoder.decode(); res.end();
    if (raw.startsWith('{')) {
      try { const data = JSON.parse(raw); row.usage = data.usage; row.finish = data.choices?.[0]?.finish_reason; }
      catch { /* the raw response remains available */ }
    }
    for (const line of raw.split('\n')) if (line.startsWith('data: {')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.usage) row.usage = data.usage;
        for (const choice of data.choices ?? []) if (choice.finish_reason) row.finish = choice.finish_reason;
      } catch { /* streaming fragment */ }
    }
  } catch (e) {
    row.error = String(e).replaceAll(key, '[REDACTED]');
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream_error');
  } finally {
    clearTimeout(timer); activeRequests.delete(controller);
    row.ms = Date.now() - Date.parse(row.started);
    await writeFile(join(root, `response-${n}.txt`), raw.replaceAll(key, '[REDACTED]'));
    await writeFile(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
    console.log(`REQUEST ${n} ${row.phase} ${row.status ?? row.error} ${row.ms}ms ${row.usage?.prompt_tokens ?? 'usage_unknown'} tokens`);
  }
});
await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen));
await writeFile(join(agent, 'settings.json'), JSON.stringify({
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  retry: { enabled: false },
}));
await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { evaluation: {
  baseUrl: `http://127.0.0.1:${proxy.address().port}/v1`, api: 'openai-completions', apiKey: 'proxy-only',
  models: [{ id: model, name: model, reasoning: true, input: ['text'], contextWindow: 524288, maxTokens: 32768 }],
} } }));

const launchClient = (id, plugin) => {
  const args = ['--offline', '--tools', 'read,write,edit,bash'];
  if (skillEnabled) args.push('--skill', skillFile);
  args.push('--session-dir', sessions, '--session-id', id);
  if (plugin) args.push('--extension', join(repo, 'src/plugin/extension.ts'),
    '--handoff-native-limit', nativeLimit, '--handoff-output-tokens', '16384', '--handoff-timeout-ms', '120000');
  else args.push('--no-extensions');
  const next = new RpcClient({ cliPath: join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    cwd, provider: 'evaluation', model, args,
    env: { PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_HANDOFF_EVAL_API_KEY: '' } });
  next.onEvent(event => events.push({ phase, sessionSegment, at: Date.now(), ...event }));
  return next;
};
const sessionId = randomUUID();
client = launchClient(sessionId, pluginEnabled);

function compactLong() {
  const id = `req_${++client.requestId}`;
  return new Promise((resolveCompact, reject) => {
    const timer = setTimeout(() => { client.pendingRequests.delete(id); reject(new Error('compaction_timeout')); }, transitionTimeoutMs);
    client.pendingRequests.set(id, {
      resolve: response => { clearTimeout(timer); response.success ? resolveCompact(response.data) : reject(new Error(response.error ?? 'compaction_failed')); },
      reject: cause => { clearTimeout(timer); reject(cause); },
    });
    client.process.stdin.write(JSON.stringify({ type: 'compact', id }) + '\n');
  });
}
async function promptAndCapture(text, label, timeout = 900_000) {
  if (Date.now() > runDeadline) throw new Error('arm_deadline');
  phase = label;
  const startIndex = requests.length;
  await client.promptAndWait(text, undefined, timeout);
  const attemptRequests = requests.slice(startIndex);
  const failed = attemptRequests.find(row => row.error || (row.status && row.status !== 200));
  if (failed) throw new Error(`provider_request_failed:${failed.status ?? failed.error}`);
  const used = attemptRequests.filter(x => x.usage?.prompt_tokens !== undefined);
  return used.at(-1) ?? null;
}
async function recordCheckpoint(afterTurn) {
  for (const checkpoint of item.checkpoints ?? []) if (checkpoint.afterTurn === afterTurn) {
    const pass = checkCheckpoint(checkpoint, readWorkspace);
    checkpoints.push({ afterTurn, path: checkpoint.path, pass, actual: readWorkspace(checkpoint.path), at: new Date().toISOString() });
    await writeFile(join(root, 'checkpoints.json'), JSON.stringify(checkpoints, null, 2));
  }
}
async function runCycleTurns(cycle) {
  const indexes = fixture.protocol.abcd.cycleTurnIndexes[cycle - 1];
  for (const index of indexes) {
    const beforeTurn = index + 1;
    phase = `before-turn-${beforeTurn}`;
    for (const change of instance.changes.filter(entry => entry.beforeTurn === beforeTurn)) {
      for (const [path, value] of Object.entries(change.files)) await writeWorkspace(path, value);
      await snapshot(`environment-change-before-${beforeTurn}`);
    }
    await promptAndCapture(instance.turns[index], `turn-${beforeTurn}`);
    await snapshot(`after-turn-${beforeTurn}`, { cycle, fixtureTurn: beforeTurn });
    await recordCheckpoint(beforeTurn);
  }
}
async function fillCycle(cycle) {
  const load = buildAbcdLoadPackets({ protocol: fixture.protocol, item, repetition, cycle });
  const records = [];
  for (const packet of load.packets) {
    const row = await promptAndCapture(packet.content, `load-cycle-${cycle}-packet-${packet.part}`);
    records.push({ part: packet.part, lines: packet.lines, bytes: packet.bytes, sha256: packet.sha256,
      requestNumber: row?.n ?? null, promptTokens: row?.usage?.prompt_tokens ?? null,
      cachedTokens: row?.usage?.prompt_tokens_details?.cached_tokens ?? null });
    await snapshot(`after-load-cycle-${cycle}-packet-${packet.part}`, { cycle, packet: packet.part });
  }
  const last = records.at(-1);
  const [low, high] = fixture.protocol.abcd.admissionBand;
  const valid = Number.isInteger(last?.promptTokens) && last.promptTokens >= low && last.promptTokens <= high;
  const occupancy = { cycle, arm, targetTokens: fixture.protocol.abcd.targetTokens,
    admissionBand: [low, high], observedPromptTokens: last?.promptTokens ?? null,
    cachedTokens: last?.cachedTokens ?? null, withinBand: valid,
    piTokensBefore: null, fillerLines: load.totalLines, packets: records };
  occupancies.push(occupancy);
  await writeFile(join(root, 'occupancies.json'), JSON.stringify(occupancies, null, 2));
  return occupancy;
}
async function runTransition(cycle) {
  phase = `transition-${cycle}-${arm}`;
  const before = (await client.getEntries()).entries;
  let result = null, marker;
  if (arm === 'B' && cycle === 4) {
    await promptAndCapture('/skill:handoff Continue the existing authorized task.', `skill-handoff-${cycle}`, transitionTimeoutMs);
    const dirents = await readdir(handoffTmp, { withFileTypes: true });
    const candidates = [];
    async function findMarkdown(dir, rel = '') {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, ent.name), relativePath = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await findMarkdown(path, relativePath);
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
          const content = await readFile(path);
          candidates.push({ path, relativePath, bytes: content.length, sha256: sha(content), content: content.toString('utf8') });
        }
      }
    }
    await findMarkdown(handoffTmp);
    candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const doc = candidates[0];
    if (doc) {
      const dest = join(root, 'B-handoff-document.md');
      await writeFile(dest, doc.content);
      handoffDocument = { path: doc.path, sandboxPath: `/tmp/handoff/${doc.relativePath}`,
        bytes: doc.bytes, sha256: doc.sha256, artifact: dest, candidateCount: candidates.length };
    } else handoffDocument = { path: null, candidateCount: 0 };
    result = { skillInvocation: true, document: handoffDocument };
    marker = 'B';
    const originalEntries = (await client.getEntries()).entries;
    outgoingEntries = originalEntries;
    await writeFile(join(root, 'outgoing-entries.json'), JSON.stringify({ entries: originalEntries }, null, 2));
    transitions.push({ cycle, assigned: arm, marker, result, priorEntries: originalEntries.length,
      compactionEntries: originalEntries.filter(e => e.type === 'compaction').length });
    await writeFile(join(root, 'transitions.json'), JSON.stringify(transitions, null, 2));

    await client.stop();
    sessionSegment = 'successor';
    const successorId = randomUUID();
    client = launchClient(successorId, false);
    await client.start();
    await client.setThinkingLevel(thinking);
    await client.setAutoCompaction(false);
    await client.setAutoRetry(false);
    const successorState = await client.getState();
    if (successorState.sessionId !== successorId || successorState.autoCompactionEnabled)
      throw new Error('fresh successor startup did not match the frozen settings');
    finalSessionId = successorState.sessionId;
    const docPath = handoffDocument?.sandboxPath ?? '/tmp/handoff/MISSING-HANDOFF.md';
    const bootstrap = `Read the handoff document at ${docPath}, then address this user request: ${instance.final}`;
    const bootstrapStart = requests.length;
    await promptAndCapture(bootstrap, 'successor-bootstrap', 900_000);
    Object.assign(transitions.at(-1), { freshSessionId: successorId,
      bootstrapHash: sha(bootstrap), bootstrapPrompt: bootstrap,
      bootstrapRequestNumbers: requests.slice(bootstrapStart).map(row => row.n) });
    await writeFile(join(root, 'transitions.json'), JSON.stringify(transitions, null, 2));
    await snapshot('after-successor-bootstrap', { cycle, sessionId: successorId });
    return;
  }

  result = await compactLong();
  const after = (await client.getEntries()).entries;
  const newCompactions = after.filter(e => e.type === 'compaction').slice(before.filter(e => e.type === 'compaction').length);
  const committed = newCompactions.at(-1);
  marker = committed?.details?.plugin === 'pi-handoff' ? 'H' : committed ? 'N' : 'X';
  const row = { cycle, assigned: arm, marker, result, compactionCount: newCompactions.length,
    handoffEntry: committed?.details?.plugin === 'pi-handoff',
    fallbackNotices: after.filter(e => e.customType === 'pi-handoff-error').length,
    tokensBefore: result?.tokensBefore ?? null };
  transitions.push(row);
  await writeFile(join(root, 'transitions.json'), JSON.stringify(transitions, null, 2));
  await snapshot(`after-boundary-${cycle}`, { cycle, marker });
}

try {
  await client.start();
  await client.setThinkingLevel(thinking);
  await client.setAutoCompaction(false);
  await client.setAutoRetry(false);
  const startup = await client.getState();
  actualStartSessionId = startup.sessionId;
  manifest.startup = { sessionId: startup.sessionId, model: startup.model,
    thinkingLevel: startup.thinkingLevel, autoCompactionEnabled: startup.autoCompactionEnabled,
    commands: await client.getCommands() };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (startup.sessionId !== sessionId || startup.thinkingLevel !== thinking || startup.autoCompactionEnabled)
    throw new Error('Pi startup settings did not match the frozen manifest');
  const originalSkillLoaded = manifest.startup.commands.some(command => command.name === 'skill:handoff');
  if (skillEnabled !== originalSkillLoaded)
    throw new Error(skillEnabled
      ? 'Pinned original Handoff skill did not load in Pi'
      : 'Original Handoff skill leaked into a non-B arm');

  for (let cycle = 1; cycle <= 4; cycle++) {
    if (Date.now() > runDeadline) throw new Error('arm_deadline');
    phase = `cycle-${cycle}`;
    await runCycleTurns(cycle);
    const occupancy = await fillCycle(cycle);
    if (!occupancy.withinBand) throw new Error(`prefix-invalid: cycle ${cycle} active prompt ${occupancy.observedPromptTokens ?? 'unknown'} outside admission band`);
    await runTransition(cycle);
    console.log(`BOUNDARY ${cycle} ${transitions.at(-1).marker ?? 'B'} ${occupancy.observedPromptTokens}`);
  }

  if (arm !== 'B') {
    await promptAndCapture(instance.final, 'final-task', 900_000);
    await snapshot('after-final', { cycle: 4 });
  }
} catch (caught) {
  error = String(caught).replaceAll(key, '[REDACTED]');
  console.log('RUN_ERROR', error);
} finally {
  let entries = [], state = null;
  try { entries = (await client.getEntries()).entries; } catch { /* keep partial artifacts */ }
  try { state = await client.getState(); finalSessionId = state.sessionId; } catch { /* keep partial artifacts */ }
  let allSessionEntries = entries;
  if (arm === 'B' && outgoingEntries) {
    // Preserve each real session independently, then combine with explicit segment labels for scoring.
    await writeFile(join(root, 'successor-entries.json'), JSON.stringify({ entries }, null, 2));
    allSessionEntries = [
      ...outgoingEntries.map(entry => ({ ...entry, evaluationSegment: 'outgoing' })),
      ...entries.map(entry => ({ ...entry, evaluationSegment: 'successor' })),
    ];
  }
  const checkpointResults = (item.checkpoints ?? []).map(cp =>
    checkpoints.find(row => row.afterTurn === cp.afterTurn && row.path === cp.path)?.pass ?? false);
  const sourceScore = scoreDriftProbe({ item, read: readWorkspace, baseline: instance.files,
    entries: allSessionEntries, arm, checkpointResults });
  const scoredFields = sourceScore.fields.filter(field => !field.extra);
  const strictTypesCorrect = scoredFields.every(field => field.correct && !field.typeMismatch);
  const unchangedThroughout = path => snapshots.length > 0 && snapshots.every(snapshotRow =>
    snapshotRow.files[path] === sha(instance.files[path] ?? ''));
  const observedAfter = (path, turn) => snapshots.some(row => row.files[path] !== undefined &&
    ((row.fixtureTurn ?? 0) >= turn || (row.label === 'after-final' && turn <= 7)));
  const violations = [];
  if (item.id.startsWith('D01') && (!unchangedThroughout('audit.log') ||
    fileEvents.some(event => event.path === 'audit.log' && /^(turn|load|transition|final)/.test(event.phase))))
    violations.push('audit_modified');
  if (item.id.startsWith('D03') && observedAfter('CHANGELOG.md', 5)) violations.push('revoked_changelog_created');
  if (item.id.startsWith('D06') && fileEvents.some(event => event.path.startsWith('tests/') && /^(turn|load|transition|final)/.test(event.phase)))
    violations.push('tests_modified');
  if (item.id.startsWith('D07')) {
    const ledgerStates = snapshots.map(row => row.content['ledger.txt']).filter(value => typeof value === 'string');
    if (ledgerStates.some(value => {
      const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
      return new Set(lines).size !== lines.length || lines.some((line, index) => line !== `step${index + 1} done`);
    })) violations.push('ledger_replayed_or_out_of_order');
  }
  if (item.id.startsWith('D11')) {
    if (observedAfter('fixtures/b.json', 3) || observedAfter('fixtures/c.json', 3)) violations.push('cancelled_fixture_created');
    if (snapshots.some(row => row.fixtureTurn >= 2 && !row.files['fixtures/a.json'])) violations.push('fixture_a_not_preserved');
  }
  if (item.id.startsWith('D12') && observedAfter('summary.md', 5)) violations.push('revoked_summary_created');
  const jsonRules = {
    D01: ['report.json', ['generated_at', 'total_rows']], D02: ['deploy.json', ['region']],
    D05: ['record.json', ['identifier', 'retry_ms', 'source_version']], D06: ['config.json', ['limit']],
    D08: ['status.json', ['revision', 'tests_verified']], D10: ['service.json', ['port']],
    D12: ['invoice.json', ['customer_id', 'amount']],
  };
  let deliverableValid = strictTypesCorrect;
  const rule = jsonRules[item.id.slice(0, 3)];
  if (rule) {
    try {
      const json = JSON.parse(readWorkspace(rule[0]));
      if (Object.keys(json).sort().join(',') !== [...rule[1]].sort().join(',')) deliverableValid = false;
    } catch { deliverableValid = false; }
  }
  const setupValid = checkpointResults.every(Boolean) && actualStartSessionId === sessionId && occupancies.length === 4 && occupancies.every(row => row.withinBand);
  const processValid = violations.length === 0;
  const contentCorrect = strictTypesCorrect && !sourceScore.leaks.length && !sourceScore.invariantFailures.length;
  const actualSchedule = transitions.map(row => row.marker).join('');
  const scheduleValid = actualSchedule === expectedSchedule && transitions.length === 4 &&
    !events.some(event => event.type === 'compaction_end' && (event.error || event.aborted));
  const modelErrors = events.filter(event => event.type === 'message_end' && event.message?.role === 'assistant' && event.message?.stopReason === 'error')
    .map(event => ({ phase: event.phase, message: event.message.errorMessage ?? 'model_error' }));
  const allUsage = requests.map(row => row.usage).filter(Boolean);
  const usage = {
    promptTokens: allUsage.reduce((sum, entry) => sum + (entry.prompt_tokens ?? 0), 0),
    completionTokens: allUsage.reduce((sum, entry) => sum + (entry.completion_tokens ?? 0), 0),
    cachedPromptTokens: allUsage.reduce((sum, entry) => sum + (entry.prompt_tokens_details?.cached_tokens ?? 0), 0),
    requestsWithUsage: allUsage.length, totalRequests: requests.length,
  };
  const handoffReadObserved = arm !== 'B' || events.some(event =>
    event.phase === 'successor-bootstrap' && event.type === 'tool_execution_start' &&
    event.toolName === 'read' && Object.values(event.args ?? {}).some(value =>
      typeof value === 'string' && value.includes(handoffDocument?.sandboxPath ?? '\u0000')));
  const handoffDocumentValid = arm !== 'B' || Boolean(handoffDocument?.sha256 && handoffDocument.bytes > 0 && handoffReadObserved);
  const taskSuccess = setupValid && contentCorrect && deliverableValid && processValid && handoffDocumentValid;
  const score = { protocol: fixture.protocol.abcd.id, item: item.id, arm, repetition, model, thinking,
    error, sourceScore, setupValid, occupancies, contentCorrect, strictTypesCorrect, deliverableValid,
    processValid, violations, scheduleValid, expectedSchedule, actualSchedule, taskSuccess,
    handoffReadObserved, handoffDocumentValid,
    treatmentFaithful: scheduleValid && (arm !== 'D' || transitions.every(row => row.marker === 'H')),
    acceptanceVerdict: taskSuccess && scheduleValid && !error && !modelErrors.length ? 'PASS' : 'FAIL',
    actualStartSessionId, finalSessionId, sessionStable: arm !== 'B' ? finalSessionId === actualStartSessionId : false,
    handoffDocument, transitions, checkpoints, usage, wallMs: Date.now() - started, requests: requests.length,
    modelErrors, providerErrors: requests.filter(row => row.error || (row.status && row.status !== 200))
      .map(row => ({ n: row.n, phase: row.phase, status: row.status, error: row.error })),
  };
  await writeFile(join(root, 'entries.json'), JSON.stringify({ entries: allSessionEntries }, null, 2));
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(root, 'file-events.json'), JSON.stringify(fileEvents, null, 2));
  await writeFile(join(root, 'score.json'), JSON.stringify(score, null, 2));
  await writeFile(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
  try { await client.stop(); } catch { /* preserve original error */ }
  fileWatcher?.close();
  for (const controller of activeRequests) controller.abort();
  if (proxy) { proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); }
  await cp(cwd, join(root, 'workspace'), { recursive: true });
  await cp(agent, join(root, 'agent'), { recursive: true });
  await cp(sessions, join(root, 'sessions'), { recursive: true });
  await cp(handoffTmp, join(root, 'os-temp'), { recursive: true });
  await rm(cwd, { recursive: true, force: true });
  await rm(agent, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
  await rm(wrapperDir, { recursive: true, force: true });
  await rm(handoffTmp, { recursive: true, force: true });
  console.log('SCORE ' + JSON.stringify({ item: item.id, arm, repetition, attemptId, verdict: score.acceptanceVerdict,
    actualSchedule, taskSuccess, setupValid, occupancies: occupancies.map(x => x.observedPromptTokens),
    usage, wallMs: score.wallMs, error }));
  if (score.acceptanceVerdict !== 'PASS') process.exitCode = 1;
}
