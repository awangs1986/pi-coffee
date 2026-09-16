import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../src/host/workspaces.js';
import { HostServer } from '../src/host/server.js';
import { WebServer } from '../src/web/server.js';
import type { PiSessionFactory } from '../src/host/pi-adapter.js';
describe('authorized Web to fixed VM workspace integration',()=>{
 it('routes two identities to different Host stores and denies forged origins/unknown credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-routing-'));
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw new Error('No model required');}} as PiSessionFactory;
  const a=new HostServer({port:0,token:'token-a',factory,workspaces:new Workspaces(join(root,'a'))});const b=new HostServer({port:0,token:'token-b',factory,workspaces:new Workspaces(join(root,'b'))});await a.start();await b.start();
  const routes={'1':{hostUrl:`ws://127.0.0.1:${a.address().port}/host`,hostToken:'token-a'},'2':{hostUrl:`ws://127.0.0.1:${b.address().port}/host`,hostToken:'token-b'}};
  const web=new WebServer({port:0,hostUrl:'ws://unreachable/host',identity:{giteaUrl:'http://gitea.test',clientId:'test',clientSecret:'test',publicUrl:'http://coffee.test',routes:()=>routes,fetch:(async(url:any,opts:any)=>{
   if(String(url).includes('access_token'))return new Response(JSON.stringify({access_token:new URLSearchParams(opts.body).get('code')}));
   const id=Number(opts.headers.authorization.slice(7));return new Response(JSON.stringify({id,login:'user'+id}));
  }) as typeof fetch}});await web.start();const base=`http://127.0.0.1:${web.address().port}`;
  const login=async(id:string)=>{const start=await fetch(base+'/auth/login',{redirect:'manual'});const state=new URL(start.headers.get('location')!).searchParams.get('state');const end=await fetch(base+`/auth/callback?state=${state}&code=${id}`,{redirect:'manual',headers:{cookie:start.headers.get('set-cookie')!.split(';')[0]}});return end.headers.get('set-cookie')!.split(';')[0];};
  try {
   const ca=await login('1'),cb=await login('2');
   const post=(cookie:string,body:any,origin='http://coffee.test')=>fetch(base+'/api/workspace',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
   expect((await post(ca,{action:'project',name:'alpha'})).status).toBe(200);
   expect((await post(cb,{action:'project',name:'beta'})).status).toBe(200);
   const sa=await(await fetch(base+'/api/workspace',{headers:{cookie:ca}})).json();const sb=await(await fetch(base+'/api/workspace',{headers:{cookie:cb}})).json();
   expect(sa.projects.map((p:any)=>p.name)).toEqual(['alpha']);expect(sb.projects.map((p:any)=>p.name)).toEqual(['beta']);
   expect((await post(cb,{action:'conversation',projectId:sa.projects[0].id})).status).toBe(409);
   expect((await post(ca,{action:'discover'},'http://evil.test')).status).toBe(403);
   expect((await fetch(base+'/api/workspace')).status).toBe(401);
   expect((await fetch(`http://127.0.0.1:${a.address().port}/api/workspace`)).status).toBe(401);
   expect((await fetch(base+'/auth/logout',{method:'POST',headers:{cookie:ca,origin:'http://coffee.test'}})).status).toBe(204);
   expect((await fetch(base+'/api/workspace',{headers:{cookie:ca}})).status).toBe(401);
  }finally{await web.close();await a.close();await b.close();await rm(root,{recursive:true,force:true});}
 });
});
