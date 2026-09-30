import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {expect,it} from 'vitest';

it('bounds model results, preserves recoverable evidence and rejects unobservable background searches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'harness-results-')),agent=join(root,'agent'),cwd=join(root,'workspace');
 await mkdir(agent);await mkdir(cwd);let scenario='valid';const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const b=JSON.parse(raw);requests.push(b);
  const call=b.messages.at(-1).role==='user'?{name:'web_search',arguments:JSON.stringify({query:scenario,workflow:'none',includeContent:scenario==='background'})}:undefined;
  const delta=call?{role:'assistant',tool_calls:[{index:0,id:'probe-'+requests.length,type:'function',function:call}]}:{role:'assistant',content:'DONE'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const choice of [{index:0,delta,finish_reason:null},{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false},retry:{enabled:false}}));
 const fixture=join(root,'web.mjs');await writeFile(fixture,`export default pi=>{pi.registerTool({name:'web_search',label:'Search',description:'Search',parameters:{type:'object',properties:{query:{type:'string'},workflow:{type:'string'},includeContent:{type:'boolean'}}},async execute(id,args){return {content:[{type:'text',text:(args.query==='valid'?'USEFUL_EVIDENCE ':'INVALID_RESULT ').repeat(2000)+'END_OF_EVIDENCE'}],details:{totalResults:args.query==='valid'?1:0},isError:args.query==='error'}}});}`);
 const c=new RpcClient({cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd,provider:'fixture',model:'fixture',env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:'chat'},args:['--offline','--no-extensions','--session-dir',join(root,'sessions'),'-e',resolve('.'),'-e',fixture]});
 const results:any[]=[];c.onEvent(e=>{if(e.type==='tool_execution_end')results.push(e);});
 try{
  await c.start();await c.getState();await c.promptAndWait('Search valid evidence',undefined,10000);
  const text=results.at(-1).result.content[0].text;expect(text.length).toBeLessThanOrEqual(8000);
  const path=/Complete result: (.*)\. Read bounded ranges/.exec(text)?.[1];expect(path).toBeTruthy();
  const original=await readFile(path!,'utf8');expect(original.length).toBeGreaterThan(20000);expect(original).toContain('END_OF_EVIDENCE');
  const modelText=requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1).content;expect(modelText).toBe(text);
  for(scenario of ['empty','error']){await c.promptAndWait('Search '+scenario,undefined,10000);expect(results.at(-1).result.content[0].text.length).toBeLessThanOrEqual(8000);expect(results.at(-1).result.content[0].text).toContain('no research artifact');}
  expect(await readdir(join(path!,'..'))).toHaveLength(1);
  scenario='background';await c.promptAndWait('Search background',undefined,10000);expect(results.at(-1).isError).toBe(true);expect(JSON.stringify(results.at(-1))).toContain('synchronous');
  expect(await readdir(join(path!,'..'))).toHaveLength(1);
 }finally{await c.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
