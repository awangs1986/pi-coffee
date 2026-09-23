import { randomUUID } from "node:crypto";
import { ClaudeSession } from "./claude.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentSessionFactory, EngineAvailability } from "../agent-adapter.js";
import { PI_ONLY_ENGINES } from "../agent-adapter.js";
import type { Workspaces } from "../workspaces.js";
import { CodexSession } from "./codex.js";
import { NativeProcess, nativeEnvironment, type NativeCommand } from "./process.js";
const exec=promisify(execFile);
export interface NativeAgentOptions { pi:AgentSessionFactory;workspaces:Workspaces;codex?:NativeCommand;claude?:NativeCommand; }
/** Routes only by the durable Task binding; browser-provided native IDs are never accepted. */
export class NativeAgentFactory implements AgentSessionFactory {
  constructor(private options:NativeAgentOptions){}
  async engines():Promise<EngineAvailability[]> {
    return Promise.all(PI_ONLY_ENGINES.map(async original=>{
      const config=original.id==="pi"?undefined:this.options[original.id];
      if(!config)return {...original};
      let version:string;
      try {
        const result=await exec(config.command,[...(config.args??[]),"--version"],{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192});
        version=result.stdout.trim();
      } catch {return {...original,available:false,reason:"Native executable unavailable"};}
      const supported=original.id==="codex" ? /\b0\.154\.0\b/.test(version) : /\b2\.1\.280\b/.test(version);
      if(!supported)return {...original,version,available:false,reason:"Unsupported native CLI version; use the verified release"};
      try {
        const ready=await this.authentication(original.id as "codex"|"claude",config);
        return {...original,version,available:ready,authentication:ready?"configured" as const:"required" as const,reason:ready?undefined:"Native authentication required; configure this CLI on the User VM"};
      } catch {return {...original,version,available:false,authentication:"unknown" as const,reason:"Native authentication status unavailable; inspect this CLI on the User VM"};}
    }));
  }
  private async authentication(engine:"codex"|"claude",config:NativeCommand):Promise<boolean> {
    if(engine==="codex") {
      const probe=new NativeProcess(config,["app-server"],process.cwd());
      try {
        await probe.call("initialize",{clientInfo:{name:"pi_coffee_readiness",version:"0.1.0"}},5000);
        probe.send({method:"initialized"});
        const result=await probe.call("account/read",{refreshToken:false},5000);
        return result.requiresOpenaiAuth===false || Boolean(result.account);
      } finally {await probe.stop();}
    }
    const args=[...(config.args??[]),"auth","status","--json"];
    const result=await exec(config.command,args,{env:nativeEnvironment(config.env),timeout:5000,maxBuffer:8192}).catch(error=>{
      if(error.code===1 && error.stdout)return {stdout:String(error.stdout)};throw error;
    });
    return JSON.parse(result.stdout).loggedIn===true;
  }
  async create({sessionId}:{sessionId:string}) {
    const task=await this.options.workspaces.lookup(sessionId);
    if(!task && !(await this.options.pi.list()).some(s=>s.id===sessionId))throw new Error("Unknown Task; create a Task with an explicit Agent first");
    if(!task || (task.engine??"pi")==="pi")return this.options.pi.create({sessionId});
    const readiness=(await this.engines()).find(e=>e.id===task.engine);if(!readiness?.available)throw new Error(readiness?.reason??"Agent unavailable");
    const config=this.options[task.engine as "codex"|"claude"];if(!config)throw new Error("Agent not configured");
    const cwd=await this.options.workspaces.file(sessionId,"");
    if(task.nativeBinding?.state==="starting" && !task.nativeBinding.id)throw new Error("Native start was uncertain; inspect it before recovery. No prompt was replayed.");
    if(task.engine==="claude"){
      if(!task.nativeBinding)await this.options.workspaces.setNativeBinding(sessionId,{state:"prepared",requestedId:randomUUID()});
      const session=new ClaudeSession(config,cwd,task.nativeBinding!,binding=>this.options.workspaces.setNativeBinding(sessionId,binding));
      try{return await session.start();}catch(error){await session.stop();throw error;}
    }
    const nativeId=task.nativeBinding?.id;
    if(!nativeId)await this.options.workspaces.setNativeBinding(sessionId,{state:"starting"});
    const session=new CodexSession(config,cwd);
    try{return await session.start(nativeId,id=>this.options.workspaces.setNativeBinding(sessionId,{state:"bound",id}));}
    catch(error){await session.stop();throw error;}
  }
  async list() {
    const state=await this.options.workspaces.list();
    const native=state.conversations.filter(c=>c.engine && c.engine!=="pi");
    const ids=new Set(native.map(c=>c.id));
    return [...(await this.options.pi.list()).filter(c=>!ids.has(c.id)),...native.map(c=>({id:c.id,engine:c.engine,createdAt:c.createdAt,updatedAt:c.createdAt,messageCount:0,preview:c.engine==="codex"?"Codex Task":"Claude Code Task"}))];
  }
  async delete(id:string) {
    const task=await this.options.workspaces.lookup(id);
    if(task?.engine && task.engine!=="pi")throw new Error("Native history is retained; complete native cleanup is not supported");
    return this.options.pi.delete(id);
  }
}
