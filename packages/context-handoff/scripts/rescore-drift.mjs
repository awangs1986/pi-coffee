// Uniform post-run correction of derived verdicts; preserves runner's first score.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Usage: node scripts/rescore-drift.mjs COHORT_DIR');
const cohort = JSON.parse(await readFile(join(root, 'cohort-manifest.json')));
const hash = value => createHash('sha256').update(value).digest('hex');
async function optionalJson(path, fallback) {
  try { return JSON.parse(await readFile(path)); } catch { return fallback; }
}
let rescored = 0;
for (const target of cohort.targets) {
  let score, entries, events, snapshots, requests, boundaries, fileEvents;
  try {
    score = await optionalJson(join(target.directory, 'score-runner.json'), null) ??
      JSON.parse(await readFile(join(target.directory, 'score.json')));
  } catch { continue; }
  entries = (await optionalJson(join(target.directory, 'entries.json'), { entries: [] })).entries;
  events = await optionalJson(join(target.directory, 'events.json'), []);
  snapshots = await optionalJson(join(target.directory, 'snapshots.json'), []);
  requests = await optionalJson(join(target.directory, 'requests.json'), []);
  boundaries = await optionalJson(join(target.directory, 'boundaries.json'), []);
  fileEvents = await optionalJson(join(target.directory, 'file-events.json'), []);
  if (!(await optionalJson(join(target.directory, 'score-runner.json'), null)))
    await writeFile(join(target.directory, 'score-runner.json'), JSON.stringify(score, null, 2));
  const fallbackNotices = entries.filter(e => e.customType === 'pi-handoff-error' &&
    String(e.content).includes('Used one native compaction')).length;
  score.scheduleValid = score.actualSchedule === score.expectedSchedule &&
    boundaries.length === 7 && fallbackNotices === 0 &&
    !events.some(e => e.type === 'compaction_end' && (e.error || e.aborted));
  score.fallbackNotices = fallbackNotices;
  score.setupValid = score.setupValid && requests.every(r =>
    r.model === cohort.model && r.reasoning === cohort.thinking);
  score.finalObserved = snapshots.some(s => s.label === 'after-final');
  if (score.id.startsWith('D03')) {
    const changelog = 'CHANGELOG.md';
    const beforeRevocation = snapshots.find(s => s.label === 'after-compact-4');
    const afterRevocation = snapshots.filter(s =>
      /^after-(?:turn|compact)-[5-7]$|^after-final$/.test(s.label));
    const laterEvents = fileEvents.filter(e => e.path === changelog &&
      /^(?:turn|compact)-[5-7]$|^final$/.test(e.phase));
    const explicitRemoval = events.some(e => e.phase === 'turn-5' &&
      e.type === 'tool_execution_start' && e.toolName === 'bash' &&
      /(?:^|[;&]\s*)rm\s+-f\s+CHANGELOG\.md(?:\s|$)/.test(e.args?.command ?? ''));
    const cleanupOnly = !!beforeRevocation?.files[changelog] &&
      afterRevocation.length > 0 && afterRevocation.every(s => !s.files[changelog]) &&
      laterEvents.length === 1 && laterEvents[0].phase === 'turn-5' &&
      laterEvents[0].event === 'rename' && explicitRemoval;
    score.revokedChangelogCleanupVerified = cleanupOnly;
    if (cleanupOnly) score.violations = score.violations.filter(v =>
      v !== 'revoked_changelog_created');
    score.processValid = score.violations.length === 0;
  }
  if (score.id.startsWith('D07')) {
    let ledger = null, timingValid = true;
    for (const snapshot of snapshots) {
      if (!snapshot.files['ledger.txt']) ledger = null;
      else if (Object.hasOwn(snapshot.content, 'ledger.txt')) ledger = snapshot.content['ledger.txt'];
      const match = snapshot.label.match(/^after-(?:turn|compact)-(\d)$/);
      if (!match) continue;
      const n = Number(match[1]);
      const expected = Array.from({ length: Math.min(3, Math.max(0, n - 1)) },
        (_, i) => `step${i + 1} done`);
      const actual = typeof ledger === 'string' ? ledger.split('\n').map(s => s.trim()).filter(Boolean) : [];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) timingValid = false;
    }
    score.ledgerTimingValid = timingValid;
    if (!timingValid && !score.violations.includes('ledger_step_wrong_time'))
      score.violations.push('ledger_step_wrong_time');
    score.processValid = score.violations.length === 0;
  }
  if (score.id.startsWith('D11')) {
    const checkpoint = score.checkpoints.find(c => c.afterTurn === 2 && c.path === 'fixtures/a.json');
    let validA = false;
    try { validA = JSON.parse(checkpoint?.actual ?? '').id === 'a'; } catch { /* invalid */ }
    const expectedHash = checkpoint?.actual ? hash(checkpoint.actual) : null;
    const preserved = !!expectedHash && snapshots.every(s => {
      if (!/^after-(turn|compact)-([2-7])$|^after-final$/.test(s.label)) return true;
      return s.files['fixtures/a.json'] === expectedHash;
    });
    score.fixtureAValidAndPreserved = validA && preserved;
    const forbiddenEver = snapshots.some(s => s.files['fixtures/b.json'] || s.files['fixtures/c.json']) ||
      fileEvents.some(e => ['fixtures/b.json', 'fixtures/c.json'].includes(e.path) &&
        /^(turn|compact|final)/.test(e.phase));
    score.cancelledFixturesNeverCreated = !forbiddenEver;
    if (forbiddenEver && !score.violations.includes('cancelled_fixture_created'))
      score.violations.push('cancelled_fixture_created');
    if (!score.fixtureAValidAndPreserved && !score.violations.includes('fixture_a_invalid_or_changed'))
      score.violations.push('fixture_a_invalid_or_changed');
    score.processValid = score.violations.length === 0;
  }
  if (score.id.startsWith('D13') && score.arm === 'handoff' &&
      score.sourceScore.engineeringFailures.length) {
    score.taskSuccess = false;
  } else {
    score.taskSuccess = score.finalObserved && score.setupValid && score.contentCorrect &&
      score.deliverableValid && score.processValid &&
      (!score.id.startsWith('D13') || score.arm === 'native' || score.actualSchedule.includes('H'));
  }
  score.acceptanceVerdict = score.taskSuccess && score.scheduleValid && score.sessionStable &&
    !score.error && !score.modelErrors.length ? 'PASS' : 'FAIL';
  score.rescoreVersion = 2;
  score.rescoreNote = 'Counts only actual native fallback notices; checks D07/D11 process evidence and distinguishes D03 post-revocation deletion from creation.';
  await writeFile(join(target.directory, 'score.json'), JSON.stringify(score, null, 2));
  rescored++;
}
console.log(`Uniformly rescored ${rescored}/${cohort.targets.length} completed runs.`);
