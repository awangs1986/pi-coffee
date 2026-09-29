// Opt-in paid diagnosis: replay one captured Handoff synthesis request.
// Captured requests, responses and scores must remain outside Git.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validate } from '../dist/src/plugin/task-state.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [requestPath, outputPath, variant] = process.argv.slice(2);
if (!requestPath || !outputPath || !['baseline', 'candidate'].includes(variant))
  throw Error('Usage: node scripts/replay-synthesis.mjs CAPTURED_REQUEST OUTSIDE_REPO_DIR baseline|candidate');
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
if (request.messages?.length !== 2 || !String(request.messages[0].content).startsWith('PI_HANDOFF_SYNTHESIS'))
  throw Error('Input is not a captured Handoff synthesis request');
const sourcePacket = JSON.parse(request.messages[1].content);
if (!Array.isArray(sourcePacket.sources)) throw Error('Captured original sources unavailable');

const candidateSuffix = `
FINAL FIELD AND TIME CHECK BEFORE RETURNING JSON:
- Every exactValues record with a nonempty label MUST have a nonempty separator. quote must equal label + separator + value character for character. Example: {"label":"Its official language","separator":" is ","value":"English","quote":"Its official language is English"}. Never put a trailing delimiter into label with separator empty. If an exact-value split cannot be verified, omit that record and record uncertainty; do not invalidate the whole Task State.
- A requirement to search/read AFTER the upcoming fourth boundary means after THIS Handoff. Any such step has phase "after_handoff", status "pending", completion []. A similar pre-Handoff tool call does not complete it. Set nextAction to the FIRST pending step text and include the matching nextAction claim.
- Check the complete JSON against those rules once before output. Do not output the checklist. No markdown.`;
if (variant === 'candidate') request.messages[0].content += candidateSuffix;
const body = variant === 'baseline' ? originalBytes : Buffer.from(JSON.stringify(request));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'request.json'), body);
const started = Date.now();
let raw = '', status = null, transportError = null;
try {
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  status = response.status;
  raw = await response.text();
} catch (error) { transportError = String(error); }
await writeFile(join(output, 'response.txt'), raw.replaceAll(key, '[REDACTED]'));
let content = '', finish = null, usage = null, providerError = null;
for (const line of raw.split('\n')) {
  if (!line.startsWith('data: {')) continue;
  try {
    const frame = JSON.parse(line.slice(6));
    if (frame.usage) usage = frame.usage;
    if (frame.error) providerError = frame.error;
    for (const choice of frame.choices ?? []) {
      content += choice.delta?.content ?? '';
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  } catch { /* Preserve raw response for malformed frames. */ }
}
let state = null, validationError = null;
try { state = validate(JSON.parse(content), sourcePacket.sources); }
catch (error) { validationError = String(error); }
const score = {
  variant, model: request.model, reasoning: request.reasoning_effort,
  sourceHash: createHash('sha256').update(originalBytes).digest('hex'),
  requestHash: createHash('sha256').update(body).digest('hex'),
  sourceCount: sourcePacket.sources.length, status, finish, usage,
  transportError, providerError, validationError,
  valid: status === 200 && finish === 'stop' && !!state && !providerError,
  state: state ? {
    status: state.status, nextAction: state.nextAction,
    exactValues: state.exactValues.map(v => ({ field: v.field, value: v.value })),
    steps: state.steps.map(s => ({ phase: s.phase, status: s.status, text: s.text })),
  } : null,
  wallMs: Date.now() - started,
};
await writeFile(join(output, 'score.json'), JSON.stringify(score, null, 2));
console.log(JSON.stringify({ variant, valid: score.valid, validationError,
  status, finish, usage, wallMs: score.wallMs }));
if (!score.valid) process.exitCode = 1;
