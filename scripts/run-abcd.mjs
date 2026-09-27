// Serial, fixed-order pilot: four matched case repetitions across A/B/C/D.
// Every arm attempt and provider trace is retained outside Git, including failures.
import { spawn } from 'node:child_process';
import { cp, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputArgument = process.argv[2];
const importArgument = process.argv[3];
if (!outputArgument || !process.env.PI_HANDOFF_EVAL_API_KEY)
  throw new Error('Usage: PI_HANDOFF_EVAL_API_KEY=... node scripts/run-abcd.mjs OUTSIDE_REPO');
if (process.argv.length > 4) throw new Error('Only one optional validated D01/A import is supported');
const root = resolve(outputArgument);
if (!relative(repo, root).startsWith('..')) throw new Error('Artifacts must be outside Git');
try { await stat(root); throw new Error('Choose a new artifact directory; existing evidence is never overwritten'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const thinking = 'medium';
const base = process.env.PI_HANDOFF_EVAL_BASE_URL ?? 'https://api.commandcode.ai/provider/v1';
const model = process.env.PI_HANDOFF_EVAL_MODEL ?? 'meta/muse-spark-1.3-contributor';
const fixture = JSON.parse(await readFile(join(repo, 'test/fixtures/abcd-250k-v1.json'), 'utf8'));
const selected = ['D01', 'D05', 'D07', 'D10'];
const items = selected.map(prefix => fixture.items.find(item => item.id.startsWith(`${prefix}-`)));
if (items.some(item => !item)) throw new Error('The frozen pilot selection is incomplete');
const arms = ['A', 'B', 'C', 'D'];
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const targets = items.flatMap(item => arms.map(arm => ({
  item: item.id, arm, repetition: 1,
  directory: join(root, `${item.id}-${arm}-r1-attempt1`),
})));
let importedAttempt = null;
if (importArgument) {
  const source = resolve(importArgument);
  if (!relative(repo, source).startsWith('..')) throw new Error('Imported artifacts must be outside Git');
  const score = JSON.parse(await readFile(join(source, 'score.json'), 'utf8'));
  const sourceManifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  const first = targets[0];
  const sameBuild = sourceManifest.configBlob === git('hash-object', 'src/plugin/config.ts') &&
    sourceManifest.extensionBlob === git('hash-object', 'src/plugin/extension.ts') &&
    sourceManifest.testBlob === git('hash-object', 'test/pi-plugin.test.ts') &&
    sourceManifest.fixtureBlob === git('hash-object', 'test/fixtures/abcd-250k-v1.json') &&
    sourceManifest.workloadBlob === git('hash-object', 'scripts/abcd-workload.mjs');
  if (score.item !== first.item || score.arm !== 'A' || score.repetition !== 1 ||
      score.expectedSchedule !== 'NNNN' || score.actualSchedule !== 'NNNN' ||
      score.acceptanceVerdict !== 'PASS' || !score.setupValid || !score.scheduleValid ||
      sourceManifest.model !== model || sourceManifest.thinking !== 'medium' ||
      sourceManifest.provider !== new URL(base).origin || !sameBuild ||
      score.occupancies?.length !== 4 || score.occupancies.some(row => !row.withinBand))
    throw new Error('Imported result is not a passing, protocol-matched D01/A medium attempt');
  importedAttempt = { source, score, sourceManifest, target: first,
    scoreSha256: createHash('sha256').update(await readFile(join(source, 'score.json'))).digest('hex') };
}
const hashFiles = ['src/plugin/config.ts', 'src/plugin/extension.ts', 'test/pi-plugin.test.ts',
  'test/fixtures/abcd-250k-v1.json', 'scripts/abcd-workload.mjs', 'scripts/lint-abcd-fixture.mjs',
  'scripts/evaluate-abcd.mjs', 'scripts/run-abcd.mjs'];
const blobHashes = Object.fromEntries(hashFiles.map(path => [path, git('hash-object', path)]));
await mkdir(root, { recursive: true });
await mkdir(join(root, 'logs'));
const cohort = {
  id: 'abcd-250k-pilot-muse-medium-2026-09-27-v1',
  status: 'RUNNING', started: new Date().toISOString(),
  protocol: fixture.protocol.abcd.id, sourceCommit: git('rev-parse', 'HEAD'), blobHashes,
  model, provider: new URL(base).origin, thinking,
  targetTokens: fixture.protocol.abcd.targetTokens,
  admissionBand: fixture.protocol.abcd.admissionBand,
  arms: { A: 'NNNN', B: 'NNNB', C: 'NNNC', D: 'HHHH' },
  selectedCases: items.map(item => item.id), repetitions: [1], armOrder: arms,
  concurrency: 1,
  preflightArtifacts: [
    'abcd-250k-route-preflight-20260926-01 (external artifact)',
    'abcd-250k-route-preflight-20260926-02 (external artifact)',
  ],
  targets, results: [], importedAttempts: [],
  credentialHandling: 'Parent proxy only; never written to the manifest, child Pi environment, Git or request captures.',
};
if (importedAttempt) {
  await cp(importedAttempt.source, importedAttempt.target.directory, { recursive: true, errorOnExist: true });
  const { score, source } = importedAttempt;
  cohort.importedAttempts.push({ target: importedAttempt.target, source,
    sourceScoreSha256: importedAttempt.scoreSha256, attemptId: score.attemptId });
  cohort.results.push({
    ...importedAttempt.target, index: 1, attemptId: score.attemptId ?? 'r1', importedFrom: source,
    exitCode: 0, spawnError: null, started: importedAttempt.sourceManifest.started,
    elapsedMs: score.wallMs, verdict: score.acceptanceVerdict, actualSchedule: score.actualSchedule,
    occupancies: score.occupancies.map(row => row.observedPromptTokens), error: score.error,
    providerErrors: score.providerErrors,
  });
}
await writeFile(join(root, 'cohort-manifest.json'), JSON.stringify(cohort, null, 2));

let interrupted = false, activeChild = null, haltReason = null;
const onSignal = signal => {
  interrupted = true;
  haltReason = `received_${signal}`;
  activeChild?.kill('SIGTERM');
};
process.once('SIGINT', () => onSignal('SIGINT'));
process.once('SIGTERM', () => onSignal('SIGTERM'));

async function runTarget(target, index) {
  await mkdir(target.directory, { recursive: true });
  const logPath = join(target.directory, 'driver.log');
  const log = await open(logPath, 'w');
  const attemptId = `${cohort.id}-${target.item.slice(0, 3)}-${target.arm}-r${target.repetition}-a1`;
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
  catch { /* missing score remains an explicit failed attempt */ }
  const result = {
    ...target, index: index + 1, attemptId, exitCode, spawnError,
    started: new Date(started).toISOString(), elapsedMs: Date.now() - started,
    verdict: score?.acceptanceVerdict ?? 'MISSING',
    actualSchedule: score?.actualSchedule ?? '',
    occupancies: score?.occupancies?.map(row => row.observedPromptTokens) ?? [],
    error: score?.error ?? null,
    providerErrors: score?.providerErrors ?? [],
  };
  cohort.results.push(result);
  await writeFile(join(root, 'cohort-manifest.json'), JSON.stringify(cohort, null, 2));
  console.log(`ATTEMPT ${index + 1}/${targets.length} ${target.item.slice(0, 3)} ${target.arm} ` +
    `${result.verdict} ${result.actualSchedule || '-'} ${Math.round(result.elapsedMs / 1000)}s`);
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
  for (let index = 0; index < targets.length && !interrupted && !haltReason; index++)
    if (cohort.results.some(result => result.index === index + 1))
      console.log(`IMPORTED ${index + 1}/${targets.length} ${targets[index].item.slice(0, 3)} ${targets[index].arm}`);
    else await runTarget(targets[index], index);
} catch (error) {
  haltReason ??= `driver_error: ${String(error)}`;
  console.error('DRIVER_ERROR', String(error));
} finally {
  cohort.completed = new Date().toISOString();
  cohort.status = interrupted ? 'INTERRUPTED' : haltReason ? 'HALTED' : 'COMPLETE';
  cohort.haltReason = haltReason;
  await writeFile(join(root, 'cohort-manifest.json'), JSON.stringify(cohort, null, 2));
  console.log(`${cohort.status} ${cohort.results.length}/${targets.length}; artifacts: ${root}`);
}
if (cohort.status !== 'COMPLETE') process.exitCode = 1;
