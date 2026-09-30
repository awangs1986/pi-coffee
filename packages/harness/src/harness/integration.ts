import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const DELEGATION = new Set(['subagent','subagents_enable','bg_wait','subagent_supervisor']);
const WEB = new Set(['web_search','fetch_content','get_search_content','source_check','web_enable']);
const MAX_RESULT = 8000;
type Fleet = {known:boolean;active:number};

/** Public event-bus adapter only: upstream owns tools, schemas, children and cancellation. */
export default function nativeIntegration(pi:ExtensionAPI):void {
  const pending=new Set<string>();
  const states=new Map<string,string>();
  async function fleet():Promise<Fleet> {
    const requestId=randomUUID(), channel=`subagents:rpc:v1:reply:${requestId}`;
    return new Promise(resolve=>{
      const done=(value:Fleet)=>{clearTimeout(timer);off();resolve(value);};
      const timer=setTimeout(()=>done({known:!pi.getAllTools().some(t=>DELEGATION.has(t.name)),active:0}),2000);
      const off=pi.events.on(channel,(raw:any)=>{
        const f=raw?.data?.fleet;
        const count=Number.isSafeInteger(f?.totalActive) ? Math.max(f.totalActive, f.topLevelAsyncCapacity?.used ?? 0):undefined;
        done({known:raw?.version===1 && raw?.success===true && typeof count==='number' && Number.isSafeInteger(count) && count>=0,active:typeof count==='number' && Number.isSafeInteger(count)?count:0});
      });
      pi.events.emit('subagents:rpc:v1:request',{version:1,requestId,method:'status',params:{}});
    });
  }
  function record(id:string,tool:string,status:'running'|'settled'|'unknown') {
    if(states.get(id)===status)return;
    states.set(id,status);
    pi.events.emit('pi-handoff:work',{id,tool,status});
  }
  async function reconcile():Promise<Fleet> {
    const state=await fleet();
    for(const tool of DELEGATION)record(`native:${tool}`,tool,state.known && state.active===0 && pending.size===0?'settled':state.known?'running':'unknown');
    return state;
  }
  pi.on('session_start',()=>{states.clear();pending.clear();});
  pi.on('session_tree',()=>{states.clear();pending.clear();});
  pi.registerCommand('coffee-workspace-jobs',{description:'Read-only native background-work state for Host lifecycle.',handler:async(args,c)=>{
    if(!/^[a-f0-9-]{36}$/.test(args.trim()))throw Error('Invalid lifecycle query');
    const state=await reconcile();
    pi.appendEntry('coffee-workspace-jobs',{nonce:args.trim(),...state,active:state.active+pending.size});
  }});
  pi.on('tool_execution_start',(e)=>{if(DELEGATION.has(e.toolName)){pending.add(e.toolCallId);record(`native:${e.toolName}`,e.toolName,'running');}});
  pi.on('tool_execution_end',async(e)=>{if(DELEGATION.has(e.toolName)){pending.delete(e.toolCallId);await reconcile();}});
  // Check persisted/current upstream state again at the operation boundary, including resume.
  pi.on('session_before_compact',async()=>{await reconcile();});
  pi.on('tool_call',(e)=>{
    if(e.toolName==='web_search' && (e.input.includeContent===true || (e.input.workflow && e.input.workflow!=='none'))) {
      return {block:true,reason:'Use synchronous search (includeContent=false, workflow=none), then fetch_content for selected sources; background web jobs have no verified settlement interface.'};
    }
  });
  pi.on('tool_result',async(e,c)=>{
    if(!WEB.has(e.toolName) && !DELEGATION.has(e.toolName))return;
    const text=e.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    if(WEB.has(e.toolName)){
      // Read/search returns have completed; explicitly reported background work remains unknown.
      const details=JSON.stringify(e.details ?? {});
      record(`native:${e.toolName}`,e.toolName,/"(?:status|state)":"(?:running|pending|queued)"/.test(details)?'unknown':'settled');
    }
    if(text.length<=MAX_RESULT)return;
    // Preserve machine results only when present; model-facing data is a bounded excerpt.
    if(e.isError || (e.details as any)?.error || (e.details as any)?.totalResults===0)return {content:[{type:'text',text:text.slice(0,MAX_RESULT-80)+'\n[Error output truncated; no research artifact retained.]'}]};
    const session=c.sessionManager.getSessionFile();
    if(!session)throw Error('A durable session is required to retain a large tool result');
    const path=join(dirname(session),'artifacts',c.sessionManager.getSessionId(),`tool-${randomUUID()}.txt`);
    await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,text,{mode:0o600,flag:'wx'});
    const pointer=`\n[Excerpt. Complete result: ${path}. Read bounded ranges when needed.]`;
    return {content:[{type:'text',text:text.slice(0,Math.max(0,MAX_RESULT-pointer.length))+pointer}],...('structuredContent' in e ? {structuredContent:(e as any).structuredContent}: {})};
  });
}
