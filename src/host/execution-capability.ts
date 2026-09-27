import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ExecutionCapability {
  ownerUid:number;
  serviceUid:number;
  home:string;
  ownerEnvironment:boolean;
  passwordlessRoot:boolean;
}

type Runner=(command:string,args:string[])=>Promise<{stdout:string;stderr:string}>;

export async function inspectExecutionCapability(
  run:Runner=async(command,args)=>exec(command,args,{timeout:5000,env:{...process.env,SUDO_ASKPASS:'/bin/false'}}),
  expected:{uid?:number;home?:string}={uid:typeof process.getuid==='function' ? process.getuid() : 0,home:process.env.HOME ?? ''},
):Promise<ExecutionCapability> {
  const serviceUid=Number.parseInt((await run('id',['-u'])).stdout.trim(),10);
  const ownerUid=expected.uid ?? serviceUid;
  let passwordlessRoot=false;
  try {passwordlessRoot=(await run('sudo',['-n','id','-u'])).stdout.trim()==='0';} catch {passwordlessRoot=false;}
  const home=expected.home ?? '';
  return {ownerUid,serviceUid,home,ownerEnvironment:serviceUid===ownerUid && home.length>1,passwordlessRoot};
}
