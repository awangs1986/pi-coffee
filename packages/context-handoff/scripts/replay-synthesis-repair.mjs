// Opt-in paid diagnosis of one bounded validator-feedback repair attempt.
// Inputs and outputs must remain outside Git; this does not modify the plugin.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validate } from '../dist/src/plugin/task-state.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [requestPath, responsePath, outputPath] = process.argv.slice(2);
if (!requestPath || !responsePath || !outputPath)
  throw Error('Usage: node scripts/replay-synthesis-repair.mjs CAPTURED_REQUEST CAPTURED_RESPONSE OUTSIDE_REPO_DIR');
const input = resolve(requestPath), prior = resolve(responsePath), output = resolve(outputPath);
if ([input, prior, output].some(p => !relative(repo, p).startsWith('..')))
  throw Error('Captured inputs and repair output must remain outside Git');
try { await stat(output); throw Error('Choose a new repair directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const timeoutMs = Number(process.env.PI_HANDOFF_EVAL_TIMEOUT_MS ?? 150000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
  throw Error('PI_HANDOFF_EVAL_TIMEOUT_MS must be an integer from 1000 to 300000');
const originalBytes = await readFile(input);
const original = JSON.parse(originalBytes);
if (!String(original.messages?.[0]?.content).startsWith('PI_HANDOFF_SYNTHESIS'))
  throw Error('Input is not a captured Handoff synthesis request');
const sources = JSON.parse(original.messages[1].content).sources;
if (!Array.isArray(sources)) throw Error('Original sources unavailable');
const priorRaw = await readFile(prior, 'utf8');
let previousContent = '';
for (const line of priorRaw.split('\n')) {
  if (!line.startsWith('data: {')) continue;
  try {
    const frame = JSON.parse(line.slice(6));
    for (const choice of frame.choices ?? []) previousContent += choice.delta?.content ?? '';
  } catch { /* The original raw response is preserved. */ }
}
let candidate, validationError;
try { candidate = JSON.parse(previousContent); }
catch { throw Error('Only parseable invalid Task State can be repaired'); }
try { validate(structuredClone(candidate), sources); throw Error('Captured Task State is already valid'); }
catch (error) {
  if (String(error).includes('already valid')) throw error;
  validationError = String(error);
}
const system = `PI_HANDOFF_VALIDATION_REPAIR
Fix the supplied Task State once. Return a complete JSON Task State, with no commentary or markdown. Preserve the authorized objective, effective correction, source IDs, status and pending work. Do not invent claims or evidence. The validator rejected the previous JSON with the stated error.
For exactValues, quote must exactly equal label + separator + value. A nonempty label requires a nonempty separator. If a split cannot be verified, omit the record; original evidence stays available for later retrieval.
For steps, work explicitly required after the upcoming Handoff must have phase after_handoff, status pending and completion []. A pre-Handoff tool call cannot complete it. nextAction must equal the first pending step text and have an attributed nextAction claim.
Use only the provided original sources to verify quotes and authorization. If the state cannot be repaired faithfully, return a state with status uncertain and explain the uncertainty in a sourced claim.`;
const repair = {
  model: original.model, stream: true, stream_options: { include_usage: true }, store: false,
  max_completion_tokens: original.max_completion_tokens,
  reasoning_effort: original.reasoning_effort,
  messages: [{ role: 'developer', content: system },
    { role: 'user', content: JSON.stringify({ validationError, candidate, sources }) }],
};
const body = Buffer.from(JSON.stringify(repair));
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
let state = null, repairError = null;
try { state = validate(JSON.parse(content), sources); }
catch (error) { repairError = String(error); }
const score = {
  model: repair.model, reasoning: repair.reasoning_effort,
  sourceHash: createHash('sha256').update(originalBytes).digest('hex'),
  inputError: validationError, status, finish, usage,
  transportError, providerError, repairError,
  valid: status === 200 && finish === 'stop' && !!state && !providerError,
  state: state ? { status: state.status, nextAction: state.nextAction,
    exactValues: state.exactValues.map(v => ({ field: v.field, value: v.value })),
    steps: state.steps.map(s => ({ phase: s.phase, status: s.status, text: s.text })),
  } : null,
  wallMs: Date.now() - started,
};
await writeFile(join(output, 'score.json'), JSON.stringify(score, null, 2));
console.log(JSON.stringify({ valid: score.valid, inputError: validationError,
  repairError, status, finish, usage, wallMs: score.wallMs }));
if (!score.valid) process.exitCode = 1;
