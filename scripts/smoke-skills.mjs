// Isolated VM-native Skill management probe. No user directories, tasks or model calls.
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {HostServer} from '../dist/src/host/server.js';
import {loadSkills} from '@earendil-works/pi-coding-agent';
const root=await mkdtemp(join(tmpdir(),'coffee-skill-smoke-'));
const source=process.env.SKILL_SMOKE_SOURCE??process.cwd();
const ref=process.env.SKILL_SMOKE_REF??'HEAD';
const host=new HostServer({port:0,token:'isolated-skill-probe',factory:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model calls');}},skills:{root:join(root,'managed'),home:join(root,'home'),allowLocalSources:!process.env.SKILL_SMOKE_SOURCE,...(process.env.PI_COFFEE_GITEA_TOKEN?{gitea:{url:process.env.PI_COFFEE_GITEA_URL,owner:process.env.PI_COFFEE_GITEA_OWNER,token:process.env.PI_COFFEE_GITEA_TOKEN}}:{})}});
try{
 await host.start();const call=async input=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/skills`,{method:'POST',headers:{authorization:'Bearer isolated-skill-probe','content-type':'application/json'},body:JSON.stringify(input)});const data=await response.json();assert.equal(response.status,200,data.error);return data;};
 for(const engine of ['pi','codex','claude']){
  const scope={engine,scope:'user'};const installed=await call({...scope,action:'install',repoUrl:source,ref,subdir:'test/fixtures/skills/example'});const id=installed.skill.id;
  const list=await call({...scope,action:'list'});assert.equal(list.skills.length,1);assert.equal(await readFile(join(list.directory,'example/reference.txt'),'utf8'),'original');
  if(engine==='pi')assert(loadSkills({cwd:root,agentDir:join(root,'home/.pi/agent'),includeDefaults:true,skillPaths:[]}).skills.some(s=>s.name==='example'));
  await call({...scope,action:'disable',id});assert.equal((await call({...scope,action:'list'})).skills[0].enabled,false);
  await call({...scope,action:'enable',id});await call({...scope,action:'update',id});assert((await call({...scope,action:'detail',id})).content.includes('Use the reference.'));
  console.log(JSON.stringify({engine,install:true,detail:true,update:true,disableEnable:true,revision:installed.skill.revision,modelCalls:0}));
 }
}finally{await host.close();await rm(root,{recursive:true,force:true});}
