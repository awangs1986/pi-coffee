// Re-score saved ConflictQA-derived conversations without overwriting originals.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scoreConflictProcedure } from './score-conflict-procedure.mjs';
import { inspectProviderSse } from './inspect-provider-sse.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directories = process.argv.slice(2);
if (!directories.length)
  throw Error('Usage: node scripts/rescore-conflictqa.mjs OUTSIDE_REPO_RUN_DIR...');
for (const argument of directories) {
  const root = resolve(argument);
  if (!relative(repo, root).startsWith('..'))
    throw Error('Run artifacts must remain outside Git');
  const output = join(root, 'score-rescored-v2.json');
  try { await stat(output); throw Error(`Existing rescore would be overwritten: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scoreBytes = await readFile(join(root, 'score.json'));
  const entriesBytes = await readFile(join(root, 'entries.json'));
  const prior = JSON.parse(scoreBytes), entries = JSON.parse(entriesBytes).entries;
  if (!Array.isArray(prior.markers) || !Array.isArray(prior.alternatives) ||
      !Array.isArray(entries)) throw Error(`Not a ConflictQA run: ${root}`);
  const procedure = scoreConflictProcedure(entries, prior.markers, prior.alternatives);
  const requests = JSON.parse(await readFile(join(root, 'requests.json')));
  const providerErrors = [];
  for (const row of requests) {
    const raw = await readFile(join(root, `response-${row.n}.txt`), 'utf8')
      .catch(() => '');
    const inspected = inspectProviderSse(raw);
    const error = row.error ?? inspected.error;
    if (error || row.status >= 400)
      providerErrors.push({ n:row.n, status:row.status, error });
  }
  const pass = providerErrors.length === 0 && prior.statusCorrect &&
    prior.exactAlternatives && prior.reasonPresent && prior.exactKeys &&
    procedure.valid && prior.boundaryCount === 4 && prior.sessionStable &&
    prior.userMessages === 4 && prior.protectedIntact && !prior.error &&
    prior.compactionEvents?.length === 4 && prior.compactionEvents.every(event =>
      event.reason === 'threshold' && !event.error && !event.aborted) &&
    prior.fourthKind === (prior.arm === 'native' ? 'native' : 'handoff');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const rescored = { ...prior, priorPass:prior.pass, pass,
    scoringRevision:'verified-ranges-per-source-before-write-and-provider-stream-errors',
    scoreSha256:sha(scoreBytes), entriesSha256:sha(entriesBytes),
    providerErrors, procedure };
  await writeFile(output, JSON.stringify(rescored, null, 2));
  console.log(JSON.stringify({ directory:root, priorPass:prior.pass, pass,
    providerErrors, procedure }));
}
