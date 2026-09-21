import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Workspaces } from "../src/host/workspaces.js";

const exec=promisify(execFile);
const git=(cwd:string,args:string[])=>exec("git",["-c","user.name=Test","-c","user.email=test@localhost",...args],{cwd});

async function setup(prefix:string) {
  const root=await mkdtemp(join(tmpdir(),prefix));
  const source=join(root,"source"),remote=join(root,"remote.git");await mkdir(source);
  await git(source,["init","-b","main"]);await writeFile(join(source,"README.md"),"base\n");await git(source,["add","."]);await git(source,["commit","-m","base"]);await git(root,["clone","--bare",source,remote]);
  const store=new Workspaces(join(root,"store"),{ownerId:"vm-a"});const project=await store.registerProject("demo",remote);const conversation=await store.createConversation(project.id,"main");
  return {root,store,conversation};
}

describe("Conversation Checkout boundaries",()=>{
  it("reviews committed, dirty and untracked files against the fetched target without exposing private files",async()=>{
    const value=await setup("coffee-review-");try{
      await writeFile(join(value.conversation.cwd,"notes.txt"),"hello review");await writeFile(join(value.conversation.cwd,".env"),"PRIVATE=1");
      let review=await value.store.changes(value.conversation.id);expect(review.files.map(file=>file.path)).toContain("notes.txt");expect(review.checkpointPaths).toEqual(["notes.txt"]);expect(review.patch).toContain("+hello review");expect(review.patch).not.toContain("PRIVATE=1");expect(review.stale).toBe(false);
      await writeFile(join(value.conversation.cwd,"tracked.txt"),"clean\n");await git(value.conversation.cwd,["add","tracked.txt"]);await git(value.conversation.cwd,["commit","-m","tracked"]);await writeFile(join(value.conversation.cwd,"tracked.txt"),"trail  \n");
      review=await value.store.changes(value.conversation.id);expect(review.checks[0].ok).toBe(false);expect(review.checks[0].output).toContain("trailing whitespace");
    }finally{await rm(value.root,{recursive:true,force:true});}
  });

  it("keeps path escape and Git metadata outside the browser file API",async()=>{
    const value=await setup("coffee-path-");try{
      const outside=join(value.root,"outside");await mkdir(outside);await writeFile(join(outside,"secret"),"x");await symlink(outside,join(value.conversation.cwd,"escape"),process.platform==="win32"?"junction":"dir");
      await expect(value.store.file(value.conversation.id,"escape/secret")).rejects.toThrow("outside");await expect(value.store.file(value.conversation.id,".git")).rejects.toThrow("Git internals");
    }finally{await rm(value.root,{recursive:true,force:true});}
  });

  it("marks unfinished work interrupted after Host reconstruction and does not replay it",async()=>{
    const value=await setup("coffee-interrupted-");try{
      await value.store.markRun(value.conversation.id,"running");const restored=new Workspaces(join(value.root,"store"),{ownerId:"vm-a"});expect((await restored.lookup(value.conversation.id))?.runState).toBe("interrupted");
      await restored.archive(value.conversation.id,true);await expect(restored.markRun(value.conversation.id,"running")).rejects.toThrow("archived");
    }finally{await rm(value.root,{recursive:true,force:true});}
  });

  it("indexes generated artifacts and preserves unavailable references",async()=>{
    const value=await setup("coffee-artifacts-");try{
      await writeFile(join(value.conversation.cwd,"diagram.svg"),"<svg/>");await writeFile(join(value.conversation.cwd,".env"),"PRIVATE");expect((await value.store.artifacts(value.conversation.id)).map(file=>file.path)).toContain("diagram.svg");
      await rm(join(value.conversation.cwd,"diagram.svg"));expect((await value.store.artifacts(value.conversation.id))[0].available).toBe(false);expect((await new Workspaces(join(value.root,"store"),{ownerId:"vm-a"}).lookup(value.conversation.id))?.artifacts?.[0].available).toBe(false);
    }finally{await rm(value.root,{recursive:true,force:true});}
  });

  it("deletes only an archived, clean Checkout whose remote branch confirms the same SHA",async()=>{
    const value=await setup("coffee-delete-");try{
      await git(value.conversation.cwd,["config","user.name","Test"]);await git(value.conversation.cwd,["config","user.email","test@localhost"]);await writeFile(join(value.conversation.cwd,"ready.txt"),"ready\n");await value.store.checkpoint(value.conversation.id,["ready.txt"],"checkpoint: ready");
      await expect(value.store.deleteWorkspace(value.conversation.id,value.conversation.id)).rejects.toThrow("archived");await value.store.archive(value.conversation.id,true);expect((await value.store.deleteWorkspace(value.conversation.id,value.conversation.id)).retained).toContain("remote branch");expect(await value.store.lookup(value.conversation.id)).toBeUndefined();
    }finally{await rm(value.root,{recursive:true,force:true});}
  });
});
