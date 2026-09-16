// Line diff (LCS) for rendering edit/write tool calls the way Codex shows a
// change: removed lines, added lines, a little context, gaps collapsed.

export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');
  if (a.length === 1 && a[0] === '') a.length = 0;
  if (b.length === 1 && b[0] === '') b.length = 0;
  const n = a.length, m = b.length;
  // Guard: very large inputs fall back to a whole-block replacement.
  if (n * m > 4_000_000) {
    return [...a.map((line) => ({ type: 'del', line })), ...b.map((line) => ({ type: 'add', line }))];
  }
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'ctx', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', line: a[i] }); i++; }
    else { ops.push({ type: 'add', line: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++] });
  while (j < m) ops.push({ type: 'add', line: b[j++] });
  return ops;
}

/** Keep `context` unchanged lines around each change; collapse the rest into gap markers. */
export function collapseContext(ops, context = 3) {
  const keep = new Array(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type === 'ctx') continue;
    for (let d = -context; d <= context; d++) if (ops[k + d]) keep[k + d] = true;
  }
  const out = [];
  let gap = 0;
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      if (gap > 0) { out.push({ type: 'gap', count: gap }); gap = 0; }
      out.push(ops[k]);
    } else gap++;
  }
  if (gap > 0) out.push({ type: 'gap', count: gap });
  return out;
}

export function diffStats(ops) {
  let add = 0, del = 0;
  for (const op of ops) { if (op.type === 'add') add++; else if (op.type === 'del') del++; }
  return { add, del };
}
