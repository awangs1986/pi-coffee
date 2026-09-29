// Explicit opt-in driver for the predeclared 2 x 2 x 2 paid comparison.
import { spawn } from 'node:child_process';
import { mkdir, open, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argument = process.argv[2];
if (!argument || !process.env.PI_HANDOFF_EVAL_API_KEY)
  throw Error('Usage: PI_HANDOFF_EVAL_API_KEY=... node scripts/run-paired.mjs OUTSIDE_REPO');
const root = resolve(argument);
if (!relative(repo, root).startsWith('..')) throw Error('Artifacts must be outside Git');
try { await stat(root); throw Error('Choose a new artifact directory to avoid overwriting prior runs'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(root, { recursive: true });
const scenarios = ['correction-and-identifier', 'revision-and-quoted-suggestion'];
const targets = [];
for (const scenario of scenarios) for (const repetition of [1, 2])
  for (const arm of ['native', 'handoff'])
    targets.push({ scenario, repetition, arm,
      directory: join(root, `${scenario}-${repetition}-${arm}`) });
function run(script, args, log) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(repo, 'scripts', script), ...args],
      { cwd: repo, env: process.env, stdio: ['ignore', log, log] });
    child.on('error', reject);
    child.on('close', code => resolveRun(code));
  });
}
for (const target of targets) {
  await mkdir(target.directory);
  const handle = await open(join(target.directory, 'progress.log'), 'w');
  const code = await run('evaluate-paired.mjs',
    [target.directory, target.scenario, target.arm, String(target.repetition)], handle.fd);
  await handle.close();
  console.log('automatic', target.scenario, target.repetition, target.arm, code);
}
for (const target of targets) {
  const handle = await open(join(target.directory, 'followup-progress.log'), 'w');
  const code = await run('evaluate-followup.mjs', [target.directory], handle.fd);
  await handle.close();
  console.log('common prompt', target.scenario, target.repetition, target.arm, code);
}
await run('rescore-paired.mjs', [root], 'inherit');
await run('aggregate-paired.mjs', [root], 'inherit');
console.log('Complete. Every predefined run, including failures, remains in', root);
