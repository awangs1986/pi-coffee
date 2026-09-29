import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('packing rejects a missing public protocol even when the Pi source entry exists', async () => {
 const protocol=resolve('packages/context-handoff/dist/src/plugin/protocol.js');
 const backup=protocol+'.pack-test-backup';
 const output=await mkdtemp(join(tmpdir(),'coffee-incomplete-artifact-'));
 await rename(protocol,backup);
 try {
  assert.throws(()=>execFileSync(process.execPath,['scripts/pack-plugins.mjs',output],{stdio:'pipe'}), /missing .*protocol\.js/);
 } finally {
  await rename(backup,protocol);
  await rm(output,{recursive:true,force:true});
 }
});

test('release artifacts install together outside the monorepo and report independent versions', {timeout:180000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-monorepo-consumer-'));
 try {
  execFileSync(process.execPath,['scripts/pack-plugins.mjs',join(root,'artifacts')],{stdio:'pipe'});
  const release=JSON.parse(await readFile(join(root,'artifacts/releases.json'),'utf8'));
  assert.equal(release.plugins.length,3);
  for(const item of release.plugins){assert.equal(item.integrity,'sha512-'+createHash('sha512').update(await readFile(join(root,'artifacts',item.file))).digest('base64'));}
  await writeFile(join(root,'package.json'),JSON.stringify({name:'synthetic-plugin-consumer',private:true,type:'module'}));
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','@earendil-works/pi-coding-agent@0.87.1','typebox@1.3.7',...release.plugins.map(p=>join(root,'artifacts',p.file))],{cwd:root,stdio:'pipe'});
  await mkdir(join(root,'work'));await mkdir(join(root,'agent'));
  await writeFile(join(root,'probe.mjs'), `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {HANDOFF_REQUEST} from 'context-handoff/protocol';
import {currentHarnessMode} from 'pi-coffee-harness';
assert.equal(typeof HANDOFF_REQUEST,'string');assert.equal(typeof currentHarnessMode,'function');
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),names=${JSON.stringify(release.plugins.map(p=>({name:p.name,version:p.version})))};
const extensions=names.flatMap(p=>{const manifest=require(p.name+'/package.json');assert.equal(manifest.version,p.version);return manifest.pi.extensions.map(e=>join(dirname(require.resolve(p.name+'/package.json')),e));});
const cli=join(process.cwd(),'node_modules/.bin/pi');
for(const p of names)execFileSync(process.execPath,[cli,'install',dirname(require.resolve(p.name+'/package.json'))],{env:{...process.env,PI_CODING_AGENT_DIR:join(process.cwd(),'agent'),PI_OFFLINE:'1'},stdio:'pipe'});
const c=new RpcClient({cliPath:join(process.cwd(),'node_modules/.bin/pi'),cwd:join(process.cwd(),'work'),env:{PI_CODING_AGENT_DIR:join(process.cwd(),'agent'),PI_OFFLINE:'1'},args:['--offline','--session-dir',join(process.cwd(),'sessions')]});
const events=[];c.onEvent(e=>events.push(e));
try {await c.start();const commands=await c.getCommands();for(const name of ['harness','lsp','handoff'])assert.equal(commands.filter(c=>c.name===name).length,1);
for(const command of ['harness','lsp','handoff'])await c.prompt('/'+command+' version');
await c.getState();for(const p of names)assert.ok(events.some(e=>e.type==='extension_ui_request' && String(e.message).includes(p.version)),p.name+' version not reported');
assert.ok(!events.some(e=>e.type==='extension_error'));console.log('THREE_PLUGIN_INSTALL_AND_VERSION_OK');
}finally{await c.stop();}
`);
  const output=execFileSync(process.execPath,['probe.mjs'],{cwd:root,encoding:'utf8',timeout:45000});
  assert.match(output,/THREE_PLUGIN_INSTALL_AND_VERSION_OK/);
 }finally{await rm(root,{recursive:true,force:true});}
});
