import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import { RpcPiSessionFactory } from '../src/host/pi-adapter.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'coffee-p7-'));
  const cwd = join(root, 'checkout'), agentDir = join(root, 'agent'), data = join(root, 'data');
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(data)]);
  await writeFile(join(cwd, 'app.txt'), 'unchanged');
  for (const args of [['init', '-q'], ['add', '.'], ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']]) execFileSync('git', args, {cwd});
  const requests: any[] = [];
  const control = { pressure: false, fail: false, synthesis: undefined as undefined | (()=>Promise<void>), child:undefined as undefined | (()=>Promise<void>), tools:[] as Array<{name:string;args:unknown}> };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests.push(request);
    if(request.model==='child')await control.child?.();
    if (control.fail) { res.writeHead(400); res.end('fixture failure'); return; }
    const synthesis = request.messages.some((m:any) => String(m.content).startsWith('Create the requested attributed task brief'));
    if (synthesis) await control.synthesis?.();
    const source = synthesis ? JSON.parse(request.messages.find((m:any)=>m.role==='user').content) : undefined;
    const tool=!synthesis && request.model!=='child' ? control.tools.shift() : undefined;
    const content = synthesis ? JSON.stringify({objective:'Preserve app.txt',constraints:['Do not commit'],corrections:[],completed:[],remaining:['Inspect app.txt'],nextAction:'Inspect app.txt',uncertainties:[],sources:[source.sources[0].entryId]}) : 'Observed fixture conclusion. ' + 'Preserve the current task. '.repeat(500);
    res.writeHead(200, {'content-type':'text/event-stream'});
    for (const chunk of [{choices:[{index:0,delta:tool ? {role:'assistant',tool_calls:[{index:0,id:randomUUID(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]} : {role:'assistant',content},finish_reason:null}]}, {choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]}, {choices:[],usage:{prompt_tokens:control.pressure && !synthesis ? 120000 : 100, completion_tokens:30,total_tokens:control.pressure ? 120030:130}}]) res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',...chunk})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port = (server.address() as any).port;
  await writeFile(join(agentDir,'models.json'), JSON.stringify({providers:{localtest:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture',models:['fixture','child'].map(id=>({id,name:id,reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096}))}}}));
  await writeFile(join(agentDir,'settings.json'), JSON.stringify({compaction:{enabled:true,keepRecentTokens:1024,reserveTokens:16000},retry:{enabled:false}}));
  const id = randomUUID();
  const extensions = ['extensions/web-access/extension','context/handoff-extension','harness/extension','context/guard-extension'].map(p=>resolve(`dist/src/${p}.js`));
  const options = {cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd,agentDir,sessionDir:join(root,'sessions'),provider:'localtest',model:'fixture',extensions,
    args:['--offline','--no-extensions'],env:{PI_CODING_AGENT_DIR:agentDir,PI_OFFLINE:'1',PI_COFFEE_HANDOFF_CANDIDATE:'on',PI_COFFEE_DATA_ROOT:data,PI_COFFEE_ROOT_SESSION:id}};
  return {root,cwd,agentDir,id,requests,control,options,client:()=>new RpcClient({...options,args:[...options.args,'--session-dir',options.sessionDir,'--session-id',id,...extensions.flatMap(p=>['--extension',p])]}),cleanup:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}};
}
async function status(client:RpcClient) {
  const nonce = randomUUID(); await client.prompt(`/coffee-handoff-state ${nonce}`);
  const entries = await client.getEntries();
  return (entries.entries.filter((e:any)=>e.customType==='coffee-handoff-state' && e.data.nonce===nonce).at(-1) as any)?.data;
}
it('counts successful native Work compactions on the active branch and excludes Chat and failures', async()=>{
  const f = await fixture(); const c = f.client();
  try {
    await c.start();
    await c.promptAndWait('Preserve app.txt and do not commit.',undefined,15000);
    await c.compact();
    expect(await status(c)).toMatchObject({successfulWorkCompactions:1,eligible:false});
    await c.prompt('/chat'); await c.promptAndWait('A chat message.',undefined,15000); await c.compact();
    expect(await status(c)).toMatchObject({successfulWorkCompactions:1,eligible:false});
    await c.prompt('/work'); await c.promptAndWait('Continue work.',undefined,15000);
    f.control.fail=true; await expect(c.compact()).rejects.toThrow(); f.control.fail=false;
    expect(await status(c)).toMatchObject({successfulWorkCompactions:1});
    await c.compact(); await c.promptAndWait('Continue again.',undefined,15000); await c.compact();
    expect(await status(c)).toMatchObject({successfulWorkCompactions:3,eligible:true});
    expect((await c.getState()).sessionId).toBe(f.id);
    const source=(await c.getEntries()).entries.find((e:any)=>e.type==='message' && e.message.role==='user')!;
    const stored=(await c.getState()).sessionFile!;
    await c.stop();
    const resumed=new RpcClient({...f.options,args:[...f.options.args,'--session',stored,...f.options.extensions.flatMap(p=>['--extension',p])]});
    try {await resumed.start();expect(await status(resumed)).toMatchObject({successfulWorkCompactions:3});
      await resumed.fork(source.id);expect(await status(resumed)).toMatchObject({successfulWorkCompactions:0});
    }finally{await resumed.stop();}
  } finally {await c.stop();await f.cleanup();}
},45000);

async function settled(session:any, text:string) {
  const done = new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{unsubscribe();reject(new Error('settlement timeout'));},20000);
    const unsubscribe=session.onEvent((event:any)=>{if(event.type==='agent_settled'){clearTimeout(timer);unsubscribe();resolve();}});
  });
  await session.prompt(text); await done;
}
it('rolls over only at the pressure after three successes and resumes one Conversation with earlier history', async()=>{
  const f=await fixture(); const factory=new RpcPiSessionFactory(f.options);
  let session=await factory.create({sessionId:f.id});
  try {
    for(let i=0;i<3;i++){await settled(session,`Original requirement ${i}: preserve app.txt, do not commit.`);await session.compact();}
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
    f.control.pressure=true;
    await settled(session,'Next pressure boundary.'); f.control.pressure=false;
    const history=await session.getHistory();
    expect(history.entries.some(e=>e.kind==='note' && e.text.includes('Handoff'))).toBe(true);
    expect(history.entries.filter(e=>e.kind==='user')).toHaveLength(4);
    await session.stop(); session=await factory.create({sessionId:f.id});
    await settled(session,'Continue after restart.');
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(5);
    const last=f.requests.at(-1);
    expect(JSON.stringify(last)).toContain('Preserve app.txt');
    expect(JSON.stringify(last)).not.toContain('Original requirement 0');
    expect(last.tools.some((t:any)=>t.function.name==='search_tools')).toBe(true);
  } finally {await session.stop();await f.cleanup();}
},60000);

it('invalidates preparation on cancellation without losing history or repeating work', async()=>{
  const f=await fixture();const factory=new RpcPiSessionFactory(f.options);let session=await factory.create({sessionId:f.id});
  const events:any[]=[];session.onEvent(e=>events.push(e));
  try {
    for(let i=0;i<3;i++){await settled(session,`Preserve app.txt ${i}`);await session.compact();}
    let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
    let started!:()=>void;const preparing=new Promise<void>(r=>{started=r;});
    f.control.synthesis=async()=>{started();await gate;};f.control.pressure=true;
    const turn=settled(session,'Finish this bounded step.');await preparing;
    await session.abort();release();await turn;
    expect(events.some(e=>typeof e.message==='string' && e.message.includes('Handoff stopped'))).toBe(true);
    expect((await session.getHistory()).entries.some(e=>e.kind==='note' && e.text.includes('Handoff:'))).toBe(false);
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(4);
    await session.stop();session=await factory.create({sessionId:f.id});
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(4);
  }finally{await session.stop();await f.cleanup();}
},60000);

it('recovers an uncommitted successor to the predecessor without exposing another task', async()=>{
  const f=await fixture();const factory=new RpcPiSessionFactory(f.options);let session=await factory.create({sessionId:f.id});
  try {
    await settled(session,'Preserve the original task.');await session.stop();
    const {SessionManager}=await import('@earendil-works/pi-coding-agent');
    const {saveBinding,durableFile}=await import('../src/host/pi-segments.js');
    const infos=await SessionManager.listAll(f.options.sessionDir);const original=infos.find(i=>i.id===f.id)!;
    const successor={id:randomUUID(),path:join(f.options.sessionDir,'interrupted-successor.jsonl')};
    await durableFile(successor.path,JSON.stringify({type:'session',version:3,id:successor.id,cwd:f.cwd,timestamp:new Date().toISOString()})+'\n');
    await saveBinding(f.options.sessionDir,{version:1,conversationId:f.id,segments:[{id:f.id,path:original.path}],pending:successor});
    session=await factory.create({sessionId:f.id});
    expect((await session.getHistory()).entries.some(e=>e.kind==='note' && e.text.includes('recovery'))).toBe(true);
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(1);
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
    await expect(readFile(successor.path)).rejects.toMatchObject({code:'ENOENT'});
    await session.stop();session=await factory.create({sessionId:f.id});
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(1);
  }finally{await session.stop();await f.cleanup();}
},30000);
it('fails closed when a committed native segment is missing instead of creating an empty replacement', async()=>{
  const f=await fixture();const factory=new RpcPiSessionFactory(f.options);let session=await factory.create({sessionId:f.id});let reopened:any;
  try {
    for(let i=0;i<3;i++){await settled(session,`Preserve app.txt ${i}`);await session.compact();}
    f.control.pressure=true;await settled(session,'Next pressure boundary.');await session.stop();
    const {SessionManager}=await import('@earendil-works/pi-coding-agent');
    const successor=(await SessionManager.listAll(f.options.sessionDir)).find(i=>i.id!==f.id)!;
    await rm(successor.path);
    await expect(factory.create({sessionId:f.id}).then(s=>{reopened=s;return s;})).rejects.toThrow(/committed|segment|binding/i);
  }finally{await reopened?.stop();await session.stop();await f.cleanup();}
},30000);

it('defers handoff while a real native background child is still running', async()=>{
  const f=await fixture();
  await mkdir(join(f.agentDir,'agents'));
  await writeFile(join(f.agentDir,'agents','probe.md'),'---\nname: probe\ndescription: bounded test child\ntools: read\n---\nRespond once.');
  f.options.extensions.push(resolve('dist/src/subagents/native-adapter.js'),resolve('dist/src/subagents/extension.js'));
  (f.options.env as any).PI_COFFEE_SCHEDULER_DIR=join(f.root,'scheduler');
  const factory=new RpcPiSessionFactory(f.options);const session=await factory.create({sessionId:f.id});const events:any[]=[];
  session.onEvent(e=>events.push(e));let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  f.control.child=()=>gate;
  try{
    for(let i=0;i<3;i++){await settled(session,`Preserve app.txt ${i}`);await session.compact();}
    f.control.tools.push({name:'search_tools',args:{action:'activate',capability_id:'subagent'}},{name:'subagent',args:{agent:'probe',task:'Hold a bounded observation',async:true,model:'localtest/child'}});
    f.control.pressure=true;await settled(session,'Launch the independent observation and finish the parent step.');
    expect(events.some(e=>typeof e.message==='string' && e.message.includes('Children have not settled'))).toBe(true);
    expect((await session.getHistory()).entries.some(e=>e.kind==='note' && e.text.startsWith('Handoff:'))).toBe(false);
  }finally{release();f.control.pressure=false;await session.stop();await f.cleanup();}
},45000);
it('keeps original evidence and both transition notes across two handoffs while counting each new segment from zero', async()=>{
  const f=await fixture();const factory=new RpcPiSessionFactory(f.options);const session=await factory.create({sessionId:f.id});
  try{
    for(let segment=0;segment<2;segment++){
      for(let i=0;i<3;i++){await settled(session,segment===0 ? `Original objective ${i}: preserve app.txt.` : `Progress checkpoint ${i}.`);await session.compact();}
      f.control.pressure=true;await settled(session,'Next bounded pressure checkpoint.');f.control.pressure=false;
    }
    const history=await session.getHistory();
    expect(history.entries.filter(e=>e.kind==='note' && e.text.startsWith('Handoff:'))).toHaveLength(2);
    expect(history.entries.filter(e=>e.kind==='user')).toHaveLength(8);
    const syntheses=f.requests.filter(r=>r.messages.some((m:any)=>String(m.content).startsWith('Create the requested attributed task brief')));
    expect(syntheses).toHaveLength(2);
    expect(JSON.stringify(syntheses[1])).toContain('Original objective 0');
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
  }finally{await session.stop();await f.cleanup();}
},45000);
it('delivers concurrent follow-up input once to the retained session instead of committing its stale brief', async()=>{
  const f=await fixture();const factory=new RpcPiSessionFactory(f.options);const session=await factory.create({sessionId:f.id});
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let started!:()=>void;const preparing=new Promise<void>(r=>{started=r;});
  try{
    for(let i=0;i<3;i++){await settled(session,`Preserve app.txt ${i}`);await session.compact();}
    f.control.synthesis=async()=>{started();await gate;};f.control.pressure=true;
    const turn=settled(session,'Reach a bounded checkpoint.');await preparing;
    const followUp=session.followUp('LATEST_CORRECTION: keep the protected file.');release();await turn;await followUp;
    f.control.pressure=false;f.control.synthesis=undefined;
    await settled(session,'Continue with the queued correction.');
    const history=await session.getHistory();
    expect(history.entries.filter(e=>e.kind==='user' && e.text.includes('LATEST_CORRECTION'))).toHaveLength(1);
    expect(history.entries.some(e=>e.kind==='note' && e.text.startsWith('Handoff:'))).toBe(false);
  }finally{release?.();await session.stop();await f.cleanup();}
},45000);

it.skipIf(process.getuid?.()===0)('stops new execution after a binding commit failure and recovers without replay',async()=>{
  const f=await fixture();const extension=join(f.root,'deny-commit.mjs');
  await writeFile(extension,`import {chmodSync} from 'node:fs';export default pi=>{pi.on('session_start',()=>{if(process.env.PI_COFFEE_MAIN_SESSION!==process.env.PI_COFFEE_ROOT_SESSION)chmodSync(${JSON.stringify(join(f.options.sessionDir,'.coffee-bindings'))},0o500);});};`);
  f.options.extensions.push(extension);const factory=new RpcPiSessionFactory(f.options);let session=await factory.create({sessionId:f.id});
  try{
    for(let i=0;i<3;i++){await settled(session,`Preserve app.txt ${i}`);await session.compact();}
    f.control.pressure=true;await settled(session,'Complete the bounded checkpoint.');
    await expect(session.prompt('Do not execute during ambiguous recovery.')).rejects.toThrow(/recovery required/i);
    await chmod(join(f.options.sessionDir,'.coffee-bindings'),0o700);
    await session.stop();session=await factory.create({sessionId:f.id});
    expect((await session.getHistory()).entries.filter(e=>e.kind==='user')).toHaveLength(4);
    expect((await factory.list()).map(s=>s.id)).toEqual([f.id]);
  }finally{await chmod(join(f.options.sessionDir,'.coffee-bindings'),0o700).catch(()=>{});await session.stop();await f.cleanup();}
},45000);
