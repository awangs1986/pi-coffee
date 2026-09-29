// Opt-in paid diagnosis of the next evidence-tool choice from a frozen Pi request.
// Captured requests, responses and scores must remain outside Git.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [requestPath, outputPath, variant] = process.argv.slice(2);
if (!requestPath || !outputPath || !['baseline', 'required-fields', 'split-tools'].includes(variant))
  throw Error('Usage: node scripts/replay-evidence-call.mjs CAPTURED_REQUEST OUTSIDE_REPO_DIR baseline|required-fields|split-tools');
const output = resolve(outputPath), input = resolve(requestPath);
if (!relative(repo, output).startsWith('..') || !relative(repo, input).startsWith('..'))
  throw Error('Captured requests and replay outputs must remain outside Git');
try { await stat(output); throw Error('Choose a new replay directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const timeoutMs = Number(process.env.PI_HANDOFF_EVAL_TIMEOUT_MS ?? 150000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
  throw Error('PI_HANDOFF_EVAL_TIMEOUT_MS must be an integer from 1000 to 300000');
const originalBytes = await readFile(input);
const request = JSON.parse(originalBytes);
const tool = request.tools?.find(t => t.function?.name === 'handoff_evidence');
if (!tool) throw Error('Captured request has no handoff_evidence tool');
const matches = JSON.parse(request.messages.at(-1)?.content ?? '{}').matches;
if (!Array.isArray(matches)) throw Error('Captured request must end with evidence search results');
const expectedAnchor = matches.find(m => m.role === 'user')?.anchor;
if (!expectedAnchor) throw Error('No original user anchor in search results');

if (variant === 'required-fields') {
  tool.function.description = 'Search with {action:"search",query:"..."}; read a returned original anchor with {action:"read",anchor:"...",start:0,limit:4096}. After a search result, use read. A search with anchor but no query is invalid.';
  tool.function.parameters = {
    oneOf: [
      { type: 'object', required: ['action', 'query'], additionalProperties: false,
        properties: { action: { type: 'string', const: 'search' },
          query: { type: 'string', maxLength: 256 }, cursor: { type: 'integer', minimum: 0 } } },
      { type: 'object', required: ['action', 'anchor'], additionalProperties: false,
        properties: { action: { type: 'string', const: 'read' },
          anchor: { type: 'string', maxLength: 256 }, start: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 4096 } } },
    ],
  };
}
if (variant === 'split-tools') {
  request.tools = request.tools.filter(t => t !== tool);
  request.tools.push({ type: 'function', function: {
    name: 'handoff_evidence_search', description: 'Search original history by exact query. Returns verified anchors. To inspect a returned anchor, call handoff_evidence_read.',
    parameters: { type: 'object', required: ['query'], additionalProperties: false,
      properties: { query: { type: 'string', maxLength: 256 }, cursor: { type: 'integer', minimum: 0 } } },
  } });
  request.tools.push({ type: 'function', function: {
    name: 'handoff_evidence_read', description: 'Read a verified original anchor returned by evidence search. This is the required next step after finding the source.',
    parameters: { type: 'object', required: ['anchor'], additionalProperties: false,
      properties: { anchor: { type: 'string', maxLength: 256 }, start: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 4096 } } },
  } });
}
const body = variant === 'baseline' ? originalBytes : Buffer.from(JSON.stringify(request));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'request.json'), body);
const started = Date.now();
let raw = '', status = null, transportError = null;
try {
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body, signal: AbortSignal.timeout(timeoutMs),
  });
  status = response.status;
  raw = await response.text();
} catch (error) { transportError = String(error); }
await writeFile(join(output, 'response.txt'), raw.replaceAll(key, '[REDACTED]'));
const calls = new Map();
let finish = null, usage = null, providerError = null;
for (const line of raw.split('\n')) {
  if (!line.startsWith('data: {')) continue;
  try {
    const frame = JSON.parse(line.slice(6));
    if (frame.usage) usage = frame.usage;
    if (frame.error) providerError = frame.error;
    for (const choice of frame.choices ?? []) {
      if (choice.finish_reason) finish = choice.finish_reason;
      for (const fragment of choice.delta?.tool_calls ?? []) {
        const call = calls.get(fragment.index) ?? { name: '', arguments: '' };
        call.name += fragment.function?.name ?? '';
        call.arguments += fragment.function?.arguments ?? '';
        calls.set(fragment.index, call);
      }
    }
  } catch { /* Preserve raw response for malformed frames. */ }
}
const parsedCalls = [...calls.values()].map(call => {
  try { return { name: call.name, arguments: JSON.parse(call.arguments) }; }
  catch { return { name: call.name, arguments: call.arguments, malformed: true }; }
});
const correctRead = parsedCalls.some(call =>
  (variant === 'split-tools'
    ? call.name === 'handoff_evidence_read'
    : call.name === 'handoff_evidence' && call.arguments?.action === 'read') &&
  call.arguments?.anchor === expectedAnchor);
const score = {
  variant, model: request.model, reasoning: request.reasoning_effort,
  sourceHash: createHash('sha256').update(originalBytes).digest('hex'),
  requestHash: createHash('sha256').update(body).digest('hex'),
  status, finish, usage, transportError, providerError,
  expectedAnchor, calls: parsedCalls, correctRead,
  wallMs: Date.now() - started,
};
await writeFile(join(output, 'score.json'), JSON.stringify(score, null, 2));
console.log(JSON.stringify({ variant, correctRead, status, finish, calls: parsedCalls,
  usage, wallMs: score.wallMs }));
if (!correctRead) process.exitCode = 1;
