import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,rm,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../src/host/workspaces.js';
import { TransferServer } from '../src/host/transfer.js';
describe('workspace file authorization',()=>{
 it('requires a scoped grant, rejects symlink/other workspace and sandboxes SVG previews',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-files-'));const ws=new Workspaces(join(root,'projects'));const p=await ws.createProject('demo');const a=await ws.createConversation(p.id),b=await ws.createConversation(p.id);
  const transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces:ws,allowUnscoped:false});await transfer.start();const base=`http://127.0.0.1:${transfer.address().port}/api/localsend/v2/`;
  try {
   expect((await fetch(base+'prepare-download')).status).toBe(401);
   expect((await fetch(base+'prepare-upload',{method:'POST',body:'{}'})).status).toBe(401);
   const token=transfer.issueToken(a.id);const params=new URLSearchParams({scope:a.id,token});
   await writeFile(join(a.cwd,'drawing.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
   await symlink('/etc',join(a.cwd,'escape'));
   const tree=await fetch(base+'tree?'+params);expect(tree.status).toBe(200);expect((await tree.json()).entries.map((e:any)=>e.name)).not.toContain('escape');
   const svg=await fetch(base+'preview?'+params+'&path=drawing.svg');expect(svg.status).toBe(200);expect(svg.headers.get('content-type')).toBe('image/svg+xml');expect(svg.headers.get('content-security-policy')).toContain('sandbox');
   expect((await fetch(base+'preview?'+params+'&path=escape/passwd')).status).toBe(403);
   expect((await fetch(base+'tree?'+new URLSearchParams({scope:b.id,token}))).status).toBe(401);
   transfer.revokeAll();expect((await fetch(base+'tree?'+params)).status).toBe(401);
  }finally{await transfer.close();await rm(root,{recursive:true,force:true});}
 });
});
