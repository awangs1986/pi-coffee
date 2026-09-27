import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { stopLspDaemon } from '../dist/src/runtime.js';
import { createLanguageFixture } from './harness-language-fixtures.mjs';

const exec = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), 'coffee-real-lifecycle-'));
const fixture = createLanguageFixture('typescript', root);
const cli = resolve(import.meta.dirname, '../dist/src/lsp/bin.js');
const server = createRequire(import.meta.url).resolve('typescript-language-server/lib/cli.mjs');
const pidFile = join(root, 'server-pid');
const wrapper = join(root, 'server-launch.mjs');
// This wrapper records the real language server PID; it does not replace its protocol.
writeFileSync(wrapper, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
process.argv=[process.execPath,${JSON.stringify(server)},'--stdio'];
await import(${JSON.stringify(pathToFileURL(server).href)});
`);
const env = {...process.env, PI_COFFEE_ROOT_SESSION:root, PI_COFFEE_TS_LSP_COMMAND:JSON.stringify([process.execPath,wrapper])};
const report = [];
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function query(operation, extra=[]) {
  const args=[cli,operation,'--file',fixture.file,'--timeout-ms','15000',...extra];
  const {stdout} = await exec(process.execPath,args,{cwd:root,env,timeout:20000});
  const result=JSON.parse(stdout);report.push({operation,...result});return result;
}
let cancelled;
try {
  assert.ok((await query('symbols')).items.length);
  const firstPid=Number(readFileSync(pidFile,'utf8'));
  process.kill(firstPid,'SIGKILL');
  await pause(100);
  assert.ok((await query('hover',['--line','2','--column','31'])).items[0].text.includes('answer'));
  const recoveredPid=Number(readFileSync(pidFile,'utf8'));
  assert.notEqual(firstPid,recoveredPid);
  writeFileSync(fixture.file,fixture.good);
  cancelled=spawn(process.execPath,[cli,'diagnostics','--file',fixture.file,'--timeout-ms','15000'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let stdout='';cancelled.stdout.on('data',chunk=>stdout+=chunk);
  const exit=new Promise(resolve=>cancelled.once('exit',resolve));
  await pause(250);cancelled.kill('SIGINT');
  assert.equal(await exit,4);
  const result=JSON.parse(stdout);
  assert.equal(result.issues[0].code,'request_cancelled');
  report.push({operation:'SIGINT',...result});
  assert.ok((await query('symbols')).items.length);
  assert.equal(Number(readFileSync(pidFile,'utf8')),recoveredPid);
  await stopLspDaemon(root,env);
  assert.throws(()=>process.kill(recoveredPid,0));
  report.push({operation:'lifecycle',crashRecovery:true,cancellation:true,reusedAfterCancel:true,processExit:true});
} finally {
  if(cancelled?.exitCode === null)cancelled.kill('SIGKILL');
  await stopLspDaemon(root,env);
  writeFileSync(process.env.COFFEE_PROBE_REPORT || '/tmp/coffee-lifecycle-probe.json',JSON.stringify(report,null,2));
  rmSync(root,{recursive:true,force:true});
}
