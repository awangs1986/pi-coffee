// Opt-in paid replay of one captured model request, unchanged and outside Git.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectProviderSse } from './inspect-provider-sse.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg)
  throw Error('Usage: node scripts/replay-provider-request.mjs CAPTURED_REQUEST OUTSIDE_REPO_DIR');
const input = resolve(inputArg), output = resolve(outputArg);
if (!relative(repo, input).startsWith('..') || !relative(repo, output).startsWith('..'))
  throw Error('Captured request and replay output must remain outside Git');
try { await stat(output); throw Error('Choose a new replay directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = process.env.PI_HANDOFF_EVAL_API_KEY;
if (!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
const body = await readFile(input), request = JSON.parse(body);
const started = Date.now();
let raw = '', status = null, transportError = null;
try {
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method:'POST', headers:{Authorization:`Bearer ${key}`,
      'Content-Type':'application/json'},
    body, signal:AbortSignal.timeout(200000),
  });
  status = response.status;
  raw = await response.text();
} catch (error) { transportError = String(error); }
const stream = inspectProviderSse(raw);
const score = {
  model:request.model, reasoning:request.reasoning_effort,
  requestHash:createHash('sha256').update(body).digest('hex'),
  status, ...stream, transportError, wallMs:Date.now() - started,
};
await mkdir(output, {recursive:true});
await writeFile(join(output,'request.json'), body);
await writeFile(join(output,'response.txt'), raw.replaceAll(key,'[REDACTED]'));
await writeFile(join(output,'score.json'), JSON.stringify(score,null,2));
console.log(JSON.stringify(score));
if (status !== 200 || stream.error || transportError) process.exitCode = 1;
