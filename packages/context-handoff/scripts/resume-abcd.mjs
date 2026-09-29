// Continue the halted pilot with a new attempt ID per rerun. Original artifacts stay intact.
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootArgument = process.argv[2];
const dryRun = process.argv[3] === '--dry-run';
if (!rootArgument || (!dryRun && !process.env.PI_HANDOFF_EVAL_API_KEY) || process.argv.length > 4)
  throw new Error('Usage: PI_HANDOFF_EVAL_API_KEY=... node scripts/resume-abcd.mjs EXISTING_PILOT_DIRECTORY [--dry-run]');
const root = resolve(rootArgument);
if (!relative(repo, root).startsWith('..')) throw new Error('Artifacts must be outside Git');
const cohortPath = join(root, 'cohort-manifest.json');
const cohort = JSON.parse(await readFile(cohortPath, 'utf8'));
if (cohort.protocol !== 'abcd-250k-v1' || !['HALTED', 'INTERRUPTED'].includes(cohort.status))
  throw new Error('Only a halted or interrupted ABCD pilot can be resumed');

const thinking = 'medium';
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.commandcode.ai/provider/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'meta/muse-spark-1.3-contributor';
if (cohort.model !== model || cohort.provider !== new URL(base).origin || cohort.thinking !== thinking)
  throw new Error('Resume must use the original provider, model and medium thinking setting');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const currentCore = {
  config: git('hash-object', 'src/plugin/config.ts'),
  extension: git('hash-object', 'src/plugin/extension.ts'),
  tests: git('hash-object', 'test/pi-plugin.test.ts'),
  fixture: git('hash-object', 'test/fixtures/abcd-250k-v1.json'),
  workload: git('hash-object', 'scripts/abcd-workload.mjs'),
};
const frozenCore = {
  config: cohort.blobHashes['src/plugin/config.ts'],
  extension: cohort.blobHashes['src/plugin/extension.ts'],
  tests: cohort.blobHashes['test/pi-plugin.test.ts'],
  fixture: cohort.blobHashes['test/fixtures/abcd-250k-v1.json'],
  workload: cohort.blobHashes['scripts/abcd-workload.mjs'],
};
if (JSON.stringify(currentCore) !== JSON.stringify(frozenCore))
  throw new Error('Plugin, test or fixture hashes changed; start a new named cohort instead');

const fixture = JSON.parse(await readFile(join(repo, 'test/fixtures/abcd-250k-v1.json'), 'utf8'));
const selected = ['D01', 'D05', 'D07', 'D10'];
const items = selected.map(prefix => fixture.items.find(item => item.id.startsWith(`${prefix}-`)));
if (items.some(item => !item)) throw new Error('Frozen pilot item is missing');
const arms = ['A', 'B', 'C', 'D'];
const targets = items.flatMap(item => arms.map(arm => ({ item: item.id, arm, repetition: 1 })));
const keyOf = target => `${target.item}|${target.arm}|${target.repetition}`;
const targetIndices = new Map(targets.map((target, index) => [keyOf(target), index]));
const priorAttempts = cohort.results ?? [];
const priorFor = target => priorAttempts.filter(result => keyOf(result) === keyOf(target));

// Repeat B only while the corrected transfer attempt has not completed.
const correctedB = ['D01', 'D05', 'D07'].filter(prefix => {
  const item = items.find(row => row.id.startsWith(`${prefix}-`));
  const prior = priorFor({ item: item.id, arm: 'B', repetition: 1 });
  return !prior.some(result => result.attemptIndex >= 2 &&
    !['INTERRUPTED', 'MISSING'].includes(result.verdict));
}).map(prefix => {
  const item = items.find(row => row.id.startsWith(`${prefix}-`));
  return { item: item.id, arm: 'B', repetition: 1, reason: 'new attempt after fixing the temporary-directory bind' };
});
// Retry interrupted attempts into fresh directories, keeping partial evidence intact.
const interruptedTargets = targets.filter(target => priorFor(target).at(-1)?.verdict === 'INTERRUPTED')
  .map(target => ({ ...target, reason: 'new attempt after preserving an interrupted run' }));
