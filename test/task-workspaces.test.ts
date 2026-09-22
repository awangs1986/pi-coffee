// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
it('creates Chat and Work through the Host API, displays a full cwd, and preserves creation identity on retry',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){}}),configurable:true});
 Element.prototype.scrollTo=vi.fn();
 const calls:any[]=[];let conversations:any[]=[];let fail=false;let holdOpen=false;
 const projects=[{id:'p',name:'owner/demo',branch:'main',webUrl:'http://gitea/owner/demo'}];
 class Socket {static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){queueMicrotask(()=>this.onopen?.());}close(){}send(text:string){const value=JSON.parse(text);if(value.type==='open' && !holdOpen)queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'opened',sessionId:value.sessionId,state:{}})}));}}
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
   if(String(url)==='/api/me')return {ok:true,json:async()=>null};
   const body=init?.body?JSON.parse(init.body):null;
   if(!body)return {ok:true,json:async()=>({projects,conversations,vmId:'linux001',capabilities:{chatWorkspaces:true}})};
   calls.push(body);
   if(body.action==='conversation'){
     if(fail){fail=false;return {ok:false,json:async()=>({error:'temporary clone failure'})};}
     const c={id:body.id,workspaceKind:body.workspaceKind,projectId:body.projectId,cwd:'/home/awang/work/'+(body.workspaceKind==='chat'?'chats/':'projects/checkouts/')+body.id,branch:body.workspaceKind==='chat'?'':'coffee/linux001/'+body.id,creationState:'ready'};conversations.push(c);return {ok:true,json:async()=>c};
   }
   return {ok:true,json:async()=>body.action==='status'?{state:conversations.at(-1)?.workspaceKind==='chat'?'local':'synced',branch:conversations.at(-1)?.branch}:{url:'http://localhost',scope:body.id,token:'test',files:[]}};
 }));
 vi.useFakeTimers();
 try {
   await import('../public/app.js');await vi.advanceTimersByTimeAsync(10);
   const kind=document.querySelector<HTMLSelectElement>('#task-kind');expect(kind).not.toBeNull();
   document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   expect(calls.find(c=>c.action==='conversation')).toMatchObject({workspaceKind:'chat'});
   expect(document.querySelector('#workspace-context')?.textContent).toContain('/home/awang/work/chats/');
   expect(document.querySelector('#workspace-context')?.textContent).toContain('linux001');
   document.querySelector<HTMLButtonElement>('#new-task')!.click();await vi.advanceTimersByTimeAsync(10);
   kind!.value='project';kind!.dispatchEvent(new Event('change'));
   const project=document.querySelector<HTMLSelectElement>('#project-select')!;project.value='p';project.dispatchEvent(new Event('change'));
   (document.querySelector('#start-branch') as HTMLInputElement).value='main';
   holdOpen=true;fail=true;document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   document.querySelector<HTMLButtonElement>('#create-task')!.click();await vi.advanceTimersByTimeAsync(10);
   const creates=calls.filter(c=>c.action==='conversation');expect(creates).toHaveLength(3);expect(creates[1].id).toBe(creates[2].id);expect(creates[2]).toMatchObject({projectId:'p',branch:'main',workspaceKind:'project'});
   expect(document.querySelector('#workspace-context')?.textContent).toContain('/home/awang/work/projects/checkouts/');
   expect(localStorage.getItem('pi-coffee.active.v2')).toBe(creates[2].id);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
