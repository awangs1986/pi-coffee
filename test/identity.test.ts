import { describe,it,expect } from 'vitest';
import { WebServer } from '../src/web/server.js';
import type { UserRoute } from '../src/web/identity.js';
import { WebSocket } from 'ws';
describe('Gitea identity and fixed VM routing',()=> {
 it('uses PKCE/state and HttpOnly sessions; denies absent routes, revoked routes and foreign origins',async()=> {
  let routes:Record<string,UserRoute>={'7':{hostUrl:'ws://127.0.0.1:1/host',hostToken:'vm-only-secret'}};
  let challenge='';
  const fakeFetch=async(url:any,options:any)=>{
   if(String(url).includes('access_token')){expect(String(options.body)).toContain('code_verifier=');return new Response(JSON.stringify({access_token:'gitea-token'}));}
   expect(options.headers.authorization).toBe('Bearer gitea-token');return new Response(JSON.stringify({id:7,login:'owner',active:true}));
  };
  const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{giteaUrl:'http://gitea.test',clientId:'app',clientSecret:'server-only',publicUrl:'http://coffee.test',routes:()=>routes,fetch:fakeFetch as typeof fetch}});
  await web.start();const base=`http://127.0.0.1:${web.address().port}`;
  try {
   expect((await fetch(base+'/api/me')).status).toBe(401);
   expect((await fetch(base+'/auth/callback?state=invalid&code=x',{redirect:'manual'})).status).toBe(401);
   const login=await fetch(base+'/auth/login',{redirect:'manual'});const target=new URL(login.headers.get('location')!);
   expect(target.searchParams.get('code_challenge_method')).toBe('S256');challenge=target.searchParams.get('state')!;
   const result=await fetch(base+`/auth/callback?state=${challenge}&code=x`,{redirect:'manual',headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]}});
   expect(result.status).toBe(302);expect(result.headers.get('set-cookie')).toContain('HttpOnly');
   const cookie=result.headers.get('set-cookie')!.split(';')[0];
   const me=await fetch(base+'/api/me',{headers:{cookie}});expect(await me.json()).toEqual({id:'7',login:'owner'});
   const forbidden=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{cookie,origin:'http://evil.test'}});
   const status=await new Promise<number>((resolve,reject)=>{forbidden.on('unexpected-response',(_,res)=>{res.resume();forbidden.terminate();resolve(res.statusCode!);});forbidden.on('error',()=>{});});expect(status).toBe(403);
   routes={};expect((await fetch(base+'/api/me',{headers:{cookie}})).status).toBe(401);
   const replay=await fetch(base+`/auth/callback?state=${challenge}&code=x`,{headers:{cookie:'coffee_oauth='+challenge},redirect:'manual'});expect(replay.status).toBe(401);
  }finally{await web.close();}
 });
});