// Finish target rows that the provider limit prevented from starting.
const unstarted = targets.filter(target => !priorFor(target).length);
const planned = [...correctedB, ...interruptedTargets, ...unstarted];
const resumeId = `${cohort.id}-resume-${(cohort.resumes?.length ?? 0) + 1}`;
const revisionHashes = Object.fromEntries([
  'src/plugin/config.ts', 'src/plugin/extension.ts', 'test/fixtures/abcd-250k-v1.json',
  'scripts/abcd-workload.mjs', 'scripts/evaluate-abcd.mjs', 'scripts/resume-abcd.mjs',
].map(path => [path, git('hash-object', path)]));
const runPlan = planned.map(target => {
  const previous = priorFor(target);
  const attemptIndex = previous.length + 1;
  const targetIndex = targetIndices.get(keyOf(target));
  const originalDirectory = cohort.targets[targetIndex].directory;
  const directory = attemptIndex === 1 ? originalDirectory :
    join(root, `${target.item}-${target.arm}-r${target.repetition}-attempt${attemptIndex}`);
  return { ...target, index: targetIndex + 1, attemptIndex, directory };
});
const existingPaths = new Set();
for (const target of runPlan) {
  if (existingPaths.has(target.directory)) throw new Error(`Duplicate planned artifact directory: ${target.directory}`);
  existingPaths.add(target.directory);
  try { await stat(target.directory); throw new Error(`Refusing to overwrite attempt: ${target.directory}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (dryRun) {
  console.log(JSON.stringify({ resumeTargets: runPlan.map(({ item, arm, repetition, index, attemptIndex, directory }) =>
    ({ item, arm, repetition, index, attemptIndex, directory })) }, null, 2));
  process.exit(0);
}

const resumeRecord = {
  id: resumeId, started: new Date().toISOString(), status: 'RUNNING',
  reason: 'Provider five-hour limit interrupted the first pass; original attempts remain unchanged.',
  model, provider: new URL(base).origin, thinking, revisionHashes, targets: runPlan,
};
cohort.resumes ??= [];
cohort.resumes.push(resumeRecord);
cohort.status = 'RUNNING';
cohort.haltReason = null;
await writeFile(cohortPath, JSON.stringify(cohort, null, 2));

let interrupted = false, activeChild = null, haltReason = null;
process.once('SIGINT', () => { interrupted = true; haltReason = 'received_SIGINT'; activeChild?.kill('SIGTERM'); });
process.once('SIGTERM', () => { interrupted = true; haltReason = 'received_SIGTERM'; activeChild?.kill('SIGTERM'); });

async function runTarget(target, planIndex) {
  await mkdir(target.directory, { recursive: true });
  const log = await open(join(target.directory, `driver-a${target.attemptIndex}.log`), 'w');
  const attemptId = `${resumeId}-${target.item.slice(0, 3)}-${target.arm}-r${target.repetition}-a${target.attemptIndex}`;
  const started = Date.now();
  let exitCode = null, spawnError = null;
  try {
    exitCode = await new Promise((resolveExit, rejectSpawn) => {
      const child = spawn(process.execPath, [join(repo, 'scripts/evaluate-abcd.mjs'),
        target.directory, target.item, target.arm, String(target.repetition)], {
        cwd: repo,
        env: { ...process.env, PI_HANDOFF_EVAL_THINKING: thinking, PI_HANDOFF_EVAL_ATTEMPT_ID: attemptId },
        stdio: ['ignore', log.fd, log.fd],
      });
      activeChild = child;
      child.once('error', rejectSpawn);
      child.once('close', code => { activeChild = null; resolveExit(code); });
    });
  } catch (error) { spawnError = String(error); }
  await log.close();
  let score = null;
  try { score = JSON.parse(await readFile(join(target.directory, 'score.json'), 'utf8')); }
  catch { /* retain an explicit missing-score attempt */ }
  const result = {
    item: target.item, arm: target.arm, repetition: target.repetition,
    index: target.index, attemptIndex: target.attemptIndex, directory: target.directory,
    attemptId, resumeId, exitCode, spawnError,
    started: new Date(started).toISOString(), elapsedMs: Date.now() - started,
    verdict: score?.acceptanceVerdict ?? 'MISSING', actualSchedule: score?.actualSchedule ?? '',
    occupancies: score?.occupancies?.map(row => row.observedPromptTokens) ?? [],
    error: score?.error ?? null, providerErrors: score?.providerErrors ?? [],
  };
  cohort.results.push(result);
  resumeRecord.targets[planIndex].result = result;
  await writeFile(cohortPath, JSON.stringify(cohort, null, 2));
  console.log(`RESUME ${planIndex + 1}/${runPlan.length} ${target.item.slice(0, 3)} ${target.arm} ` +
    `attempt ${target.attemptIndex} ${result.verdict} ${result.actualSchedule || '-'} ` +
    `${Math.round(result.elapsedMs / 1000)}s`);
  if (result.providerErrors.some(error => error.status === 402 || error.status === 429) ||
      /insufficient_user_quota|quota_exceeded|rate.?limit/i.test(JSON.stringify(result.providerErrors)))
    haltReason = 'provider_quota_or_rate_limit';
}

try {
  const lint = await new Promise((resolveExit, rejectSpawn) => {
    const child = spawn(process.execPath, [join(repo, 'scripts/lint-abcd-fixture.mjs')],
      { cwd: repo, stdio: 'inherit' });
    child.once('error', rejectSpawn);
    child.once('close', code => resolveExit(code));
  });
  if (lint !== 0) throw new Error(`ABCD fixture lint failed with exit ${lint}`);
  for (let index = 0; index < runPlan.length && !interrupted && !haltReason; index++)
    await runTarget(runPlan[index], index);
} catch (error) {
  haltReason ??= `resume_error: ${String(error)}`;
  console.error('RESUME_ERROR', String(error));
} finally {
  resumeRecord.completed = new Date().toISOString();
  resumeRecord.status = interrupted ? 'INTERRUPTED' : haltReason ? 'HALTED' : 'COMPLETE';
  resumeRecord.haltReason = haltReason;
  cohort.completed = resumeRecord.completed;
  cohort.status = haltReason ? 'HALTED' : 'COMPLETE';
  cohort.haltReason = haltReason;
  await writeFile(cohortPath, JSON.stringify(cohort, null, 2));
  console.log(`${cohort.status} resume ${resumeRecord.targets.filter(target => target.result).length}/${runPlan.length}; artifacts: ${root}`);
}
if (cohort.status !== 'COMPLETE') process.exitCode = 1;
