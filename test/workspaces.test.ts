import { createHash } from "node:crypto";
import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,rm,symlink,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspaces } from '../src/host/workspaces.js';
const exec=promisify(execFile);
const git=(cwd:string,args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd});
describe('VM project lifecycle using native Git',()=>{
 it('creates independent branches, confirms heads, archives before deletion and preserves project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-projects-'));
  try {
   const store=new Workspaces(root);const project=await store.createProject('demo');
   const a=await store.createConversation(project.id);const b=await store.createConversation(project.id,'main');
   expect(a.cwd).not.toBe(b.cwd);expect(a.branch).not.toBe(b.branch);
   await writeFile(join(a.cwd,'feature.txt'),'first');await git(a.cwd,['add','.']);await git(a.cwd,['commit','-m','feature']);
   const proposal=await store.prepareMerge(a.id);expect(proposal.diff).toContain('first');
   await writeFile(join(a.cwd,'feature.txt'),'second');await git(a.cwd,['commit','-am','changed']);
   await expect(store.merge(proposal.token)).rejects.toThrow('changed');
   await expect(store.deleteWorkspace(a.id,a.id)).rejects.toThrow('archived');
   const next=await store.prepareMerge(a.id);expect(await store.merge(next.token)).toEqual({ok:true});
   await expect(store.merge(next.token)).rejects.toThrow(/expired/i);
   await store.archive(a.id,true);await expect(store.cwd(a.id)).rejects.toThrow('Restore');
   expect((await store.deleteWorkspace(a.id,a.id)).retained).toContain('shared project');
   const restored=new Workspaces(root);expect((await restored.list()).conversations.map(c=>c.id)).toEqual([b.id]);
   expect((await restored.tree(b.id)).entries).toBeDefined();
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects path escape, dirty target and deletion of unmerged work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-projects-'));
  try {
   const store=new Workspaces(root),p=await store.createProject('demo'),c=await store.createConversation(p.id);
   await symlink('/etc',join(c.cwd,'escape'));await expect(store.file(c.id,'escape/passwd')).rejects.toThrow('outside');
   await expect(store.file(c.id,'.git')).rejects.toThrow('Git internals');await rm(join(c.cwd,'escape'));
   await writeFile(join(p.path,'dirty'),'x');await expect(store.prepareMerge(c.id)).rejects.toThrow('clean');await rm(join(p.path,'dirty'));
   await writeFile(join(c.cwd,'work'),'x');await git(c.cwd,['add','.']);await git(c.cwd,['commit','-m','work']);
   await store.archive(c.id,true);await expect(store.deleteWorkspace(c.id,c.id)).rejects.toThrow('Unmerged');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('discovers existing projects and refuses unsafe names and stale operation markers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-projects-'));
  try {
   await mkdir(join(root,'manual'));await git(join(root,'manual'),['init','-b','main']);
   const store=new Workspaces(root);expect((await store.discover())[0].name).toBe('manual');
   await expect(store.createProject('../escape')).rejects.toThrow('project name');
   await mkdir(join(root,'.coffee','locks',createHash('sha256').update('registry').digest('hex')),{recursive:true});await expect(store.createProject('blocked')).rejects.toThrow('locked');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

describe('workspace interruption and import boundaries',()=>{
 it('marks an unfinished run interrupted on Host reconstruction without replaying it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-interrupted-'));
  try {
   const ws=new Workspaces(root),p=await ws.createProject('demo'),c=await ws.createConversation(p.id);
   await ws.markRun(c.id,'running');const restored=new Workspaces(root);
   expect((await restored.lookup(c.id))?.runState).toBe('interrupted');
   await restored.archive(c.id,true);await expect(restored.markRun(c.id,'running')).rejects.toThrow('archived');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('imports a bounded ZIP but rejects traversal and Git metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-import-'));
  try{
   const ws=new Workspaces(join(root,'projects'));
   await exec('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('README.md','hello')`,join(root,'safe.zip')]);
   const p=await ws.createProject('safe',undefined,join(root,'safe.zip'));const c=await ws.createConversation(p.id);expect((await ws.tree(c.id)).entries[0].name).toBe('README.md');
   await exec('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('../escape','no')`,join(root,'bad.zip')]);
   await expect(ws.createProject('bad',undefined,join(root,'bad.zip'))).rejects.toThrow('creation failed');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('retains native Git conflict state rather than overwriting or resetting it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-conflict-'));
  try{
   const ws=new Workspaces(root),p=await ws.createProject('demo');await writeFile(join(p.path,'a'),'base');await git(p.path,['add','.']);await git(p.path,['commit','-m','base']);
   const c=await ws.createConversation(p.id);await writeFile(join(c.cwd,'a'),'source');await git(c.cwd,['commit','-am','source']);
   await writeFile(join(p.path,'a'),'target');await git(p.path,['commit','-am','target']);
   const proposal=await ws.prepareMerge(c.id);expect((await ws.merge(proposal.token)).ok).toBe(false);
   expect((await git(p.path,['status','--porcelain'])).stdout).toContain('UU a');
   await expect(ws.prepareMerge(c.id)).rejects.toThrow('clean');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

describe('workspace metadata recovery and artifact references',()=>{
 it('uses project-scoped locks and retains retryable deletion state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-locks-'));
  try{
   const ws=new Workspaces(root),p=await ws.createProject('alpha'),q=await ws.createProject('beta');
   const c=await ws.createConversation(p.id);
   const lock=join(root,'.coffee','locks',createHash('sha256').update('project:'+p.id).digest('hex'));await mkdir(lock);
   await expect(ws.createConversation(p.id)).rejects.toThrow('locked');expect((await ws.createConversation(q.id)).projectId).toBe(q.id);
   await rm(lock,{recursive:true});await ws.archive(c.id,true);
   await expect(ws.deleteWorkspace(c.id,c.id,async()=>{throw new Error('history disk failed');})).rejects.toThrow('history disk failed');
   expect((await ws.lookup(c.id))?.workspaceRemoved).toBe(true);
   await expect(ws.archive(c.id,false)).rejects.toThrow('partially');
   expect((await ws.deleteWorkspace(c.id,c.id)).ok).toBe(true);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('indexes real generated files on the VM and keeps unavailable references after deletion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-artifacts-'));
  try{
   const ws=new Workspaces(root),p=await ws.createProject('demo'),c=await ws.createConversation(p.id);
   await writeFile(join(c.cwd,'diagram.svg'),'<svg/>');await writeFile(join(c.cwd,'.env'),'PRIVATE');
   expect((await ws.artifacts(c.id)).map(f=>f.path)).toContain('diagram.svg');
   await expect(ws.file(c.id,'.env')).rejects.toThrow('outside');
   await rm(join(c.cwd,'diagram.svg'));expect((await ws.artifacts(c.id))[0].available).toBe(false);
   expect((await new Workspaces(root).lookup(c.id))?.artifacts?.[0].available).toBe(false);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

describe('review regressions: preserve actual work and recover operation queues',()=>{
 it('refuses deletion of unmerged detached HEAD commits',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-detached-'));
  try {
   const ws=new Workspaces(root),p=await ws.createProject('demo'),c=await ws.createConversation(p.id);
   await git(c.cwd,['checkout','--detach']);await writeFile(join(c.cwd,'unique.txt'),'must survive');
   await git(c.cwd,['add','.']);await git(c.cwd,['commit','-m','detached work']);
   await ws.archive(c.id,true);
   await expect(ws.deleteWorkspace(c.id,c.id)).rejects.toThrow('Unmerged');
   expect((await ws.tree(c.id)).entries.some(e=>e.name==='unique.txt')).toBe(true);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('creates a conversation from a discovered empty repository without committing unrelated files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-empty-discovered-'));
  try {
   const path=join(root,'manual');await mkdir(path);await git(path,['init','-b','main']);
   await git(path,['config','user.name','Test']);await git(path,['config','user.email','test@localhost']);
   await writeFile(join(path,'unrelated.txt'),'leave untracked');
   await writeFile(join(path,'staged.txt'),'leave staged');await git(path,['add','staged.txt']);
   const ws=new Workspaces(root),[p]=await ws.discover();const c=await ws.createConversation(p.id);
   expect(c.cwd).not.toBe(path);expect((await git(path,['status','--porcelain'])).stdout).toContain('?? unrelated.txt');
   expect((await git(path,['status','--porcelain'])).stdout).toContain('A  staged.txt');
   expect((await git(c.cwd,['ls-files'])).stdout).toBe('');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('does not discard a queued operation when its predecessor fails',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-queue-failure-'));
  try {
   const ws=new Workspaces(root),p=await ws.createProject('demo');
   const results=await Promise.allSettled([ws.createConversation(p.id,'missing'),ws.createConversation(p.id)]);
   expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('fulfilled');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
