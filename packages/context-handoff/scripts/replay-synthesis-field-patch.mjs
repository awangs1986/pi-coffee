// Opt-in paid diagnosis of one bounded field-only validator-feedback repair.
// Inputs and outputs must remain outside Git; this does not modify the plugin.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validate } from '../dist/src/plugin/task-state.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [requestPath, responsePath, outputPath] = process.argv.slice(2);
if (!requestPath || !responsePath || !outputPath)
  throw Error('Usage: node scripts/replay-synthesis-field-patch.mjs CAPTURED_REQUEST CAPTURED_RESPONSE OUTSIDE_REPO_DIR');
const input = resolve(requestPath), prior = resolve(responsePath), output = resolve(outputPath);
if ([input, prior, output].some(p => !relative(repo, p).startsWith('..')))
  throw Error('Captured inputs and repair output must remain outside Git');
try { await stat(output); throw Error('Choose a new repair directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const savedResponse = process.env.PI_HANDOFF_REPLAY_RESPONSE_PATH;
if (savedResponse && !relative(repo, resolve(savedResponse)).startsWith('..'))
  throw Error('Saved response must remain outside Git');
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key && !savedResponse) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const requiredPostSearch = process.env.PI_HANDOFF_REQUIRED_POST_SEARCH ?? null;
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
const system = `PI_HANDOFF_FIELD_PATCH
The Task State validator rejected the supplied candidate. Return JSON with EXACTLY two keys: exactValueSplits and stepChanges. Each is an array of CHANGED indexes only. Do not copy whole records, long quotations, the rest of Task State, markdown or commentary.
exactValueSplits entries have only index, label and separator. The program preserves field, value, source and quote. For each changed record, quote must equal label + separator + existing value. A nonempty label needs a separator containing a NON-WHITESPACE character. Example: if quote is "Its official language is English" and value is "English", return label "Its official language" and separator " is ".
stepChanges entries have only index, phase and status. The program preserves id, text and authorization. Examine EVERY step. If the original user required a search AFTER the upcoming Handoff, a similar search completed BEFORE it does not count: change that search step to phase after_handoff and status pending. The program will clear its pre-Handoff completion and set nextAction to the first pending step. Only read-only evidence search/read steps may be changed from completed to pending. Also change pending steps incorrectly marked before_handoff to after_handoff when user authorization says after. Verify timing against the original user source.
Use the supplied candidate and original sources. If no safe patch exists, return {"exactValueSplits":[],"stepChanges":[]}.`;
const validationErrors = [validationError];
try { validate({ ...structuredClone(candidate), exactValues: [] }, sources); }
catch (error) {
  if (!validationErrors.includes(String(error))) validationErrors.push(String(error));
}
if (requiredPostSearch && !candidate.steps.some(step =>
    step.phase === 'after_handoff' && step.status === 'pending' &&
    /search/i.test(step.text) && step.text.includes(requiredPostSearch)))
  validationErrors.push(`Post-Handoff search for ${requiredPostSearch} is not pending; pre-Handoff search cannot satisfy it`);
const repair = {
  model: original.model, stream: true, stream_options: { include_usage: true }, store: false,
  max_completion_tokens: Math.min(original.max_completion_tokens, 8192),
  reasoning_effort: original.reasoning_effort,
  messages: [{ role: 'developer', content: system },
    { role: 'user', content: JSON.stringify({ validationErrors, requiredPostSearch,
      candidate, sources }) }],
};
const body = Buffer.from(JSON.stringify(repair));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'request.json'), body);
const started = Date.now();
let raw = '', status = null, transportError = null;
if (savedResponse) {
  raw = await readFile(savedResponse, 'utf8');
  status = 200;
} else {
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body, signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    raw = await response.text();
  } catch (error) { transportError = String(error); }
}
await writeFile(join(output, 'response.txt'), key ? raw.replaceAll(key, '[REDACTED]') : raw);
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
let state = null, repairError = null, patch = null;
try {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  patch = JSON.parse(fenced ? fenced[1] : trimmed);
  if (!Array.isArray(patch.exactValueSplits) || !Array.isArray(patch.stepChanges) ||
      Object.keys(patch).length !== 2)
    throw Error('Invalid field-patch shape');
  const fixed = structuredClone(candidate);
  const exactSeen = new Set(), stepSeen = new Set();
  for (const part of patch.exactValueSplits) {
    if (!Number.isInteger(part.index) || part.index < 0 ||
        part.index >= fixed.exactValues.length || exactSeen.has(part.index) ||
        Object.keys(part).sort().join(',') !== 'index,label,separator' ||
        typeof part.label !== 'string' || typeof part.separator !== 'string')
      throw Error('Invalid exact-value field patch');
    exactSeen.add(part.index);
    fixed.exactValues[part.index].label = part.label;
    fixed.exactValues[part.index].separator = part.separator;
  }
  for (const part of patch.stepChanges) {
    if (!Number.isInteger(part.index) || part.index < 0 ||
        part.index >= fixed.steps.length || stepSeen.has(part.index) ||
        Object.keys(part).sort().join(',') !== 'index,phase,status' ||
        !['before_handoff', 'after_handoff', 'anytime'].includes(part.phase) ||
        !['pending', 'completed', 'uncertain'].includes(part.status))
      throw Error('Invalid step field patch');
    stepSeen.add(part.index);
    const before = candidate.steps[part.index];
    if (before.phase !== part.phase || before.status !== part.status) {
      const source = sources.find(s => s.id === before.authorization?.source);
      if (!source || !/after.{0,80}(handoff|fourth context maintenance boundary)/i.test(source.text))
        throw Error(`Field patch changed steps[${part.index}] without after-Handoff authorization`);
      if (part.phase !== 'after_handoff')
        throw Error('Only explicit after-Handoff work may change timing');
    }
    if (before.status !== part.status) {
      if (before.status !== 'completed' || part.status !== 'pending' ||
          !requiredPostSearch || !before.text.includes(requiredPostSearch) ||
          !/search.*evidence/i.test(before.text))
        throw Error('Only completed read-only evidence search may return to pending');
      fixed.steps[part.index].completion = [];
    }
    fixed.steps[part.index].phase = part.phase;
    fixed.steps[part.index].status = part.status;
  }
  const firstPending = fixed.steps.find(step => step.status === 'pending');
  if (fixed.status === 'active' && firstPending && fixed.nextAction !== firstPending.text) {
    const priorAction = fixed.nextAction;
    fixed.nextAction = firstPending.text;
    for (const claim of fixed.claims)
      if (claim.kind === 'nextAction' && claim.text === priorAction)
        claim.text = firstPending.text;
  }
  state = validate(fixed, sources);
} catch (error) { repairError = String(error); }
const score = {
  model: repair.model, reasoning: repair.reasoning_effort,
  sourceHash: createHash('sha256').update(originalBytes).digest('hex'),
  inputError: validationError, status, finish, usage,
  transportError, providerError, repairError,
  patch: patch ? { exactValueSplits: patch.exactValueSplits,
    stepChanges: patch.stepChanges } : null,
  valid: status === 200 && finish === 'stop' && !!state && !providerError,
  requiredPostSearch,
  postHandoffSearchPending: requiredPostSearch ? !!state?.steps.some(step =>
    step.phase === 'after_handoff' && step.status === 'pending' &&
    /search/i.test(step.text) && step.text.includes(requiredPostSearch)) : null,
  state: state ? { status: state.status, nextAction: state.nextAction,
    exactValues: state.exactValues.map(v => ({ field: v.field, value: v.value })),
    steps: state.steps.map(s => ({ phase: s.phase, status: s.status, text: s.text })),
  } : null,
  wallMs: Date.now() - started,
};
score.pass = score.valid && (!requiredPostSearch || score.postHandoffSearchPending);
await writeFile(join(output, 'score.json'), JSON.stringify(score, null, 2));
console.log(JSON.stringify({ valid: score.valid, pass: score.pass,
  postHandoffSearchPending: score.postHandoffSearchPending, inputError: validationError,
  repairError, status, finish, usage, wallMs: score.wallMs }));
if (!score.pass) process.exitCode = 1;
