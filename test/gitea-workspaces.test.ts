import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Workspaces } from "../src/host/workspaces.js";
import type { CodeForge, Project } from "../src/host/workspaces.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd });

async function remoteRepository(root: string) {
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await writeFile(join(source, "README.md"), "base\n");
  await git(source, ["add", "README.md"]);
  await git(source, ["commit", "-m", "base"]);
  await git(root, ["clone", "--bare", source, remote]);
  return remote;
}

describe("Gitea-backed Conversation Checkouts", () => {
  it("gives each Conversation an independent clone and exclusive branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-checkouts-"));
    try {
      const remote = await remoteRepository(root);
      const workspaces = new Workspaces(join(root, "workspaces"), { ownerId: "vm-a" });
      const project = await workspaces.registerProject("demo", remote);
      const first = await workspaces.createConversation(project.id, "main", "conversation-a");
      const second = await workspaces.createConversation(project.id, "main", "conversation-b");

      expect((await stat(join(first.cwd, ".git"))).isDirectory()).toBe(true);
      expect((await stat(join(second.cwd, ".git"))).isDirectory()).toBe(true);
      expect(first.cwd).not.toBe(second.cwd);
      expect(first.branch).toBe("coffee/vm-a/conversation-a");
      expect(second.branch).toBe("coffee/vm-a/conversation-b");
      expect(first.startSha).toMatch(/^[0-9a-f]{40}$/);
      expect(second.startSha).toBe(first.startSha);
      expect(await readFile(join(first.cwd, "README.md"), "utf8")).toBe("base\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to reuse a Conversation branch that already exists remotely", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-branch-collision-"));
    try {
      const remote = await remoteRepository(root);
      const first = new Workspaces(join(root, "vm-a"), { ownerId: "same-vm" });
      const firstProject = await first.registerProject("demo", remote);
      await first.createConversation(firstProject.id, "main", "same-conversation");
      const second = new Workspaces(join(root, "vm-b"), { ownerId: "same-vm" });
      const secondProject = await second.registerProject("demo", remote);
      await expect(second.createConversation(secondProject.id, "main", "same-conversation")).rejects.toThrow("already exists");
      await expect(stat(join(root, "vm-b", "checkouts", "same-conversation"))).rejects.toThrow();

      const protectedPath=join(root,"vm-b","checkouts","preexisting");await mkdir(protectedPath,{recursive:true});await writeFile(join(protectedPath,"keep.txt"),"keep\n");
      await expect(second.createConversation(secondProject.id,"main","preexisting")).rejects.toThrow("destination already exists");
      expect(await readFile(join(protectedPath,"keep.txt"),"utf8")).toBe("keep\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checkpoints selected code, verifies the remote SHA, and keeps private files local", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-checkpoint-"));
    try {
      const remote = await remoteRepository(root);
      const workspaces = new Workspaces(join(root, "workspaces"), { ownerId: "vm-a" });
      const project = await workspaces.registerProject("demo", remote);
      const conversation = await workspaces.createConversation(project.id, "main", "conversation-a");
      await git(conversation.cwd, ["config", "user.name", "Test"]);
      await git(conversation.cwd, ["config", "user.email", "test@localhost"]);
      await writeFile(join(conversation.cwd, "README.md"), "checkpoint\n");
      await writeFile(join(conversation.cwd, ".env"), "SECRET=local\n");

      const checkpoint = await workspaces.checkpoint(conversation.id, ["README.md"], "checkpoint: implementation");
      expect(checkpoint.state).toBe("synced");
      expect(checkpoint.remoteSha).toBe(checkpoint.localSha);
      expect(checkpoint.dirty).toBe(true);
      expect((await git(conversation.cwd, ["status", "--porcelain"])).stdout).toContain("?? .env");
      expect((await git(root, ["--git-dir", remote, "show", `${conversation.branch}:README.md`])).stdout).toBe("checkpoint\n");
      const review=await workspaces.changes(conversation.id);expect(review.files.map(file=>file.path)).toContain("README.md");expect(review.checkpointPaths).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries a normal push for an existing local checkpoint without rewriting history", async()=>{
    const root=await mkdtemp(join(tmpdir(),"coffee-sync-"));try{
      const remote=await remoteRepository(root),workspaces=new Workspaces(join(root,"workspaces"),{ownerId:"vm-a"}),project=await workspaces.registerProject("demo",remote),conversation=await workspaces.createConversation(project.id,"main","conversation-a");
      await writeFile(join(conversation.cwd,"local.txt"),"local\n");await git(conversation.cwd,["add","local.txt"]);await git(conversation.cwd,["commit","-m","local checkpoint"]);
      expect((await workspaces.syncStatus(conversation.id)).state).toBe("ahead");
      const synced=await workspaces.pushCheckpoint(conversation.id);expect(synced.state).toBe("synced");expect(synced.remoteSha).toBe(synced.localSha);
    }finally{await rm(root,{recursive:true,force:true});}
  });

  it("treats an uncertain push as successful only after the remote confirms the exact SHA", async()=>{
    const root=await mkdtemp(join(tmpdir(),"coffee-uncertain-push-"));try{
      const remote=await remoteRepository(root),workspaces=new Workspaces(join(root,"workspaces"),{ownerId:"vm-a"}),project=await workspaces.registerProject("demo",remote),conversation=await workspaces.createConversation(project.id,"main","conversation-a");
      await git(conversation.cwd,["config","user.name","Test"]);await git(conversation.cwd,["config","user.email","test@localhost"]);await writeFile(join(conversation.cwd,"uncertain.txt"),"confirmed remotely\n");
      const target=workspaces as unknown as {git:(cwd:string,args:string[],maxBuffer?:number)=>Promise<string>};const original=target.git.bind(workspaces);let simulated=false;
      target.git=async(cwd,args,maxBuffer)=>{const result=await original(cwd,args,maxBuffer);if(!simulated && args[0]==="push"){simulated=true;throw new Error("simulated connection loss after receive");}return result;};
      const checkpoint=await workspaces.checkpoint(conversation.id,["uncertain.txt"],"checkpoint: uncertain push");
      expect(simulated).toBe(true);expect(checkpoint.state).toBe("synced");expect(checkpoint.remoteSha).toBe(checkpoint.localSha);
    }finally{await rm(root,{recursive:true,force:true});}
  });

  it("creates and migrates Projects through the forge adapter and surfaces discovery failures",async()=>{
    const root=await mkdtemp(join(tmpdir(),"coffee-project-forge-"));
    const authorKeys=["GIT_AUTHOR_NAME","GIT_AUTHOR_EMAIL","GIT_COMMITTER_NAME","GIT_COMMITTER_EMAIL"] as const;
    const previous=Object.fromEntries(authorKeys.map(key=>[key,process.env[key]]));
    Object.assign(process.env,{GIT_AUTHOR_NAME:"Test",GIT_AUTHOR_EMAIL:"test@localhost",GIT_COMMITTER_NAME:"Test",GIT_COMMITTER_EMAIL:"test@localhost"});
    try {
      const createdRemote=join(root,"created.git"),migratedRemote=await remoteRepository(join(root,"migrated-root").replace(/\/migrated-root$/,''));
      class FakeForge implements CodeForge {
        async createRepository(name:string) {await git(root,["init","--bare",createdRemote]);return {repoId:"created-id",name,repoUrl:createdRemote,webUrl:"http://gitea/demo",branch:"main"};}
        async migrateRepository(name:string) {return {repoId:"migrated-id",name,repoUrl:migratedRemote,webUrl:"http://gitea/migrated",branch:"main"};}
        async createPullRequest(){throw new Error("unused");}
      }
      const workspaces=new Workspaces(join(root,"store"),{ownerId:"vm-a",forge:new FakeForge()});
      const created=await workspaces.createProject("created");expect(created.repoId).toBe("created-id");expect((await git(root,["--git-dir",createdRemote,"rev-parse","refs/heads/main"])).stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
      const migrated=await workspaces.createProject("migrated","https://example.invalid/source.git");expect(migrated.repoId).toBe("migrated-id");expect(migrated.repoUrl).toBe(migratedRemote);

      const local=join(root,"discover-me");await mkdir(local);await git(local,["init","-b","main"]);await writeFile(join(local,"README.md"),"local\n");await git(local,["add","."]);await git(local,["commit","-m","local"]);
      const failingForge:CodeForge={createRepository:async()=>{throw new Error("Gitea unavailable");},createPullRequest:async()=>{throw new Error("unused");}};
      await expect(new Workspaces(root,{ownerId:"vm-a",forge:failingForge}).discover()).rejects.toThrow("Gitea unavailable");
    }finally{
      for(const key of authorKeys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
      await rm(root,{recursive:true,force:true});
    }
  });

  it("creates one real pull request record and continues code on a new branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-continuation-"));
    class FakeForge implements CodeForge {
      calls = 0;
      async createPullRequest(_project: Project, source: string, target: string) {
        this.calls += 1;
        return { number: 7, url: "http://gitea/pr/7", state: "open", source, target };
      }
    }
    try {
      const remote = await remoteRepository(root);
      const forge = new FakeForge();
      const workspaces = new Workspaces(join(root, "workspaces"), { ownerId: "vm-a", forge });
      const project = await workspaces.registerProject("demo", remote);
      const source = await workspaces.createConversation(project.id, "main", "conversation-a");
      await git(source.cwd, ["config", "user.name", "Test"]);
      await git(source.cwd, ["config", "user.email", "test@localhost"]);
      await writeFile(join(source.cwd, "feature.txt"), "ready\n");
      const checkpoint = await workspaces.checkpoint(source.id, ["feature.txt"], "checkpoint: ready");
      expect(await workspaces.openPullRequest(source.id, "Ready")).toMatchObject({ number: 7, source: source.branch, target: "main" });
      expect(await workspaces.openPullRequest(source.id, "Retry")).toMatchObject({ number: 7 });
      expect(forge.calls).toBe(1);

      const next = await workspaces.continueFrom(project.id, source.branch, checkpoint.remoteSha!, "conversation-b");
      expect(next.branch).toBe("coffee/vm-a/conversation-b");
      expect(next.startSha).toBe(checkpoint.remoteSha);
      expect(await readFile(join(next.cwd, "feature.txt"), "utf8")).toBe("ready\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates a legacy worktree without deleting its dirty or private files", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-migration-"));
    try {
      const remote = await remoteRepository(root);
      const legacyProject = join(root, "legacy-project");
      await git(root, ["clone", remote, legacyProject]);
      const legacyCheckout = join(root, "legacy-checkout");
      await git(legacyProject, ["worktree", "add", "-b", "coffee/legacy", legacyCheckout, "main"]);
      await writeFile(join(legacyCheckout, "README.md"), "dirty\n");
      await writeFile(join(legacyCheckout, ".env"), "KEEP=1\n");
      const storeRoot = join(root, "store");
      await mkdir(join(storeRoot, ".coffee"), { recursive: true });
      await writeFile(join(storeRoot, ".coffee", "state.json"), JSON.stringify({ version: 1, projects: [{ id: "project", name: "demo", path: legacyProject, branch: "main" }], conversations: [{ id: "legacy", projectId: "project", cwd: legacyCheckout, branch: "coffee/legacy", archived: false, createdAt: new Date().toISOString() }] }));
      const workspaces = new Workspaces(storeRoot, { ownerId: "vm-a" });
      await workspaces.bindProjectRepository("project", remote);
      expect(await workspaces.migrationPlan("legacy")).toMatchObject({ required: true, dirty: true, remoteBound: true });

      const target=workspaces as unknown as {git:(cwd:string,args:string[],maxBuffer?:number)=>Promise<string>};const original=target.git.bind(workspaces);let interrupted=false;
      target.git=async(cwd,args,maxBuffer)=>{if(!interrupted && args.includes("clone")){interrupted=true;throw new Error("simulated migration interruption");}return original(cwd,args,maxBuffer);};
      await expect(workspaces.migrateConversation("legacy")).rejects.toThrow("simulated migration interruption");
      target.git=original;
      const migrated = await workspaces.migrateConversation("legacy");
      expect(interrupted).toBe(true);
      expect(migrated.cwd).not.toBe(legacyCheckout);
      expect(migrated.legacyCwd).toBe(legacyCheckout);
      expect(await readFile(join(migrated.cwd, "README.md"), "utf8")).toBe("dirty\n");
      expect(await readFile(join(migrated.cwd, ".env"), "utf8")).toBe("KEEP=1\n");
      expect(await readFile(join(legacyCheckout, ".env"), "utf8")).toBe("KEEP=1\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
