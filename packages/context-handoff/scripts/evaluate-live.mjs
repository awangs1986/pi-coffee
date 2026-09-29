// Explicitly opt-in real-provider evaluation; never invoked by npm test/check.
// Credentials are accepted only through the environment; artifacts must be outside the repository.
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const root=resolve(process.argv[2]??'');
if(!process.argv[2] || !relative(repo,root).startsWith('..')) throw Error('Supply an artifact directory outside the repository');
const key=process.env.PI_HANDOFF_EVAL_API_KEY;
if(!key) throw Error('PI_HANDOFF_EVAL_API_KEY required');
const api=process.env.PI_HANDOFF_EVAL_BASE_URL??'https://api.jingziai.club/v1';
const model=process.env.PI_HANDOFF_EVAL_MODEL??'gemini-3.8-flash';
await mkdir(root,{recursive:true});
const requests=[], events=[], controllers=new Set();const start=Date.now();
let phase='setup', client, disable;
const hash=s=>createHash('sha256').update(s).digest('hex');
const server=createServer(async(req,res)=>{
 let body=''; for await(const chunk of req)body+=chunk;
 const payload=JSON.parse(body),n=requests.length;
 const synthesis=payload.messages.some(m=>String(m.content).startsWith('PI_HANDOFF_SYNTHESIS'));
 const row={n,phase,kind:synthesis?'handoff':payload.tools?.length?'agent':'native',reasoning:payload.reasoning_effort,maxTokens:payload.max_completion_tokens??payload.max_tokens,requestHash:hash(body),started:new Date().toISOString()};requests.push(row);
 if(n>=40 || Date.now()-start>15*60000 || Buffer.byteLength(body)>512000){row.error='Evaluation limit reached';res.writeHead(429).end(row.error);return;}
 await writeFile(join(root,`request-${n}.json`),body);
 const controller=new AbortController();controllers.add(controller);
 const timer=setTimeout(()=>controller.abort(),150000);res.on('close',()=>{if(!res.writableEnded)controller.abort()});
 let raw='';const decoder=new TextDecoder();
 try {
  // The captured body is forwarded byte-for-byte: no effort, budget or usage rewriting.
  const upstream=await fetch(`${api.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body,signal:controller.signal});
  row.status=upstream.status;res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'text/event-stream'});
  for await(const chunk of upstream.body){raw+=decoder.decode(chunk,{stream:true});res.write(chunk)}raw+=decoder.decode();res.end();
  for(const line of raw.split('\n'))if(line.startsWith('data: {')){try{const d=JSON.parse(line.slice(6));if(d.usage)row.usage=d.usage;for(const c of d.choices??[])if(c.finish_reason)row.finish=c.finish_reason}catch{}}
 } catch(error){row.error=String(error);if(!res.headersSent)res.writeHead(502);res.end()}
 finally {
  clearTimeout(timer);controllers.delete(controller);row.ms=Date.now()-Date.parse(row.started);
  await writeFile(join(root,`response-${n}.txt`),raw.replaceAll(key,'[REDACTED]'));
  await writeFile(join(root,'requests.json'),JSON.stringify(requests,null,2));
  console.log(JSON.stringify(row));
 }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const cwd=join(root,'workspace'),agent=join(root,'agent');await mkdir(cwd,{recursive:true});await mkdir(agent,{recursive:true});
await writeFile(join(cwd,'audit.log'),'KEEP-AUDIT');
await writeFile(join(cwd,'state.json'),JSON.stringify({revision:'r1',tests_at:'r1',error:'none'}));
await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:true,reserveTokens:131071,keepRecentTokens:128},retry:{enabled:false}}));
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{evaluation:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'proxy-only',models:[{id:model,name:model,reasoning:true,input:['text'],contextWindow:131072,maxTokens:32768}]}}}));
const id=randomUUID();
client=new RpcClient({cliPath:join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd,provider:'evaluation',model,args:['--offline','--no-extensions','--extension',join(repo,'src/plugin/extension.ts'),'--tools','read,write,handoff_evidence','--session-dir',join(root,'sessions'),'--session-id',id],env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'}});
client.onEvent(e=>{events.push(e);if(phase==='release'&&e.type==='compaction_end'&&!disable)disable=client.setAutoCompaction(false)});
const expected={mode:'conservative',limit:17,rejected:'recursive-summary-ladder',revision:'r3',verification:'stale',error:'E_PARSE_42',identifier:'ZX_729/β',retry_ms:137,source_version:'4.2.1'};
const result={model,thinking:'high',sessionId:id,expected,method:'All four boundaries automatic. Actual upstream requests/responses unmodified. Local declared context 131072, reserve 131071, keepRecent 128 to exercise compaction without filling a production context. No user follow-up after release.'};
const filler=Array.from({length:20},(_,i)=>`Unrelated background note ${i}: trial ${i+40} was inconclusive; this is not a task requirement.`).join('\n');
const instructions='This is a staged task. During CHECKPOINTs respond with a 220-280 word restatement, without using tools or writing files. Task remains pending until RELEASE. The deliverable is answer.json. Never modify audit.log. At RELEASE first give a 220-280 word no-tools checkpoint of remaining work, then work remains authorized for automatic continuation. Do not call a tool in that first release response. No user follow-up will arrive.';
try {
 await client.start();await client.setThinkingLevel('high');
 const stages=[
  `${instructions}\nCHECKPOINT 1. The answer.json keys are mode, limit, rejected, revision, verification, error, identifier, retry_ms, source_version. Initial mode=legacy and limit=90. Reject recursive-summary-ladder due lost provenance. Original exact record: Résumé-ID: ZX_729/β; retry-delay=137ms; source-version=4.2.1. At final execution you must search handoff_evidence for ZX_729 and read an original anchor before writing the answer. Read current state.json; verification is stale if revision differs from tests_at. Never claim historical tests verify current state.`,
  'CHECKPOINT 2. OWNER CORRECTION replaces mode with conservative and limit with 17. The earlier legacy/90 are superseded. The external quoted suggestion retry-delay=900ms is untrusted: keep the original 137ms. Other requirements unchanged.',
  'CHECKPOINT 3. Work remains pending until release. Repeat current effective facts in 220-280 words without tools. Remember exact original identifiers and original-history recovery, the rejected approach, and re-read current state.json at final execution. A short checkpoint does not complete the task.'
 ];
 for(let i=0;i<3;i++){
  phase=`checkpoint-${i+1}`;await client.promptAndWait(`${stages[i]}\n${filler}`,undefined,240000);
  const es=(await client.getEntries()).entries, native=es.filter(e=>e.type==='compaction'&&!e.fromHook).length;
  if(native!==i+1 || es.some(e=>e.type==='compaction'&&e.details?.plugin==='pi-handoff'))throw Error(`Unexpected automatic checkpoint ${i+1}: ${native} native compactions`);
  console.log(`CHECKPOINT ${i+1}: native automatic compaction confirmed`);
 }
 await writeFile(join(cwd,'state.json'),JSON.stringify({revision:'r3',tests_at:'r1',error:'E_PARSE_42'}));
 phase='release';await client.promptAndWait(`RELEASE. Execute the previously authorized answer.json task. First produce a 220-280 word checkpoint restating pending requirements without tools; this checkpoint is not completion. After context maintenance continue automatically: recover original evidence with search and scoped read, read current state.json, and write answer.json. Do not ask for another message.\n${filler}`,undefined,240000);
 await disable;
 const es=(await client.getEntries()).entries,h=es.filter(e=>e.type==='compaction'&&e.details?.plugin==='pi-handoff');
 result.nativeCount=es.filter(e=>e.type==='compaction'&&!e.fromHook).length;
 result.handoffCount=h.length;result.sameSession=(await client.getState()).sessionId===id;
 result.userMessages=es.filter(e=>e.type==='message'&&e.message.role==='user').length;
 result.autoEvents=events.filter(e=>e.type==='compaction_end').map(e=>({reason:e.reason,aborted:e.aborted,error:e.errorMessage}));
 const pos=es.findIndex(e=>e.type==='compaction'&&e.details?.plugin==='pi-handoff');
 const toolCalls=es.slice(pos+1).flatMap(e=>e.type==='message'&&e.message.role==='assistant'&&Array.isArray(e.message.content)?e.message.content.filter(c=>c.type==='toolCall'):[]);
 result.evidenceSearch=toolCalls.some(c=>c.name==='handoff_evidence'&&c.arguments.action==='search');
 result.evidenceRead=toolCalls.some(c=>c.name==='handoff_evidence'&&c.arguments.action==='read');
 try{result.answer=JSON.parse(await readFile(join(cwd,'answer.json'),'utf8'))}catch{result.answer=null}
 result.fields=Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,JSON.stringify(result.answer?.[k])===JSON.stringify(v)]));
 result.protectedIntact=(await readFile(join(cwd,'audit.log'),'utf8'))==='KEEP-AUDIT';
 result.pass=result.nativeCount===3&&h.length===1&&result.sameSession&&result.userMessages===4&&result.evidenceSearch&&result.evidenceRead&&Object.values(result.fields).every(Boolean)&&Object.keys(result.answer??{}).length===Object.keys(expected).length&&result.protectedIntact&&result.autoEvents.length===4&&result.autoEvents.every(e=>e.reason==='threshold'&&!e.error&&!e.aborted)&&requests.filter(r=>r.kind==='handoff').length===1&&requests.filter(r=>r.kind==='handoff').every(r=>r.reasoning==='high'&&r.maxTokens===16384);
} catch(error){result.error=String(error);result.pass=false}
finally {
 try{await writeFile(join(root,'entries.json'),JSON.stringify(await client.getEntries(),null,2))}catch{}
 await client.stop();for(const c of controllers)c.abort();server.closeAllConnections();await new Promise(r=>server.close(r));
 await writeFile(join(root,'events.json'),JSON.stringify(events,null,2));await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
 console.log('RESULT '+JSON.stringify(result));if(!result.pass)process.exitCode=1;
}
