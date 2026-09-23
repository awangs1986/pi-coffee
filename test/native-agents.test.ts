// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,it,expect,vi} from 'vitest';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();vi.resetModules();});
async function setup(legacy=false){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});Element.prototype.scrollTo=vi.fn();
 const requests:any[]=[],frames:any[]=[],conversations:any[]=[],sockets:any[]=[];
 class Socket{static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){frames.push(JSON.parse(text));}receive(frame:any){this.onmessage?.({data:JSON.stringify(frame)});}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
  if(url==='/api/me')return {ok:true,json:async()=>null};
  if(url==='/api/engines')return {ok:!legacy,json:async()=>({engines:[{id:'pi',name:'Pi',available:true},{id:'codex',name:'Codex',available:true},{id:'claude',name:'Claude Code',available:false,reason:'CLI unavailable'}]})};
  const body=init?.body?JSON.parse(init.body):null;if(!body)return {ok:true,json:async()=>({projects:[],conversations,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
  requests.push(body);if(body.action==='conversation'){const c={...body,cwd:'/home/test/chats/'+body.id,creationState:'ready'};conversations.push(c);return {ok:true,json:async()=>c};}
  return {ok:true,json:async()=>({state:'local',files:[]})};
 }));vi.useFakeTimers();await import('../public/app.js');await vi.advanceTimersByTimeAsync(20);
 return {requests,frames,sockets};
}
it('fixes Agent at Task creation, scopes Model controls and ignores obsolete socket frames',async()=>{
 const app=await setup();const select=document.querySelector<HTMLSelectElement>('#task-engine')!;
 expect([...select.options].map(o=>o.value)).toEqual(['pi','codex','claude']);expect(select.options[2].disabled).toBe(true);
 select.value='codex';select.dispatchEvent(new Event('change'));document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const created=app.requests.find(r=>r.action==='conversation');expect(created.engine).toBe('codex');expect(select.disabled).toBe(true);
 expect(app.frames.find(f=>f.type==='open')).toMatchObject({sessionId:created.id,nativeProtocol:1});
 app.sockets[0].receive({type:'opened',engine:'codex',sessionId:created.id,state:{},capabilities:{models:true,tools:true,questions:true,stop:true,images:true}});
 app.sockets[0].receive({type:'history',sessionId:created.id,entries:[]});await vi.advanceTimersByTimeAsync(10);
 expect(app.frames.filter(f=>f.type.startsWith('get_')).map(f=>f.type)).toEqual(['get_models']);
 expect(document.querySelector('#plugins-btn')?.classList.contains('hidden')).toBe(true);
 const oldHandler=app.sockets[0].onmessage;document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(10);
 oldHandler({data:JSON.stringify({type:'opened',sessionId:'obsolete',state:{}})});expect(localStorage.getItem('pi-coffee.active.v2')).toBeNull();
});
it('keeps Pi available and disables native choices on a legacy Host',async()=>{
 await setup(true);const options=[...document.querySelector<HTMLSelectElement>('#task-engine')!.options];expect(options.map(o=>o.disabled)).toEqual([false,true,true]);
});
it('renders replayed native items once, answers a native question and never resends an uncertain prompt',async()=>{
 const app=await setup();document.querySelector<HTMLSelectElement>('#task-engine')!.value='codex';document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 const opened={type:'opened',sessionId:id,engine:'codex',state:{},capabilities:{models:true,stop:true,questions:true,tools:true}};
 ws.receive(opened);ws.receive({type:'history',sessionId:id,entries:[]});
 const emit=(event:any,cursor:number)=>ws.receive({type:'event',sessionId:id,cursor,event});
 emit({type:'run_started'},1);emit({type:'message_delta',id:'a1',delta:'Hello'},2);emit({type:'message_delta',id:'a1',delta:'Hello'},2);emit({type:'message_completed',id:'a1',text:'Hello'},3);
 emit({type:'tool_update',id:'t1',name:'Read',args:{path:'note.txt'},status:'inProgress'},4);emit({type:'tool_update',id:'t1',status:'completed',result:'native content'},5);
 emit({type:'native_request',id:'q1',method:'input',title:'Choose color',message:'blue'},6);
 expect(document.querySelector('#ui-title')?.textContent).toBe('Choose color');(document.querySelector('#ui-input') as HTMLInputElement).value='blue';document.querySelector<HTMLButtonElement>('#ui-ok')!.click();
 expect(app.frames.find(f=>f.type==='ui_response')).toMatchObject({id:'q1',value:'blue'});emit({type:'run_completed',status:'completed'},7);
 await vi.advanceTimersByTimeAsync(50);expect(document.querySelector('#thread')?.textContent).toContain('native content');expect(document.querySelector('#thread')?.textContent).not.toContain('HelloHello');
 const prompt=document.querySelector<HTMLTextAreaElement>('#prompt')!;prompt.value='one turn';prompt.dispatchEvent(new Event('input'));document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);ws.onclose();await vi.advanceTimersByTimeAsync(1300);const next=app.sockets.at(-1);next.receive(opened);next.receive({type:'history',sessionId:id,entries:[]});
 expect(app.frames.filter(f=>f.type==='prompt')).toHaveLength(1);expect(document.querySelector('#thread')?.textContent).toContain('不会自动重发');
});
it('restores this tab selection even when another tab last selected another Task',async()=>{
 sessionStorage.setItem('pi-coffee.active.v2','this-tab');localStorage.setItem('pi-coffee.active.v2','other-tab');
 const app=await setup();expect(app.frames.find(f=>f.type==='open')).toMatchObject({sessionId:'this-tab'});
});
it('opens seven-category context usage on click without cumulative data and closes explicitly',async()=>{
 const app=await setup();document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(20);
 const id=app.requests.find(r=>r.action==='conversation').id,ws=app.sockets[0];
 ws.receive({type:'opened',sessionId:id,engine:'pi',state:{}});
 ws.receive({type:'stats',sessionId:id,stats:{contextUsage:{percent:25,tokens:10000,contextWindow:40000},contextBreakdown:{version:1,contextWindow:40000,totalTokens:10000,method:'o200k_base_estimate',basis:'last_request',categories:[{id:'system',tokens:1000},{id:'tools',tokens:2000},{id:'rules',tokens:500},{id:'skills',tokens:500},{id:'dynamic',tokens:0},{id:'subagents',tokens:0},{id:'conversation',tokens:6000}]},tokens:{input:90000,output:10000,total:100000},cost:0.1}});
 const trigger=document.querySelector<HTMLButtonElement>('#stats')!;
 const panel=document.querySelector<HTMLDialogElement>('#stats-pop')!;
 // JSDOM lacks the native modal API; actual top-layer painting is verified in Chromium.
 panel.showModal=()=>panel.setAttribute('open','');panel.close=()=>{panel.removeAttribute('open');panel.dispatchEvent(new Event('close'));};
 trigger.dispatchEvent(new Event('mouseenter'));trigger.focus();await vi.advanceTimersByTimeAsync(1);
 expect(trigger.getAttribute('aria-expanded')).toBe('false');
 trigger.click();expect(panel.open).toBe(true);expect(trigger.getAttribute('aria-expanded')).toBe('true');
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('~10.0K / 40K Tokens');
 expect([...document.querySelectorAll('#sp-context-legend .legend-label')].map(e=>e.textContent)).toEqual(['System prompt','Tool definitions','Rules','Skills','MCP & dynamic tools','Subagent definitions','Conversation']);
 expect(document.querySelector('#sp-context-legend')?.textContent).toContain('6.0K');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('90.0K');
 expect(panel.textContent).not.toContain('累计输入');
 document.querySelector<HTMLButtonElement>('#stats-close')!.click();expect(panel.open).toBe(false);expect(document.activeElement).toBe(trigger);
 trigger.click();panel.dispatchEvent(new Event('cancel',{cancelable:true}));expect(panel.open).toBe(false);
 ws.receive({type:'stats',sessionId:id,stats:{contextUsage:{percent:null,tokens:null,contextWindow:40000},tokens:{total:100000},cost:0.1}});
 expect(document.querySelector('#sp-pct')?.textContent).toBe('Usage unavailable');
 expect(document.querySelector('#sp-capacity')?.textContent).toBe('— / 40K Tokens');
 expect(document.querySelector('#sp-context-legend')?.textContent).not.toContain('30.0K');
});

it('collapses task details when starting another Task',async()=>{
 await setup();const disclosure=document.querySelector<HTMLDetailsElement>('.project-manage')!;disclosure.open=true;
 document.querySelector<HTMLButtonElement>('#new-task')!.click();
 expect(disclosure.open).toBe(false);
});
