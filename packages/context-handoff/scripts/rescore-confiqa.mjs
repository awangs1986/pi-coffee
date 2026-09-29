// Re-score saved ConFiQA-derived Pi runs without overwriting their first score.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scoreConfiqaProcedure } from './score-confiqa-procedure.mjs';
import { inspectProviderSse } from './inspect-provider-sse.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directories = process.argv.slice(2);
if (!directories.length) throw Error('Usage: node scripts/rescore-confiqa.mjs OUTSIDE_REPO_RUN_DIR...');
for (const argument of directories) {
  const root = resolve(argument);
  if (!relative(repo, root).startsWith('..')) throw Error('Run artifacts must remain outside Git');
  const output = join(root, 'score-rescored-v3.json');
  try { await stat(output); throw Error(`Existing rescore would be overwritten: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scoreBytes = await readFile(join(root, 'score.json'));
  const entriesBytes = await readFile(join(root, 'entries.json'));
  const prior = JSON.parse(scoreBytes);
  const entries = JSON.parse(entriesBytes).entries;
  if (!prior.marker || !prior.expected || !Array.isArray(entries))
    throw Error(`Not a ConFiQA run: ${root}`);
  const procedure = scoreConfiqaProcedure(entries, prior.marker, prior.expected);
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
  const pass = providerErrors.length === 0 && prior.answerCorrect &&
    prior.exactKeys && procedure.valid && prior.boundaryCount === 4 &&
    prior.sessionStable && prior.userMessages === 4 && prior.protectedIntact &&
    !prior.error && prior.compactionEvents?.length === 4 &&
    prior.compactionEvents.every(event =>
      event.reason === 'threshold' && !event.error && !event.aborted) &&
    prior.fourthKind === (prior.arm === 'native' ? 'native' : 'handoff');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const rescored = { ...prior, priorPass: prior.pass, pass,
    scoringRevision: 'ordered-verified-originals-before-write-and-provider-stream-errors',
    scoreSha256: sha(scoreBytes), entriesSha256: sha(entriesBytes),
    providerErrors, procedure,
    searchAfter: procedure.searchCalls,
    readAfterSearch: procedure.verifiedReadAfterSearch };
  await writeFile(output, JSON.stringify(rescored, null, 2));
  console.log(JSON.stringify({ directory: root, priorPass: prior.pass,
    pass, procedure }));
}
