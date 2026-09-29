import {describe,it,expect} from 'vitest';
import contextUsage from '../src/context/usage-extension.js';
function setup(){
 const hooks=new Map<string,Function>(),commands=new Map<string,any>(),entries:any[]=[];
 const pi:any={on:(name:string,fn:Function)=>hooks.set(name,fn),registerCommand:(name:string,c:any)=>commands.set(name,c),appendEntry:(customType:string,data:any)=>entries.push({type:'custom',customType,data}),getActiveTools:()=>['read','web_search'],getAllTools:()=>[{name:'read'},{name:'web_search'}],events:{emit(){}}};
 const ctx:any={model:{provider:'fixture',id:'test',contextWindow:10000},getSystemPrompt:()=>'',getSystemPromptOptions:()=>({skills:[]}),sessionManager:{getBranch:()=>[],getEntries:()=>entries},};
 contextUsage(pi);return {hooks,commands,entries,ctx};
}
describe('context category reporting at the Pi extension seam',()=>{
 it('attributes the final request without leaking raw content or counting inactive resources',async()=>{
  const a=setup();a.hooks.get('before_provider_request')!({payload:{instructions:'BASE SECRET_SENTINEL\n<project_context>project rules</project_context>\n<available_skills><skill>LSP</skill></available_skills>',tools:[{type:'function',name:'read',description:'read file',parameters:{}},{type:'function',name:'web_search',description:'dynamic search',parameters:{}}],input:[{role:'user',content:'hello'}]}},a.ctx);
  await a.commands.get('coffee-context-usage').handler('00000000-0000-4000-8000-000000000000',a.ctx);
  const d=a.entries.at(-1).data.breakdown;expect(d.basis).toBe('last_request');expect(d.categories.map((c:any)=>c.id)).toEqual(['system','tools','rules','skills','dynamic','subagents','conversation']);
  for(const id of ['system','tools','rules','skills','dynamic','conversation'])expect(d.categories.find((c:any)=>c.id===id).tokens).toBeGreaterThan(0);
  expect(d.categories.find((c:any)=>c.id==='subagents').tokens).toBe(0);expect(d.totalTokens).toBe(d.categories.reduce((n:number,c:any)=>n+c.tokens,0));
  expect(JSON.stringify(a.entries)).not.toContain('SECRET_SENTINEL');expect(d.contextWindow).toBe(10000);
 });
 it('counts Chat tool schemas separately while preserving zero system categories',async()=>{
  const a=setup();a.hooks.get('before_provider_request')!({payload:{messages:[{role:'user',content:'hi'}],tools:[{type:'function',function:{name:'read',description:'Read'}}]}},a.ctx);
  await a.commands.get('coffee-context-usage').handler('00000000-0000-4000-8000-000000000000',a.ctx);
  const c=a.entries.at(-1).data.breakdown.categories;for(const id of ['system','rules','skills','subagents'])expect(c.find((x:any)=>x.id===id).tokens).toBe(0);
  expect(c.find((x:any)=>x.id==='tools').tokens).toBeGreaterThan(0);
 });
 it('does not reuse a prior-model snapshot and marks uncountable media explicitly',async()=>{
  const a=setup();a.hooks.get('before_provider_request')!({payload:{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,secret'}}]}]}},a.ctx);
  await a.commands.get('coffee-context-usage').handler('00000000-0000-4000-8000-000000000000',a.ctx);
  expect(a.entries.at(-1).data.breakdown.mediaOmitted).toBe(true);
  a.ctx.model.id='other';await a.commands.get('coffee-context-usage').handler('00000000-0000-4000-8000-000000000000',a.ctx);
  expect(a.entries.at(-1).data.breakdown.basis).toBe('session_preview');
 });
});
