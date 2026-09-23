// Real browser shell, synthetic Host responses. No account, VM writes, or model calls.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {WebSocketServer} from 'ws';
const root=resolve('public');
const conversation={id:'layout-task',workspaceKind:'project',creationState:'ready',projectId:'demo',cwd:'/home/awang/work/projects/checkouts/00000000-0000-4000-8000-000000000000',branch:'coffee/test-vm/00000000-0000-4000-8000-000000000000',startSha:'abc',createdAt:new Date().toISOString()};
const tasks=Array.from({length:40},(_,i)=>({...conversation,id:i?'layout-task-'+i:conversation.id,engine:'pi'}));
const changes={branch:conversation.branch,base:'abc123',target:'def456',refreshedAt:'2026-09-22T12:00:00Z',files:Array.from({length:90},(_,i)=>({path:'src/components/example-'+i+'.ts',status:'M',additions:8,deletions:2})),checks:[{command:'git diff --check',ok:true,output:''}],patch:'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new',stat:'1 file changed',checkpointPaths:['src/example.ts']};
const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/api/engines')return res.end(JSON.stringify({engines:['pi','codex','claude'].map(id=>({id,name:id,available:true}))}));
 if(req.url==='/api/me')return res.end(JSON.stringify({login:'demo-owner'}));
 if(req.url==='/api/workspace'){
  let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;
  const state={vmId:'test-vm',projects:[{id:'demo',name:'example/project',branch:'main',webUrl:'https://example.com/example/project'}],conversations:tasks,capabilities:{chatWorkspaces:true}};
  const result=!body?state:body.action==='files'?{url:`http://127.0.0.1:${server.address().port}`,scope:conversation.id,token:'synthetic',files:[]}:body.action==='status'?{state:'ahead',dirty:true,branch:conversation.branch,lastRemoteAt:'2026-09-22T12:00:00Z'}:body.action==='changes'?changes:{};
  return res.end(JSON.stringify(result));
 }
 if(req.url.includes('/artifacts'))return res.end('{"artifacts":[]}');
 const path=resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(root+'/')){res.statusCode=404;return res.end();}
 try{res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/plain');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',ws=>ws.on('message',raw=>{
 const f=JSON.parse(raw);const send=x=>ws.send(JSON.stringify(x));
 if(f.type==='list_sessions')send({type:'sessions',sessions:tasks.map((c,i)=>({id:c.id,name:'布局验收 '+i+' · 长任务标题测试，不包含用户对话',updatedAt:c.createdAt,messageCount:2}))});
 if(f.type==='open'){send({type:'opened',sessionId:f.sessionId,engine:'pi',state:{}});send({type:'event',sessionId:f.sessionId,event:{type:'extension_ui_request',method:'setStatus',key:'fixture',text:'⧉ idle'}});send({type:'history',sessionId:conversation.id,entries:[{kind:'user',text:'请检查项目的排版问题。'},{kind:'assistant',text:'已定位问题，变更保存在当前任务目录。\n\n```ts\nconst layout = "responsive";\n```'}]});}
 if(f.type==='get_stats')send({type:'stats',sessionId:conversation.id,stats:{contextUsage:{percent:50,tokens:5000,contextWindow:10000},tokens:{total:6000,input:5000,output:1000},cost:0.01}});
 if(f.type==='get_models')send({type:'models',models:[{provider:'fixture',id:'demo-model',source:'native'}],current:{provider:'fixture',id:'demo-model'},thinkingLevels:['low','high'],thinkingLevel:'high'});
}));
const port=Number(process.env.PI_COFFEE_LAYOUT_PORT || 4175);
await new Promise(r=>server.listen(port,'127.0.0.1',r));
console.log(`Layout fixture: http://127.0.0.1:${server.address().port}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const ws of wss.clients)ws.terminate();wss.close();server.close();});
