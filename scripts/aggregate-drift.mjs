// Summarize the complete first-attempt cohort, including failed and missing runs.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Usage: node scripts/aggregate-drift.mjs COHORT_DIR');
const cohort = JSON.parse(await readFile(join(root, 'cohort-manifest.json')));
const records = [];
for (const target of cohort.targets) {
  let score = null, requests = [];
  try { score = JSON.parse(await readFile(join(target.directory, 'score.json'))); } catch { /* missing first attempt */ }
  try { requests = JSON.parse(await readFile(join(target.directory, 'requests.json'))); } catch { /* no request evidence */ }
  records.push({ target, score, requests });
}
const count = (rows, fn) => rows.filter(fn).length;
const totals = {};
for (const arm of ['native', 'handoff']) {
  const rows = records.filter(r => r.target.arm === arm);
  totals[arm] = {
    planned: rows.length, scored: count(rows, r => !!r.score),
    acceptancePass: count(rows, r => r.score?.acceptanceVerdict === 'PASS'),
    taskSuccess: count(rows, r => r.score?.taskSuccess),
    contentCorrect: count(rows, r => r.score?.contentCorrect),
    setupValid: count(rows, r => r.score?.setupValid),
    scheduleValid: count(rows, r => r.score?.scheduleValid),
    errors: count(rows, r => !!r.score?.error),
    providerErrors: rows.flatMap(r => r.score?.providerErrors ?? []).length,
    modelErrors: rows.flatMap(r => r.score?.modelErrors ?? []).length,
    inputTokens: rows.reduce((n, r) => n + (r.score?.usage?.promptTokens ?? 0), 0),
    outputTokens: rows.reduce((n, r) => n + (r.score?.usage?.completionTokens ?? 0), 0),
    providerRequests: rows.reduce((n, r) => n + (r.score?.requests ?? 0), 0),
    wallMs: rows.reduce((n, r) => n + (r.score?.wallMs ?? 0), 0),
    requestsWithoutUsage: rows.reduce((n, r) => n + count(r.requests, q => !q.usage), 0),
    nonSelectedThinkingRequests: rows.reduce((n, r) => n +
      count(r.requests, q => q.reasoning !== cohort.thinking), 0),
    nonSelectedModelRequests: rows.reduce((n, r) => n + count(r.requests,
      q => q.model !== cohort.model), 0),
  };
}
const pairRows = cohort.pairs.map(pair => {
  const rows = records.filter(r => r.target.item === pair.item && r.target.repetition === pair.repetition);
  const native = rows.find(r => r.target.arm === 'native')?.score;
  const handoff = rows.find(r => r.target.arm === 'handoff')?.score;
  const comparable = !!native && !!handoff && native.setupValid && handoff.setupValid &&
    native.scheduleValid && handoff.scheduleValid && !native.error && !handoff.error &&
    !(native.providerErrors?.length) && !(handoff.providerErrors?.length) &&
    !(native.modelErrors?.length) && !(handoff.modelErrors?.length);
  return { item: pair.item, repetition: pair.repetition, comparable,
    nativeTaskSuccess: native?.taskSuccess ?? false, handoffTaskSuccess: handoff?.taskSuccess ?? false,
    nativeAcceptance: native?.acceptanceVerdict ?? 'MISSING',
    handoffAcceptance: handoff?.acceptanceVerdict ?? 'MISSING',
    nativeSchedule: native?.actualSchedule ?? '', handoffSchedule: handoff?.actualSchedule ?? '',
    nativeError: native?.error ?? null, handoffError: handoff?.error ?? null };
});
function matrix(rows) {
  return {
    bothSuccess: count(rows, r => r.nativeTaskSuccess && r.handoffTaskSuccess),
    handoffOnly: count(rows, r => !r.nativeTaskSuccess && r.handoffTaskSuccess),
    nativeOnly: count(rows, r => r.nativeTaskSuccess && !r.handoffTaskSuccess),
    bothFail: count(rows, r => !r.nativeTaskSuccess && !r.handoffTaskSuccess),
  };
}
const items = cohort.pairs.filter(p => p.repetition === 1).map(p => p.item).map(item => {
  const rows = records.filter(r => r.target.item === item);
  const n = rows.filter(r => r.target.arm === 'native');
  const h = rows.filter(r => r.target.arm === 'handoff');
  return { item,
    nativeTaskSuccess: count(n, r => r.score?.taskSuccess),
    handoffTaskSuccess: count(h, r => r.score?.taskSuccess),
    nativeAcceptance: count(n, r => r.score?.acceptanceVerdict === 'PASS'),
    handoffAcceptance: count(h, r => r.score?.acceptanceVerdict === 'PASS'),
    nativeSchedules: n.map(r => r.score?.actualSchedule ?? 'MISSING'),
    handoffSchedules: h.map(r => r.score?.actualSchedule ?? 'MISSING'),
    failures: rows.filter(r => r.score?.acceptanceVerdict !== 'PASS').map(r => ({
      arm: r.target.arm, repetition: r.target.repetition,
      error: r.score?.error ?? 'missing_score',
      modelErrors: r.score?.modelErrors ?? [],
      contentCorrect: r.score?.contentCorrect ?? false,
      deliverableValid: r.score?.deliverableValid ?? false,
      processValid: r.score?.processValid ?? false,
      setupValid: r.score?.setupValid ?? false,
      scheduleValid: r.score?.scheduleValid ?? false,
      violations: r.score?.violations ?? [],
    })),
  };
});
const summary = {
  cohort: cohort.cohort, model: cohort.model, provider: cohort.provider,
  started: cohort.started, completed: cohort.completed ?? null,
  totals, allPairs: matrix(pairRows), comparablePairs: matrix(pairRows.filter(p => p.comparable)),
  comparableCount: count(pairRows, p => p.comparable), pairCount: pairRows.length,
  items, pairs: pairRows,
};
await writeFile(join(root, 'aggregate.json'), JSON.stringify(summary, null, 2));
const lines = [
  `# D01-D13 live cohort (${cohort.cohort})`, '',
  `Provider: ${cohort.provider}; model: ${cohort.model}; thinking: ${cohort.thinking}.`,
  `Started: ${cohort.started}; completed: ${cohort.completed ?? 'incomplete'}.`, '',
  '| Arm | Scored / planned | Task success | Strict acceptance | Content correct | Schedule valid | Provider calls | Input / output tokens |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...['native', 'handoff'].map(arm => {
    const x = totals[arm];
    return `| ${arm} | ${x.scored}/${x.planned} | ${x.taskSuccess} | ${x.acceptancePass} | ${x.contentCorrect} | ${x.scheduleValid} | ${x.providerRequests} | ${x.inputTokens}/${x.outputTokens} |`;
  }), '',
  `Paired task outcomes, all ${pairRows.length}: ${JSON.stringify(summary.allPairs)}.`,
  `Comparable pairs ${summary.comparableCount}: ${JSON.stringify(summary.comparablePairs)}.`, '',
  '| Item | Native task / 3 | Handoff task / 3 | Native strict / 3 | Handoff strict / 3 |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...items.map(x => `| ${x.item} | ${x.nativeTaskSuccess} | ${x.handoffTaskSuccess} | ${x.nativeAcceptance} | ${x.handoffAcceptance} |`), '',
  `Requests missing usage: native ${totals.native.requestsWithoutUsage}, handoff ${totals.handoff.requestsWithoutUsage}.`,
  `Requests not marked ${cohort.thinking}: native ${totals.native.nonSelectedThinkingRequests}, handoff ${totals.handoff.nonSelectedThinkingRequests}.`,
  `Requests with a different model ID: native ${totals.native.nonSelectedModelRequests}, handoff ${totals.handoff.nonSelectedModelRequests}.`,
  '', 'Raw scores, requests, Pi entries, events, file histories and saved workspaces are in each run directory.',
];
await writeFile(join(root, 'report.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ totals, allPairs: summary.allPairs,
  comparableCount: summary.comparableCount, comparablePairs: summary.comparablePairs }, null, 2));
