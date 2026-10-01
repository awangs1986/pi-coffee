import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {RpcClient,SessionManager} from '@earendil-works/pi-coding-agent';
it('applies the Host context preset through native Pi model state and restores it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-window-')),agent=join(root,'agent');await mkdir(agent);
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:1',api:'openai-completions',apiKey:'fixture',models:[{id:'large',name:'large',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:8192},{id:'small',name:'small',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:8192}]}}}));
 const seeded=SessionManager.create(root,join(root,'sessions'));seeded.appendMessage({role:'user',content:'fixture',timestamp:Date.now()});seeded.appendMessage({role:'assistant',api:'openai-completions',provider:'fixture',model:'large',content:[{type:'text',text:'fixture'}],stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
 const args=['--offline','--no-skills','--no-extensions','-e',resolve('src/harness/extension.ts'),'--session',seeded.getSessionFile()!];
 const make=()=>new RpcClient({cwd:root,cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),provider:'fixture',model:'large',env:{PI_CODING_AGENT_DIR:agent,PI_COFFEE_CONTEXT_CONTROL:'1',PI_OFFLINE:'1'},args});
 let c=make();try{await c.start();expect((await c.getState()).model?.contextWindow).toBe(272000);
 await c.prompt('/coffee-context-window maximum');expect((await c.getState()).model?.contextWindow).toBe(500000);
 await c.stop();c=make();await c.start();expect((await c.getState()).model?.contextWindow).toBe(500000);
 await c.setModel('fixture','small');expect((await c.getState()).model?.contextWindow).toBe(128000);
 await c.setModel('fixture','large');expect((await c.getState()).model?.contextWindow).toBe(500000);
 await c.prompt('/coffee-context-window 272k');await c.setModel('fixture','small');expect((await c.getState()).model?.contextWindow).toBe(128000);
 await c.setModel('fixture','large');expect((await c.getState()).model?.contextWindow).toBe(272000);
 }finally{await c.stop();await rm(root,{recursive:true,force:true});}
},30000);
