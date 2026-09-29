// Reduce every predeclared paired run, including failures. Raw traces stay outside Git.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Supply the paired evaluation artifact directory');
const scenarios = ['correction-and-identifier', 'revision-and-quoted-suggestion'];
const runs = [];
for (const scenario of scenarios) for (const repetition of [1, 2])
  for (const arm of ['native', 'handoff']) {
    const directory = `${scenario}-${repetition}-${arm}`;
    try {
      let row;
      try { row = JSON.parse(await readFile(join(root, directory, 'score-rescored.json'))); }
      catch { row = JSON.parse(await readFile(join(root, directory, 'score.json'))); }
      let followup = null;
      try {
        followup = JSON.parse(await readFile(join(root, directory, 'followup-score.json')));
        const requestRows = JSON.parse(await readFile(join(root, directory, 'followup-requests.json')));
        followup.providerIncompleteResponses = requestRows.filter(r =>
          r.status === 200 && !r.finish).length;
      }
      catch { /* continuation phase may not have run yet */ }
      runs.push({ directory, ...row, followup });
    } catch (error) {
      runs.push({ directory, scenario, repetition, arm, pass: false,
        firstFailureStage: 'missing_result', error: String(error) });
    }
  }
const mean = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const aggregate = {};
for (const arm of ['native', 'handoff']) {
  const rows = runs.filter(r => r.arm === arm);
  aggregate[arm] = {
    runs: rows.length, passed: rows.filter(r => r.pass).length,
    meanFieldsCorrect: mean(rows.map(r => r.fieldsCorrect).filter(Number.isFinite)),
    meanFieldOmissions: mean(rows.map(r =>
      r.correct ? Object.keys(r.correct).filter(k => r.answer?.[k] === undefined).length : NaN)
      .filter(Number.isFinite)),
    requiredPostBoundarySearch: rows.filter(r => r.procedure?.searchAfter > 0).length,
    requiredSearchThenRead: rows.filter(r => r.procedure?.readAfterSearch).length,
    meanDuplicateToolCalls: mean(rows.map(r => r.duplicateCalls).filter(Number.isFinite)),
    meanWallMs: mean(rows.map(r => r.wallMs).filter(Number.isFinite)),
    meanReportedInputTokens: mean(rows.map(r => r.usage?.inputTokens).filter(Number.isFinite)),
    meanReportedOutputTokens: mean(rows.map(r => r.usage?.outputTokens).filter(Number.isFinite)),
    meanRequests: mean(rows.map(r => r.modelRequests).filter(Number.isFinite)),
    totalReportedTokens: rows.reduce((sum, r) => sum +
      (r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0), 0),
    followupRuns: rows.filter(r => r.followup).length,
    followupPassed: rows.filter(r => r.followup?.pass).length,
    followupProviderIncompleteResponses: rows.reduce((n, r) => n +
      (r.followup?.providerIncompleteResponses ?? 0), 0),
    followupMeanFieldsCorrect: mean(rows.map(r => r.followup?.fieldsCorrect)
      .filter(Number.isFinite)),
    followupMeanDuplicateToolCalls: mean(rows.map(r => r.followup?.followupDuplicateCalls)
      .filter(Number.isFinite)),
    followupMeanWallMs: mean(rows.map(r => r.followup?.followupWallMs)
      .filter(Number.isFinite)),
    followupTotalReportedTokens: rows.reduce((sum, r) => sum +
      (r.followup?.followupUsage?.inputTokens ?? 0) +
      (r.followup?.followupUsage?.outputTokens ?? 0), 0),
    actualBilledUsd: null,
    failureStages: Object.fromEntries([...new Set(rows.map(r => r.firstFailureStage))]
      .map(stage => [stage, rows.filter(r => r.firstFailureStage === stage).length])),
  };
}
const result = {
  design: '2 predeclared synthetic scenarios x 2 repetitions x 2 arms; paired by scenario/repetition',
  pricing: 'Actual provider charges unavailable; reported tokens are a cost proxy, not USD.',
  complete: runs.every(r => r.firstFailureStage !== 'missing_result'),
  followupComplete: runs.every(r => !!r.followup),
  aggregate,
  runs: runs.map(r => ({ directory: r.directory, pass: r.pass,
    firstFailureStage: r.firstFailureStage, fieldsCorrect: r.fieldsCorrect,
    fieldsTotal: r.fieldsTotal, correct: r.correct, stateChecks: r.stateChecks,
    procedure: r.procedure, duplicateCalls: r.duplicateCalls,
    wallMs: r.wallMs, usage: r.usage, modelRequests: r.modelRequests,
    error: r.error, followup: r.followup ? {
      pass: r.followup.pass, fieldsCorrect: r.followup.fieldsCorrect,
      correct: r.followup.correct, procedure: r.followup.procedure,
      duplicateCalls: r.followup.followupDuplicateCalls,
      followupWallMs: r.followup.followupWallMs,
      followupUsage: r.followup.followupUsage, error: r.followup.error,
      providerIncompleteResponses: r.followup.providerIncompleteResponses,
    } : null })),
};
await writeFile(join(root, 'aggregate.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ complete: result.complete, aggregate }, null, 2));
