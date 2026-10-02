// Copied into an isolated consumer so every import comes from installed tarballs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';

const require=createRequire(import.meta.url),root=process.cwd();
const extensions=name=>{
 const directory=dirname(name==='pi-subagents'?require.resolve(name):require.resolve(name+'/package.json'));
 return require(join(directory,'package.json')).pi.extensions.map(entry=>join(directory,entry));
};
const upstream=[...extensions('pi-subagents'),...extensions('pi-web-access')];
const coffee=['pi-coffee-harness','pi-coffee-lsp','context-handoff'].flatMap(extensions);
const requests=[];
const provider=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;
 const body=JSON.parse(raw);requests.push(body);
 const last=body.messages.at(-1),task=last.role==='user'?(typeof last.content==='string'?last.content:(last.content??[]).map(part=>part.text??'').join('')):'';
 if(task.includes('WAIT_CHILD'))return;
 const call=task==='enable delegation'?{name:'subagents_enable',arguments:'{}'}
  : task==='list capabilities'?{name:'subagent',arguments:'{"action":"list","capabilities":true}'}
  : task==='enable web'?{name:'web_enable',arguments:'{}'}
  : task.includes('Report runtime version')?{name:'bash',arguments:JSON.stringify({command:`node -e 'console.log("ACTUAL_CHILD_PI="+require(process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT+"/package.json").version)'`})}:undefined;
 const delta=call?{role:'assistant',tool_calls:[{index:0,id:'fixture-'+requests.length,type:'function',function:call}]}
  :{role:'assistant',content:'TOOLS_OK'};
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(const choice of [{index:0,delta,finish_reason:null},{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}])
  res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice]})}\n\n`);
 res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const names=()=>requests.at(-1).tools.map(tool=>tool.function.name);
try {
 await mkdir(join(root,'tool-sessions'),{recursive:true});
 const observer=join(root,'tool-observer.mjs');
 await writeFile(observer,`import {randomUUID} from 'node:crypto';export default pi=>{
  pi.on('session_start',()=>{const r={version:1,name:'coffee-probe',definition:{description:'synthetic runtime probe',systemPrompt:'Use bash to report the installed runtime.',model:'inherit',tools:['bash'],extensions:[]}};pi.events.emit('pi-subagents:runtime-agent-register:v1',r);if(!r.result?.ok)throw Error('agent registration failed');});
  pi.registerCommand('fixture-rpc',{handler:async args=>{const input=JSON.parse(args),requestId=randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('RPC timed out'));},15000);const off=pi.events.on('subagents:rpc:v1:reply:'+requestId,r=>{clearTimeout(timer);off();pi.appendEntry('fixture-rpc',r);resolve();});pi.events.emit('subagents:rpc:v1:request',{version:1,requestId,...input});});}});
 }`);
 for(const activation of ['eager','auto','dynamic']) for(const coffeeFirst of [true,false]) {
  const cwd=join(root,`activation-${activation}-${coffeeFirst}`),agent=join(cwd,'agent');
  await mkdir(join(agent,'extensions/subagent'),{recursive:true});
  await writeFile(join(agent,'extensions/subagent/config.json'),JSON.stringify({toolActivation:activation}));
  await writeFile(join(agent,'web-search.json'),JSON.stringify({toolActivation:'dynamic',workflow:'none',maxInlineContentChars:6000}));
  await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false},retry:{enabled:false}}));
  const model=id=>({id,name:id,reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048});
  await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{
   baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[model('fixture'),model('other')],
  }}}));
  const results=[],errors=[],events=[],args=['--offline','--no-extensions','--no-skills','--session',join(root,'tool-sessions',`${activation}-${coffeeFirst}.jsonl`),
   ...(coffeeFirst?[...coffee,...upstream]:[...upstream,...coffee]).flatMap(path=>['-e',path]),'-e',observer];
  const make=()=>{
   const c=new RpcClient({cliPath:join(root,'node_modules/.bin/pi'),cwd,provider:'fixture',model:'fixture',
    env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:'work',PI_COFFEE_CAPABILITY_SETTINGS:'off',PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT:join(root,'node_modules/@earendil-works/pi-coding-agent')},args});
   c.onEvent(event=>{events.push(event);if(event.type==='tool_execution_end')results.push(event);if(event.type==='extension_error')errors.push(event);});return c;
  };
  let c=make();
  try {
   await c.start();await c.getState();await c.promptAndWait('initial tools',undefined,15000).catch(error=>{throw Error(error.message+' '+JSON.stringify({activation,coffeeFirst,requests:requests.length,events}));});
   const eager=activation!=='dynamic';
   assert.ok(names().includes(eager?'subagent':'subagents_enable'),`missing ${activation} delegation (${coffeeFirst})`);
   if(activation==='dynamic') {
    assert.ok(!names().includes('subagent'));
    await c.promptAndWait('enable delegation',undefined,15000);
    assert.equal(results.at(-1).toolName,'subagents_enable');assert.equal(results.at(-1).isError,false);
   }
   await c.promptAndWait('list capabilities',undefined,15000);
   assert.ok(names().includes('subagent'));assert.equal(results.at(-1).toolName,'subagent');assert.equal(results.at(-1).isError,false);
   assert.match(JSON.stringify(requests.at(-1).messages),/Active delegation capability/);
   await c.promptAndWait('enable web',undefined,15000);
   assert.equal(results.at(-1).toolName,'web_enable');assert.equal(results.at(-1).isError,false);
   assert.ok(names().includes('web_search'));assert.ok(names().includes('get_search_content'));
   await c.stop();c=make();await c.start();await c.getState();await c.promptAndWait('restored tools',undefined,15000);
   assert.ok(names().includes('subagent'),'native delegation selection survives restore');
   await c.setModel('fixture','other');await c.promptAndWait('model tools',undefined,15000);
   assert.ok(names().includes('subagent'),'model selection preserves native delegation selection');
   await c.prompt('/chat');await c.promptAndWait('chat tools',undefined,15000);
   for(const tool of ['subagent','subagents_enable','web_enable','lsp','search_tools'])assert.ok(!names().includes(tool),`${tool} leaked into Chat`);
   assert.ok(!requests.at(-1).messages.some(message=>['system','developer'].includes(message.role)));
   await c.prompt('/work');await c.promptAndWait('work tools',undefined,15000);
   assert.ok(names().includes(activation==='eager'?'subagent':'subagents_enable'));
   if(activation==='eager' && coffeeFirst) {
    const rpc=async(method,params={})=>{
     await c.prompt('/fixture-rpc '+JSON.stringify({method,params}));
     return (await c.getEntries()).entries.filter(entry=>entry.type==='custom' && entry.customType==='fixture-rpc').at(-1).data;
    };
    const until=async check=>{const deadline=Date.now()+30000;while(!await check()){assert.ok(Date.now()<deadline,'child settlement timed out');await new Promise(resolve=>setTimeout(resolve,100));}};
    const launched=await rpc('spawn',{agent:'coffee-probe',task:'Report runtime version',async:true});
    assert.equal(launched.success,true,JSON.stringify(launched));
    await until(async()=> (await rpc('status')).data.asyncSnapshot.runs.some(run=>run.state==='complete'));
    const version=require('./node_modules/@earendil-works/pi-coding-agent/package.json').version;
    assert.ok(requests.flatMap(request=>request.messages).some(message=>message.role==='tool' && String(message.content).includes('ACTUAL_CHILD_PI='+version)));
    assert.equal((await rpc('spawn',{agent:'coffee-probe',task:'WAIT_CHILD',async:true})).success,true);
    await until(async()=> (await rpc('status')).data.fleet.totalActive>0);
    const running=(await rpc('status')).data.asyncSnapshot.runs.find(run=>!['complete','failed','stopped'].includes(run.state));
    assert.ok(running);assert.equal((await rpc('stop',{id:running.id})).success,true);
    await until(async()=> (await rpc('status')).data.fleet.totalActive===0);
   }
   assert.deepEqual(errors,[]);
  } finally {await c.stop();}
 }
 console.log('NATIVE_UPSTREAM_ACTIVATION_OK');
} finally {
 provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
}
