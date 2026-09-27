import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../src/host/workspaces.js';

describe('Chat task workspace lifecycle', () => {
  it('creates one durable directory per task without Git, retries the same creation, and preserves archived files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coffee-chat-'));
    try {
      const ws = new Workspaces(join(root, 'projects'), { ownerId: 'vm-chat' });
      const a = await ws.createChatConversation('chat-a');
      const b = await ws.createChatConversation('chat-b');
      expect(a.cwd).toBe(join(root, 'chats', 'chat-a'));
      expect(b.cwd).not.toBe(a.cwd);
      expect(await ws.runtimeEnvironment(a.id)).toMatchObject({PI_COFFEE_WORKSPACE_CWD:a.cwd,PI_COFFEE_DATA_ROOT:a.cwd,PI_COFFEE_INITIAL_MODE:'chat',PI_SUBAGENTS_TEMP_ROOT:join(a.cwd,'artifacts','subagent-runs')});
      expect(await readdir(a.cwd)).toEqual(expect.arrayContaining(['inbox','artifacts','research','images']));
      expect(await ws.createChatConversation('chat-a')).toEqual(a);
      await writeFile(join(a.cwd, 'images', 'drawing.svg'), '<svg/>');
      expect((await ws.artifacts(a.id)).map(f=>f.path)).toContain('images/drawing.svg');
      await expect(ws.file(b.id, '../chat-a/images/drawing.svg')).rejects.toThrow('outside');
      await ws.archive(a.id, true);
      expect(await readFile(join(a.cwd, 'images', 'drawing.svg'), 'utf8')).toBe('<svg/>');
      const restored = new Workspaces(join(root, 'projects'), { ownerId: 'vm-chat' });
      await restored.archive(a.id, false);
      expect(await restored.cwd(a.id)).toBe(a.cwd);
      expect((await restored.syncStatus(a.id)).state).toBe('local');
      await restored.archive(a.id, true);
      await expect(restored.deleteWorkspace(a.id, a.id)).rejects.toThrow('local files');
      await restored.deleteWorkspace(a.id, a.id, async()=>{}, true);
      await expect(stat(a.cwd)).rejects.toThrow();
      expect(await restored.cwd(b.id)).toBe(b.cwd);
      await expect(restored.createChatConversation(a.id)).rejects.toThrow('deleted');
    } finally { await rm(root, { recursive:true, force:true }); }
  });
});

it('routes uploaded originals and downloads to the owning Chat cwd', async()=>{
  const { TransferServer }=await import('../src/host/transfer.js');
  const root=await mkdtemp(join(tmpdir(),'coffee-chat-files-'));
  const ws=new Workspaces(join(root,'projects'));const a=await ws.createChatConversation('a'),b=await ws.createChatConversation('b');
  const transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces:ws});await transfer.start();
  try {
    const base=`http://127.0.0.1:${transfer.address().port}/api/localsend/v2/`;
    const params=new URLSearchParams({scope:a.id,token:transfer.issueToken(a.id)});
    const response=await fetch(base+'prepare-upload?'+params,{method:'POST',body:JSON.stringify({files:{f:{fileName:'original.png',size:3,fileType:'image/png'}}})});
    expect(response.status).toBe(200);const upload=await response.json();
    expect((await fetch(base+'upload?'+new URLSearchParams({sessionId:upload.sessionId,fileId:'f',token:upload.files.f}),{method:'POST',body:'PNG'})).status).toBe(200);
    expect(await readFile(join(a.cwd,'inbox/original.png'),'utf8')).toBe('PNG');
    expect((await fetch(base+'download?'+params+'&fileId=inbox/original.png')).status).toBe(200);
    const other=new URLSearchParams({scope:b.id,token:transfer.issueToken(b.id)});
    expect((await fetch(base+'download?'+other+'&fileId=../a/inbox/original.png')).status).toBe(403);
    await ws.archive(a.id,true);
    await transfer.quiesce(a.id);
    expect((await fetch(base+'prepare-upload?'+params,{method:'POST',body:'{}'})).status).toBe(401);
  } finally {await transfer.close();await rm(root,{recursive:true,force:true});}
});

it('rejects overlapping real roots on startup and never claims an unknown Chat directory', async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-roots-'));
  try {
    await mkdir(join(root,'projects'));
    await symlink(join(root,'projects'),join(root,'alias'));
    await expect(new Workspaces(join(root,'projects'),{chatRoot:join(root,'alias')}).list()).rejects.toThrow('separate');
    const ws=new Workspaces(join(root,'projects'));
    await mkdir(join(root,'chats','occupied'),{recursive:true});
    await writeFile(join(root,'chats','occupied','keep.txt'),'keep');
    await expect(ws.createChatConversation('occupied')).rejects.toThrow();
    expect(await ws.lookup('occupied')).toBeUndefined();
    const c=await ws.createChatConversation('gone');await rm(c.cwd,{recursive:true});
    await expect(ws.createChatConversation('gone')).rejects.toThrow('unavailable');
  }finally{await rm(root,{recursive:true,force:true});}
});

it('keeps proven legacy inbox references readable without granting another task access',async()=>{
  const {TransferServer}=await import('../src/host/transfer.js');
  const root=await mkdtemp(join(tmpdir(),'coffee-legacy-files-'));
  const ws=new Workspaces(join(root,'projects'));await ws.createChatConversation('old');await ws.createChatConversation('other');
  await mkdir(join(root,'.pi-coffee/inbox/old'),{recursive:true});await writeFile(join(root,'.pi-coffee/inbox/old','note.txt'),'legacy');
  const transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces:ws});await transfer.start();
  try{
    const base=`http://127.0.0.1:${transfer.address().port}/api/localsend/v2/workspace-download?`;
    const query=(id:string)=>new URLSearchParams({scope:id,token:transfer.issueToken(id),path:'.pi-coffee/inbox/old/note.txt'});
    expect(await (await fetch(base+query('old'))).text()).toBe('legacy');
    expect((await fetch(base+query('other'))).status).toBe(403);
  }finally{await transfer.close();await rm(root,{recursive:true,force:true});}
});
