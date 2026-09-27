import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GiteaClient } from "../dist/src/host/gitea.js";
import { Workspaces } from "../dist/src/host/workspaces.js";

const baseUrl=process.env.PI_COFFEE_GITEA_URL,token=process.env.PI_COFFEE_GITEA_TOKEN,owner=process.env.PI_COFFEE_GITEA_OWNER;
if(!baseUrl || !token || !owner)throw new Error("PI_COFFEE_GITEA_URL, PI_COFFEE_GITEA_TOKEN and PI_COFFEE_GITEA_OWNER are required");
const root=await mkdtemp(join(tmpdir(),"pi-coffee-gitea-smoke-")),name=`pi-coffee-smoke-${Date.now()}`;
const askpass=join(root,"askpass.sh");await writeFile(askpass,'#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$PI_COFFEE_GITEA_OWNER";; *) printf "%s\\n" "$PI_COFFEE_GITEA_TOKEN";; esac\n');await chmod(askpass,0o700);
process.env.GIT_ASKPASS=askpass;process.env.GIT_TERMINAL_PROMPT="0";
process.env.GIT_AUTHOR_NAME="PI Coffee Smoke";process.env.GIT_AUTHOR_EMAIL="pi-coffee-smoke@localhost";
process.env.GIT_COMMITTER_NAME="PI Coffee Smoke";process.env.GIT_COMMITTER_EMAIL="pi-coffee-smoke@localhost";
const forge=new GiteaClient({baseUrl,token,owner});
try {
  const first=new Workspaces(join(root,"vm-a"),{ownerId:"vm-a",forge}),project=await first.createProject(name),conversation=await first.createConversation(project.id,"main","conversation-a");
  await writeFile(join(conversation.cwd,"probe.txt"),"real Gitea checkpoint\n");
  const checkpoint=await first.checkpoint(conversation.id,["probe.txt"],"checkpoint: real Gitea smoke");
  const pull=await first.openPullRequest(conversation.id,"PI Coffee real Gitea smoke");
  const second=new Workspaces(join(root,"vm-b"),{ownerId:"vm-b",forge}),registered=await second.registerProject(name,project.repoUrl,project.branch,project.repoId,project.webUrl),continued=await second.continueFrom(registered.id,conversation.branch,checkpoint.remoteSha,"conversation-b");
  if(await readFile(join(continued.cwd,"probe.txt"),"utf8")!=="real Gitea checkpoint\n")throw new Error("continued Checkout lost the checkpoint");
  console.log(JSON.stringify({ok:true,repository:project.webUrl,sourceBranch:conversation.branch,continuationBranch:continued.branch,checkpoint:checkpoint.remoteSha,pullRequest:pull.url},null,2));
} finally {
  await fetch(new URL(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,baseUrl),{method:"DELETE",headers:{authorization:`token ${token}`}}).catch(()=>undefined);
  await rm(root,{recursive:true,force:true});
}
