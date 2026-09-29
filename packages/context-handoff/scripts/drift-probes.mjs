// Pure helpers for the drift-probe question bank (test/fixtures/drift-probes.json).
// Expected outcomes come only from the fixture, never from model output or the
// generated Task State. No network, credentials or Pi process are used here.
import vm from 'node:vm';

const canonical = value => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

/** Fixture lint: wording and structure rules that keep probes benchmark-neutral. */
export function lintFixture(fixture) {
  const problems = [];
  const vocabulary = fixture.protocol.forbiddenTurnVocabulary.map(w => w.toLowerCase());
  const ids = new Set();
  const texts = [...fixture.protocol.noisePool];
  for (const item of fixture.items) {
    if (ids.has(item.id)) problems.push(`${item.id}: duplicate id`);
    ids.add(item.id);
    if (item.turns.length !== fixture.protocol.intermediateTurns)
      problems.push(`${item.id}: expected ${fixture.protocol.intermediateTurns} intermediate turns`);
    for (const turn of item.turns)
      for (const [, name] of turn.matchAll(/\{(\w+)\}/g))
        if (name !== 'noise' && !item.generate?.[name])
          problems.push(`${item.id}: unknown placeholder {${name}}`);
    texts.push(...item.turns, item.final);
    for (const [file, forbidden] of Object.entries(item.forbidden ?? {}))
      for (const word of forbidden)
        if (JSON.stringify(item.expected?.[file] ?? '').includes(word))
          problems.push(`${item.id}: forbidden "${word}" occurs in the expected ${file}`);
    const deliverables = Object.keys(item.expected ?? {}).length + (item.invariants ?? []).length;
    if (!deliverables) problems.push(`${item.id}: no oracle`);
  }
  for (const text of texts)
    for (const word of vocabulary)
      if (text.toLowerCase().includes(word))
        problems.push(`turn wording mentions "${word}": ${text.slice(0, 80)}`);
  return problems;
}

function generatedLog(spec) {
  const line = n => spec.line
    .replace('{mm}', String(Math.floor(n / 60) % 60).padStart(2, '0'))
    .replace('{ss}', String(n % 60).padStart(2, '0'))
    .replace('{n}', String(n % 17));
  const before = Array.from({ length: spec.linesBefore }, (_, i) => line(i));
  const after = Array.from({ length: spec.linesAfter }, (_, i) => line(spec.linesBefore + i));
  return [...before, spec.note, ...after].join('\n');
}

/**
 * Build the workspace files, ordered turns and workspace changes for one item.
 * `extraNoise` appends further noise turns after the last core turn.
 */
export function materialize(fixture, item, { extraNoise = 0 } = {}) {
  const files = { ...fixture.baseWorkspace, ...(item.workspace ?? {}) };
  const bulk = item.generate?.bulk;
  if (bulk)
    for (let i = 0; i < bulk.files; i++)
      files[`${bulk.directory}/pkg${String(i % 50).padStart(2, '0')}/file${String(i).padStart(4, '0')}.txt`] =
        `vendored fixture ${i}\n`;
  const pool = fixture.protocol.noisePool;
  let noise = 0;
  const nextNoise = () => pool[noise++ % pool.length];
  const turns = [...item.turns, ...Array(extraNoise).fill('{noise}')].map(turn =>
    turn === '{noise}' ? nextNoise() : turn.replace(/\{(\w+)\}/g, (_m, name) => {
      const spec = item.generate?.[name];
      if (!spec) throw Error(`Unknown placeholder {${name}} in ${item.id}`);
      return generatedLog(spec);
    }));
  return { files, turns, final: item.final, changes: item.changes ?? [] };
}

/** Evaluate a checkpoint precondition. Failed checkpoints invalidate the run setup. */
export function checkCheckpoint(checkpoint, read) {
  const text = read(checkpoint.path);
  if (checkpoint.exists !== undefined) return (text !== undefined) === checkpoint.exists;
  if (checkpoint.lines) return text !== undefined &&
    canonical(text.split('\n').map(l => l.trim()).filter(Boolean)) === canonical(checkpoint.lines);
  return false;
}

