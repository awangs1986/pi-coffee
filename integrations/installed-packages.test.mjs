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

for (const piVersion of ['0.99.1', '1.0.0']) test(`release artifacts install together on Pi ${piVersion} outside the monorepo`, {timeout:240000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-monorepo-consumer-'));
 try {
  execFileSync(process.execPath,['scripts/pack-plugins.mjs',join(root,'artifacts')],{stdio:'pipe'});
  const release=JSON.parse(await readFile(join(root,'artifacts/releases.json'),'utf8'));
  assert.equal(release.plugins.length,3);
  for(const item of release.plugins){assert.equal(item.integrity,'sha512-'+createHash('sha512').update(await readFile(join(root,'artifacts',item.file))).digest('base64'));}
  await writeFile(join(root,'package.json'),JSON.stringify({name:'synthetic-plugin-consumer',private:true,type:'module'}));
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',`@earendil-works/pi-coding-agent@${piVersion}`,'typebox@1.3.34','pi-web-access@0.35.0','pi-subagents@https://codeload.github.com/nicobailon/pi-subagents/tar.gz/10694a673cb077b4d3ec6a6cfe68acb6c28b83a5',...release.plugins.map(p=>join(root,'artifacts',p.file))],{cwd:root,stdio:'pipe'});
  await mkdir(join(root,'work'));await mkdir(join(root,'agent'));
  await writeFile(join(root,'probe.mjs'), `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {RpcClient,SessionManager} from '@earendil-works/pi-coding-agent';
import {HANDOFF_REQUEST} from 'context-handoff/protocol';
import {currentHarnessMode} from 'pi-coffee-harness';
assert.equal(typeof HANDOFF_REQUEST,'string');assert.equal(typeof currentHarnessMode,'function');
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),names=${JSON.stringify(release.plugins.map(p=>({name:p.name,version:p.version})))};
const extensions=names.flatMap(p=>{const manifest=require(p.name+'/package.json');assert.equal(manifest.version,p.version);return manifest.pi.extensions.map(e=>join(dirname(require.resolve(p.name+'/package.json')),e));});
const cli=join(process.cwd(),'node_modules/.bin/pi');
for(const p of names)execFileSync(process.execPath,[cli,'install',dirname(require.resolve(p.name+'/package.json'))],{env:{...process.env,PI_CODING_AGENT_DIR:join(process.cwd(),'agent'),PI_OFFLINE:'1'},stdio:'pipe'});
const seeded=SessionManager.create(join(process.cwd(),'work'),join(process.cwd(),'sessions'));
seeded.appendMessage({role:'user',content:'synthetic branch recovery fixture',timestamp:1});
seeded.appendMessage({role:'assistant',content:[{type:'text',text:'fixture'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:1});
seeded.appendCustomEntry('pi-handoff-work',{id:'lsp:interrupted-query',tool:'lsp',status:'running'});
const branchPoint=seeded.appendMessage({role:'user',content:'branch before query settlement',timestamp:2});
seeded.appendCustomEntry('pi-handoff-work',{id:'lsp:interrupted-query',tool:'lsp',status:'settled'});
seeded.branch(branchPoint);
seeded.appendCustomEntry('fixture-branch',{});
const observer=join(process.cwd(),'observer.mjs');
writeFileSync(observer, "import {writeFileSync} from 'node:fs';export default pi=>pi.registerCommand('fixture-branch',{handler:(_,ctx)=>{writeFileSync("+JSON.stringify(join(process.cwd(),'branch.json'))+",JSON.stringify(ctx.sessionManager.getBranch()));}});");
const c=new RpcClient({cliPath:join(process.cwd(),'node_modules/.bin/pi'),cwd:join(process.cwd(),'work'),env:{PI_CODING_AGENT_DIR:join(process.cwd(),'agent'),PI_OFFLINE:'1'},args:['--offline','-e',observer,'--session',seeded.getSessionFile(),'--session-dir',join(process.cwd(),'sessions')]});
const events=[];c.onEvent(e=>events.push(e));
try {await c.start();await c.getState();await c.prompt("/fixture-branch");const restored=JSON.parse(readFileSync(join(process.cwd(),'branch.json'),'utf8'));assert.equal(restored.filter(e=>e.type==='custom' && e.customType==='pi-handoff-work' && e.data.id==='lsp:interrupted-query').at(-1)?.data.status,'settled','LSP reconciles a branch with completed/interrupted read-only work');const commands=await c.getCommands();for(const name of ['harness','lsp','handoff'])assert.equal(commands.filter(c=>c.name===name).length,1);
for(const command of ['harness','lsp','handoff'])await c.prompt('/'+command+' version');
await c.getState();for(const p of names)assert.ok(events.some(e=>e.type==='extension_ui_request' && String(e.message).includes(p.version)),p.name+' version not reported');
assert.ok(!events.some(e=>e.type==='extension_error'));console.log('THREE_PLUGIN_INSTALL_AND_VERSION_OK');
}finally{await c.stop();}
`);
  const output=execFileSync(process.execPath,['probe.mjs'],{cwd:root,encoding:'utf8',timeout:45000});
  assert.match(output,/THREE_PLUGIN_INSTALL_AND_VERSION_OK/);
  await writeFile(join(root,'native-tools.mjs'),await readFile(new URL('./fixtures/native-tools.mjs',import.meta.url),'utf8'));
  const tools=execFileSync(process.execPath,['native-tools.mjs'],{cwd:root,encoding:'utf8',timeout:120000});
  assert.match(tools,/NATIVE_UPSTREAM_ACTIVATION_OK/);
 }finally{await rm(root,{recursive:true,force:true});}
});
