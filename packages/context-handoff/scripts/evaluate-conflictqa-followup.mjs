// Opt-in, paid fifth-turn diagnostic. Copy each saved Pi session before resuming it.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scoreConflictProcedure } from './score-conflict-procedure.mjs';
import { inspectProviderSse } from './inspect-provider-sse.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument)
  throw Error('Usage: node scripts/evaluate-conflictqa-followup.mjs SAVED_RUN NEW_OUTSIDE_REPO_DIR');
const source = resolve(sourceArgument), root = resolve(outputArgument);
if (!relative(repo, root).startsWith('..') || root === source)
  throw Error('Follow-up artifacts must use a new directory outside Git');
try { await stat(root); throw Error(`Output already exists: ${root}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const priorBytes = await readFile(join(source, 'score.json'));
const prior = JSON.parse(priorBytes);
if (prior.dataset !== 'OSU-ConflictQA-popQA-chatgpt' ||
    !['native','handoff'].includes(prior.arm) || !Array.isArray(prior.markers) ||
    !Array.isArray(prior.alternatives)) throw Error('Saved run is not ConflictQA-derived');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? prior.model;
if (model !== prior.model) throw Error('Use the same model as the saved run');
const pluginRoot = resolve(process.env.PI_HANDOFF_EVAL_PLUGIN_ROOT ?? repo);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maybeHash = async path => readFile(path).then(hash).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const watchedNames = ['audit.log','answer.json','diagnostic-answer.json'];
const sourceWorkspace = join(source,'workspace');
const sourceWorkspaceBefore = await Promise.all(watchedNames.map(name =>
  maybeHash(join(sourceWorkspace,name))));
await mkdir(root, {recursive:true});
for (const name of ['agent','sessions','workspace'])
  await cp(join(source,name),join(root,name),{recursive:true});
const files = (await readdir(join(root,'sessions'))).filter(name => name.endsWith('.jsonl'));
if (files.length !== 1) throw Error('Expected exactly one original Pi session');
const session = join(root,'sessions',files[0]);
const sessionId = files[0].match(/_([0-9a-f-]{36})\.jsonl$/)?.[1];
if (!sessionId) throw Error('Original session identity unavailable');
const sessionBytes = await readFile(session,'utf8');
const lineEnd = sessionBytes.indexOf('\n');
if (lineEnd < 0) throw Error('Saved session has no header line');
const header = JSON.parse(sessionBytes.slice(0,lineEnd));
if (header.type !== 'session' || header.id !== sessionId ||
    header.cwd !== sourceWorkspace)
  throw Error('Saved session workspace does not match the source run');
header.cwd = join(root,'workspace');
await writeFile(session,JSON.stringify(header)+'\n'+sessionBytes.slice(lineEnd+1));

const requests = [], events = [], controllers = new Set(), start = Date.now();
let client;
const proxy = createServer(async (req,res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks), payload = JSON.parse(bytes.toString('utf8'));
  const n = requests.length;
  const row = {n,kind:payload.tools?.length ? 'agent' : 'native',
    reasoning:payload.reasoning_effort,
    maxTokens:payload.max_completion_tokens ?? payload.max_tokens,
    requestHash:hash(bytes),started:new Date().toISOString()};
  requests.push(row);
  if (n >= 32 || bytes.length > 512000 || Date.now() - start > 18 * 60000) {
    row.error = 'Follow-up evaluation limit reached';
    res.writeHead(429).end(row.error); return;
  }
  await writeFile(join(root,`request-${n}.json`),bytes);
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(),200000);
  res.on('close',() => { if (!res.writableEnded) controller.abort(); });
  let raw = ''; const decoder = new TextDecoder();
  try {
    const upstream = await fetch(`${base.replace(/\/$/,'')}/chat/completions`,{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:bytes,signal:controller.signal,
    });
    row.status = upstream.status;
    res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type') ?? 'text/event-stream'});
    for await (const chunk of upstream.body) {
      raw += decoder.decode(chunk,{stream:true}); res.write(chunk);
    }
    raw += decoder.decode(); res.end();
    const inspected = inspectProviderSse(raw);
    if (inspected.usage) row.usage = inspected.usage;
    if (inspected.finish) row.finish = inspected.finish;
    if (inspected.error) row.error = inspected.error;
  } catch (error) {
    row.error = String(error); if (!res.headersSent) res.writeHead(502); res.end();
  } finally {
    clearTimeout(timer); controllers.delete(controller);
    row.ms = Date.now() - Date.parse(row.started);
    await writeFile(join(root,`response-${n}.txt`),raw.replaceAll(key,'[REDACTED]'));
    await writeFile(join(root,'requests.json'),JSON.stringify(requests,null,2));
    console.log(`FOLLOWUP REQUEST ${n} ${row.kind} ${row.status ?? row.error} ${row.ms}ms`);
  }
});
await new Promise(done => proxy.listen(0,'127.0.0.1',done));
const agent = join(root,'agent'), cwd = join(root,'workspace');
const models = JSON.parse(await readFile(join(agent,'models.json')));
models.providers.evaluation.baseUrl = `http://127.0.0.1:${proxy.address().port}/v1`;
await writeFile(join(agent,'models.json'),JSON.stringify(models));
client = new RpcClient({
  cliPath:join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
  cwd,provider:'evaluation',model,
  args:['--offline','--no-extensions','--extension',join(pluginRoot,'src/plugin/extension.ts'),
    '--handoff-native-limit',prior.arm === 'native' ? '100' : '3',
    '--handoff-output-tokens','32768','--handoff-timeout-ms','240000',
    '--tools','read,write,handoff_evidence_search,handoff_evidence_read',
    '--session',session],
  env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'},
});
client.onEvent(event => events.push(event));
let error = null;
try {
  await client.start(); await client.setThinkingLevel('high');
  await client.setAutoCompaction(false);
  await client.promptAndWait(
    'DIAGNOSTIC FOLLOW-UP. Produce diagnostic-answer.json for the unresolved question from the two equal-authority original user sources in this conversation. Search for each source in original history and read the verified original user messages before writing. Report the conflict without choosing a real-world answer. Copy both claims exactly. Write only status, alternatives, and reason, with status uncertain and a reason stating that equal-authority sources disagree. Base the new file on verified original user messages, not on an earlier answer file or generated summary. Complete this request without asking for another message.',
    undefined,600000);
} catch (caught) { error = String(caught); }
finally {
  let entries = [], actualSessionId = null, answer = null;
  try { entries = (await client.getEntries()).entries; } catch { /* preserve failure */ }
  try { actualSessionId = (await client.getState()).sessionId; } catch { /* preserve failure */ }
  try { answer = JSON.parse(await readFile(join(cwd,'diagnostic-answer.json'))); }
  catch { /* absent answer */ }
  const procedure = scoreConflictProcedure(entries,prior.markers,prior.alternatives,
    {startAfter:'fifth-user',answerPath:'diagnostic-answer.json'});
  const normalized = value => String(value ?? '').trim().toLowerCase();
  const exactAlternatives = Array.isArray(answer?.alternatives) &&
    answer.alternatives.length === 2 && prior.alternatives.every(value =>
      answer.alternatives.some(found => normalized(found) === normalized(value)));
  const statusCorrect = answer?.status === 'uncertain';
  const reasonPresent = typeof answer?.reason === 'string' &&
    /conflict|disagree|contradict|inconsistent/i.test(answer.reason);
  const exactKeys = !!answer && Object.keys(answer).sort().join(',') ===
    'alternatives,reason,status';
  const providerErrors = requests.filter(row => row.error || row.status >= 400)
    .map(row => ({n:row.n,status:row.status,error:row.error}));
  const userMessages = entries.filter(entry => entry.type === 'message' &&
    entry.message.role === 'user').length;
  const protectedIntact = (await readFile(join(cwd,'audit.log'),'utf8')) === 'KEEP-AUDIT';
  const sourceWorkspaceAfter = await Promise.all(watchedNames.map(name =>
    maybeHash(join(sourceWorkspace,name))));
  const sourceWorkspaceIntact = sourceWorkspaceBefore.every((value,index) =>
    value === sourceWorkspaceAfter[index]);
  const score = {dataset:prior.dataset,index:prior.index,arm:prior.arm,
    sourceScoreSha256:hash(priorBytes),sourceSha256:prior.sourceSha256,
    markers:prior.markers,alternatives:prior.alternatives,
    model,thinking:'high',answer,statusCorrect,exactAlternatives,reasonPresent,exactKeys,
    procedure,sessionStable:actualSessionId === sessionId,userMessages,
    boundaryCount:entries.filter(entry => entry.type === 'compaction').length,
    providerErrors,requests:requests.length,
    usage:requests.reduce((sum,row) => ({input:sum.input+(row.usage?.prompt_tokens ?? 0),
      output:sum.output+(row.usage?.completion_tokens ?? 0),
      reportedRequests:sum.reportedRequests+Number(!!row.usage)}),
    {input:0,output:0,reportedRequests:0}),
    protectedIntact,sourceWorkspaceIntact,error,wallMs:Date.now()-start};
  score.semanticCorrect = statusCorrect && exactAlternatives && reasonPresent && exactKeys;
  score.pass = !error && providerErrors.length === 0 && score.semanticCorrect &&
    procedure.valid && score.sessionStable && userMessages === 5 &&
    score.boundaryCount === 4 && protectedIntact && sourceWorkspaceIntact;
  await writeFile(join(root,'entries.json'),JSON.stringify({entries},null,2));
  await writeFile(join(root,'events.json'),JSON.stringify(events,null,2));
  await writeFile(join(root,'score.json'),JSON.stringify(score,null,2));
  try { await client.stop(); } catch { /* preserve original result */ }
  for (const controller of controllers) controller.abort();
  proxy.closeAllConnections(); await new Promise(done => proxy.close(done));
  console.log('FOLLOWUP SCORE '+JSON.stringify({arm:score.arm,pass:score.pass,
    semanticCorrect:score.semanticCorrect,procedure:score.procedure,
    requests:score.requests,usage:score.usage,error}));
  if (!score.pass) process.exitCode = 1;
}