const REGEX_USE = /new\s+RegExp|\.match(All)?\s*\(|\.test\s*\(|\.search\s*\(|\.(replace|replaceAll|split)\s*\(\s*\//;

function invariant(rule, read, baseline) {
  const text = read(rule.path);
  switch (rule.type) {
    case 'unchanged': return text === baseline[rule.path];
    case 'absent': return text === undefined;
    case 'text': return text !== undefined && text.trim() === rule.equals;
    case 'lines': return text !== undefined &&
      canonical(text.split('\n').map(l => l.trim()).filter(Boolean)) === canonical(rule.equals);
    case 'noRegex': return text !== undefined && !REGEX_USE.test(text);
    case 'jsFunction': {
      if (text === undefined) return false;
      try {
        const module = { exports: {} };
        vm.runInNewContext(text, { module, exports: module.exports,
          require: () => { throw Error('require is disabled in probe scoring'); } }, { timeout: 1000 });
        const fn = module.exports?.[rule.export] ?? (rule.export === 'default' ? module.exports : undefined);
        return typeof fn === 'function' && canonical(fn(...rule.args)) === canonical(rule.equals);
      } catch { return false; }
    }
    default: throw Error(`Unknown invariant type ${rule.type}`);
  }
}

function compareValue(expected, actual, mode) {
  if (mode === 'set' && Array.isArray(expected) && Array.isArray(actual))
    return { correct: canonical([...expected].sort()) === canonical([...actual].sort()) };
  if (canonical(expected) === canonical(actual)) return { correct: true };
  // Value fidelity is scored separately from JSON type formatting.
  if ((typeof expected === 'number' || typeof expected === 'string') &&
      (typeof actual === 'number' || typeof actual === 'string') &&
      typeof expected !== typeof actual && String(expected) === String(actual))
    return { correct: true, typeMismatch: true };
  return { correct: false };
}

/**
 * Score one run from the final workspace. `read(path)` returns file text or
 * undefined; `entries` is the Pi session branch (for engineering checks).
 */
export function scoreDriftProbe({ item, read, baseline, entries = [], arm, checkpointResults = [] }) {
  const fields = [];
  const leaks = [];
  for (const [file, expected] of Object.entries(item.expected ?? {})) {
    const text = read(file);
    let parsed;
    try { parsed = text === undefined ? undefined : JSON.parse(text); } catch { parsed = undefined; }
    const modes = item.compare?.[file] ?? {};
    if (Array.isArray(expected) || typeof expected !== 'object') {
      fields.push({ file, key: null, expected, actual: parsed, ...compareValue(expected, parsed, modes.value) });
    } else {
      for (const [key, value] of Object.entries(expected))
        fields.push({ file, key, expected: value, actual: parsed?.[key],
          ...compareValue(value, parsed?.[key], modes[key]) });
      if (parsed && typeof parsed === 'object')
        for (const key of Object.keys(parsed))
          if (!(key in expected)) fields.push({ file, key, extra: true, actual: parsed[key] });
    }
    for (const word of item.forbidden?.[file] ?? [])
      if (text?.includes(word)) leaks.push({ file, value: word });
  }
  const invariantFailures = (item.invariants ?? [])
    .filter(rule => !invariant(rule, read, baseline))
    .map(rule => ({ type: rule.type, path: rule.path }));
  const scored = fields.filter(f => !f.extra);
  const handoffs = entries.filter(e => e.type === 'compaction' && e.details?.plugin === 'pi-handoff').length;
  const native = entries.filter(e => e.type === 'compaction' && e.details?.plugin !== 'pi-handoff').length;
  const fallbackNotices = entries.filter(e => e.customType === 'pi-handoff-error' &&
    String(e.content).includes('Used one native compaction')).length;
  const engineeringFailures = [];
  if (item.engineering?.handoffArmRequiresInstalledHandoff && arm === 'handoff' && !handoffs)
    engineeringFailures.push('handoff_not_installed');
  if (item.engineering?.noFallbackNotice && fallbackNotices)
    engineeringFailures.push('fallback_notice');
  const validSetup = checkpointResults.every(Boolean);
  const pass = validSetup && scored.every(f => f.correct) && !leaks.length &&
    !invariantFailures.length && !engineeringFailures.length;
  return {
    id: item.id, category: item.category, arm, validSetup,
    fields, fieldsCorrect: scored.filter(f => f.correct).length, fieldsTotal: scored.length,
    typeMismatches: scored.filter(f => f.typeMismatch).length,
    extraKeys: fields.filter(f => f.extra).map(f => `${f.file}:${f.key}`),
    leaks, invariantFailures, engineeringFailures,
    compactions: { handoffs, native, fallbackNotices },
    pass,
  };
}
