import { getEncoding } from 'js-tiktoken';
import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ContextBreakdown, ContextCategoryId } from './usage-contract.js';
import { currentHarnessMode } from '../harness/runtime-mode.js';

const ENTRY='coffee-context-usage';
const IDS:ContextCategoryId[]=['system','tools','rules','skills','dynamic','subagents','conversation'];
const BASE=new Set(['read','edit','write','bash','git','search_tools','recall_folded']);
let encoding:ReturnType<typeof getEncoding> | undefined;
const count=(text:string)=>text ? (encoding ??= getEncoding('o200k_base')).encode(text,[],[]).length : 0;
const object=(v:unknown):Record<string,any>=>v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,any> : {};

/** Read-only observer: only bounded numeric attribution crosses the Pi/Host seam. */
export default function contextUsage(pi:ExtensionAPI):void {
 let latest:ContextBreakdown | undefined;
 let snapshotMode=currentHarnessMode(pi);
 const modelKey=(ctx:ExtensionContext)=>`${ctx.model?.provider ?? ''}/${ctx.model?.id ?? ''}`;
 function measure(payload:unknown,ctx:ExtensionContext,basis:ContextBreakdown['basis']):ContextBreakdown {
  const groups=Object.fromEntries(IDS.map(id=>[id,[] as string[]])) as Record<ContextCategoryId,string[]>;
  let mediaOmitted=false;
  function clean(value:any):any {
   if(Array.isArray(value))return value.map(clean);
   if(!value || typeof value!=='object')return value;
   if(['image','image_url','input_image','input_audio','audio','video'].includes(value.type) || value.inlineData || value.inline_data){mediaOmitted=true;return {type:'media_not_tokenized'};}
   return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,clean(v)]));
  }
  function add(id:ContextCategoryId,value:unknown){if(value===undefined || value===null || value==='')return;groups[id].push(typeof value==='string'?value:JSON.stringify(clean(value)));}
  function system(value:unknown){
   let text=typeof value==='string'?value:JSON.stringify(clean(value)) || '';
   for(const [id,pattern] of [
    ['rules',/<project_context>[\s\S]*?<\/project_context>/g],
    ['skills',/<available_skills>[\s\S]*?<\/available_skills>/g],
    ['subagents',/<available_agents>[\s\S]*?<\/available_agents>/g],
   ] as [ContextCategoryId,RegExp][])text=text.replace(pattern,match=>{add(id,match);return '';});
   add('system',text);
  }
  const p=object(payload);
  for(const key of ['system','instructions','systemInstruction','system_instruction'])if(p[key])system(p[key]);
  for(const key of ['systemInstruction','system_instruction'])if(p.config?.[key])system(p.config[key]);
  const tools=Array.isArray(p.tools)?p.tools:[];
  for(const tool of tools){
   const definitions=tool.functionDeclarations || tool.function_declarations || [tool];
   for(const definition of definitions){const name=definition.name || definition.function?.name;add(BASE.has(name)?'tools':'dynamic',definition);}
  }
  // Classify loaded instruction files using their actual tool-call provenance.
  const resultKinds=new Map<string,ContextCategoryId>();
  const messages=p.messages || p.input || p.contents || [];
  if(typeof messages==='string')add('conversation',messages);
  else if(Array.isArray(messages))for(const message of messages){
   if(['system','developer'].includes(message.role)){system(message.content);continue;}
   const blocks=Array.isArray(message.content)?message.content:[];
   for(const call of [...blocks,...(message.tool_calls || [])]){
    if(!['toolCall','tool_use','function_call'].includes(call.type) && !call.function)continue;
    const name=call.name || call.function?.name;let args=call.arguments || call.input || call.function?.arguments;
    try{if(typeof args==='string')args=JSON.parse(args);}catch{continue;}
    if(name==='read' && typeof args?.path==='string'){
     const path=args.path.replace(/\\/g,'/');const kind=/\/SKILL\.md$/.test(path)?'skills':/(^|\/)(AGENTS|CLAUDE)\.md$/.test(path)?'rules':/\/\.pi\/agents\/[^/]+\.md$/.test(path)?'subagents':undefined;
     if(kind)resultKinds.set(call.id || call.call_id,kind);
    }
   }
   if(message.type==='function_call'){
    let args=message.arguments;try{if(typeof args==='string')args=JSON.parse(args);}catch{args={};}
    if(message.name==='read' && typeof args?.path==='string'){
     const kind=/\/SKILL\.md$/.test(args.path)?'skills':/(^|\/)(AGENTS|CLAUDE)\.md$/.test(args.path)?'rules':/\/\.pi\/agents\/[^/]+\.md$/.test(args.path)?'subagents':undefined;
     if(kind)resultKinds.set(message.call_id,kind);
    }
   }
   const resultId=message.toolCallId || message.tool_call_id || (message.type==='function_call_output'?message.call_id:undefined);
   if(resultId){add(resultKinds.get(resultId) || 'conversation',message);continue;}
   if(blocks.some((b:any)=>b.type==='tool_result')){
    for(const block of blocks)add(block.type==='tool_result'?(resultKinds.get(block.tool_use_id) || 'conversation'):'conversation',block);
   }else add('conversation',message);
  }
  const categories=IDS.map(id=>({id,tokens:groups[id].reduce((sum,text)=>sum+count(text),0)}));
  return {version:1,method:'o200k_base_estimate',basis,model:modelKey(ctx),capturedAt:new Date().toISOString(),contextWindow:ctx.model?.contextWindow || 0,totalTokens:categories.reduce((n,c)=>n+c.tokens,0),categories,mediaOmitted};
 }
 pi.on('before_provider_request',(event,ctx)=>{try{latest=measure(event.payload,ctx,'last_request');snapshotMode=currentHarnessMode(pi);}catch{latest=undefined;}});
 const invalidate=()=>{latest=undefined;};
 pi.on('session_start',invalidate);pi.on('session_compact',invalidate);pi.on('session_tree',invalidate);pi.on('model_select',invalidate);
 pi.registerCommand(ENTRY,{description:'Read-only categorized context estimate for the Web usage panel.',handler:async(args,ctx)=>{
  if(!/^[a-f0-9-]{36}$/.test(args.trim()))return;
  if(!latest || latest.basis==='session_preview' || latest.model!==modelKey(ctx) || snapshotMode!==currentHarnessMode(pi)){
   const active=new Set(pi.getActiveTools());
   const messages=convertToLlm(buildSessionContext(ctx.sessionManager.getEntries(),ctx.sessionManager.getLeafId?.()).messages).map(message=>({role:message.role,content:message.content,...(message.role==='toolResult'?{toolCallId:message.toolCallId}: {})}));
   snapshotMode=currentHarnessMode(pi);
   latest=measure({system:currentHarnessMode(pi)==='chat'?'':ctx.getSystemPrompt(),tools:pi.getAllTools().filter(t=>active.has(t.name)).map(t=>({name:t.name,description:t.description,parameters:t.parameters})),messages},ctx,'session_preview');
  }
  pi.appendEntry(ENTRY,{nonce:args.trim(),breakdown:latest});
 }});
}
