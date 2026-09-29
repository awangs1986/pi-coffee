// Recalculate all runs under one scorer version from saved raw Pi traces.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scoreTrace } from './score-evaluation.mjs';
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Supply the paired evaluation artifact directory');
const scenarios = JSON.parse(await readFile(new URL('../test/fixtures/paired-evaluation.json', import.meta.url)));
for (const scenario of scenarios) for (const repetition of [1, 2])
  for (const arm of ['native', 'handoff']) {
    const directory = join(root, `${scenario.id}-${repetition}-${arm}`);
    const read = async file => JSON.parse(await readFile(join(directory, file)));
    try {
      const original = await read('score.json');
      const expected = { mode: scenario.newMode, limit: scenario.newLimit,
        rejected: scenario.rejected, revision: scenario.finalState.revision,
        verification: 'stale', error: scenario.finalState.error,
        identifier: scenario.identifier, retry_ms: scenario.retryMs,
        source_version: scenario.sourceVersion };
      const entries = (await read('entries.json')).entries;
      const result = scoreTrace({ entries, requests: await read('requests.json'),
        events: await read('events.json'), answer: original.answer, expected,
        boundary: 4, requiredSearch: scenario.identifier, arm,
        sessionId: 'same', actualSessionId: original.sessionStable ? 'same' : 'changed' });
      Object.assign(result, { scenario: scenario.id, repetition, model: original.model,
        thinking: original.thinking, error: original.error,
        protectedIntact: original.protectedIntact, wallMs: original.wallMs });
      result.pass = result.pass && !result.error && result.protectedIntact &&
        result.compactionEvents.length === 4 && result.compactionEvents.every(e =>
          e.reason === 'threshold' && !e.error && !e.aborted) &&
        (arm === 'native' ? result.fourthCompaction?.native : result.fourthCompaction?.handoff);
      await writeFile(join(directory, 'score-rescored.json'), JSON.stringify(result, null, 2));
      console.log(scenario.id, repetition, arm, result.firstFailureStage,
        result.fieldsCorrect, result.pass);
    } catch (error) { console.log(scenario.id, repetition, arm, 'missing', String(error)); }
  }
