// Runs every predeclared D01-D13 pair, preserving every first attempt.
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = process.argv[2];
if (!arg || !process.env.PI_HANDOFF_EVAL_API_KEY)
  throw Error('Usage: PI_HANDOFF_EVAL_API_KEY=... node scripts/run-drift.mjs OUTSIDE_REPO');
const root = resolve(arg);
if (!relative(repo, root).startsWith('..')) throw Error('Artifacts must be outside Git');
await mkdir(root);
await mkdir(join(root, 'logs'));
const fixture = JSON.parse(await readFile(join(repo, 'test/fixtures/drift-probes.json')));
const thinking = process.env.PI_HANDOFF_EVAL_THINKING ?? 'high';
if (!['low', 'medium', 'high'].includes(thinking))
  throw Error('PI_HANDOFF_EVAL_THINKING must be low, medium or high');
let pairs = [];
for (const repetition of [1, 2, 3]) for (const item of fixture.items) {
  const nativeFirst = (repetition === 2) === (Number(item.id.slice(1, 3)) % 2 === 0);
  const arms = nativeFirst ? ['native', 'handoff'] : ['handoff', 'native'];
  pairs.push({ item: item.id, repetition, arms });
}
const resumeFrom = process.env.PI_HANDOFF_EVAL_RESUME_FROM;
if (resumeFrom) {
  const priorRoot = resolve(resumeFrom);
  const prior = JSON.parse(await readFile(join(priorRoot, 'cohort-manifest.json')));
  const selectedModel = process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash';
  const selectedProvider = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1';
  if (prior.model !== selectedModel || prior.provider !== selectedProvider || prior.thinking !== thinking)
    throw Error('Resume must use the same provider, model and thinking as the frozen source cohort');
  const affected = new Set();
  for (const target of prior.targets) {
    let score;
    try { score = JSON.parse(await readFile(join(target.directory, 'score.json'))); }
    catch { affected.add(`${target.repetition}:${target.item}`); continue; }
    if (score.modelErrors?.some(e => String(e.message).includes('insufficient_user_quota')) ||
        String(score.error ?? '').includes('insufficient_user_quota'))
      affected.add(`${target.repetition}:${target.item}`);
  }
  pairs = pairs.filter(p => affected.has(`${p.repetition}:${p.item}`));
  if (!pairs.length) throw Error('No quota-affected pairs to resume');
}
const targets = pairs.flatMap(pair => pair.arms.map(arm => ({
  item: pair.item, repetition: pair.repetition, arm,
  directory: join(root, `r${pair.repetition}-${pair.item}-${arm}`),
})));
const manifest = {
  cohort: resumeFrom ? 'main-63a85b8-D01-D13-quota-resume' : 'main-63a85b8-D01-D13',
  resumeFrom: resumeFrom ? resolve(resumeFrom) : null,
  started: new Date().toISOString(),
  model: process.env.PI_HANDOFF_EVAL_MODEL ?? 'gemini-3.8-flash',
  provider: process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.jingziai.club/v1',
  thinking, pairs, targets, concurrency: 3,
  executionNote: 'Provider, model and thinking are frozen for this cohort. ' +
    'Three independent pairs run at once, with the two arms sequential inside each pair.',
};
await writeFile(join(root, 'cohort-manifest.json'), JSON.stringify(manifest, null, 2));
let next = 0, completed = 0, haltReason = null;
const results = [];
async function runTarget(target) {
  const log = await open(join(root, 'logs', `r${target.repetition}-${target.item}-${target.arm}.log`), 'w');
  const started = Date.now();
  let code;
  try {
    code = await new Promise((done, reject) => {
      const child = spawn(process.execPath,
        [join(repo, 'scripts/evaluate-drift.mjs'), target.directory,
          target.item, target.arm, String(target.repetition)],
        { cwd: repo, env: process.env, stdio: ['ignore', log.fd, log.fd] });
      const timer = setTimeout(() => child.kill('SIGTERM'), 22 * 60_000);
      child.on('error', reject);
      child.on('close', value => { clearTimeout(timer); done(value); });
    });
  } catch (error) { code = null; await log.write(`\nDRIVER_ERROR ${String(error)}\n`); }
  await log.close();
  let score;
  try { score = JSON.parse(await readFile(join(target.directory, 'score.json'))); }
  catch { score = null; }
  const result = { ...target, exitCode: code, started: new Date(started).toISOString(),
    elapsedMs: Date.now() - started, verdict: score?.acceptanceVerdict ?? 'MISSING',
    taskSuccess: score?.taskSuccess ?? false, actualSchedule: score?.actualSchedule ?? '',
    error: score ? (score.error ?? null) : (code === null ? 'driver_error' : 'missing_score') };
  results.push(result);
  if (score?.modelErrors?.some(e => String(e.message).includes('insufficient_user_quota')) ||
      String(score?.error ?? '').includes('insufficient_user_quota'))
    haltReason = 'Provider reported insufficient_user_quota';
  await writeFile(join(root, 'progress.json'), JSON.stringify(results, null, 2));
  console.log(`DONE ${++completed}/${targets.length} ${target.item} r${target.repetition} ${target.arm} ` +
    `${result.verdict} ${Math.round(result.elapsedMs / 1000)}s ${result.actualSchedule}`);
}
async function worker() {
  while (!haltReason && next < pairs.length) {
    const pair = pairs[next++];
    for (const arm of pair.arms) {
      if (haltReason) break;
      await runTarget(targets.find(t =>
        t.item === pair.item && t.repetition === pair.repetition && t.arm === arm));
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
manifest.completed = new Date().toISOString();
manifest.status = haltReason ? 'HALTED' : 'COMPLETE';
manifest.haltReason = haltReason;
await writeFile(join(root, 'cohort-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.status} ${results.length}/${targets.length}; artifacts: ${root}`);
