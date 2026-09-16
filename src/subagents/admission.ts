import { createHash } from "node:crypto";
import { accessSync, constants, chmodSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One OS user per User VM. All its Host processes share the same kernel lock namespace. */
export function configureAdmission(env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "linux") throw new Error("Subagent admission requires the Linux User VM");
  const python = spawnSync("python3", ["-c", "import fcntl"], { timeout: 5000 });
  if (python.status !== 0) throw new Error("Subagent admission requires Python 3 with fcntl on the User VM");
  const root = env.PI_COFFEE_SCHEDULER_DIR || join("/tmp", `pi-coffee-subagents-${process.getuid!()}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const launcher = fileURLToPath(new URL("./launch.py", import.meta.url));
  accessSync(launcher, constants.X_OK);
  env.PI_COFFEE_SCHEDULER_DIR = root;
  env.PI_COFFEE_NODE = process.execPath;
  env.PI_COFFEE_PI_CLI = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")).replace(/\/index\.js$/, "/cli.js");
  env.PI_SUBAGENT_PI_BINARY = launcher;
}

/** Read-only process-identity probe, including launchers waiting for VM capacity. */
export function childProcesses(rootSession: string): { known: boolean; active: number } {
  const root = process.env.PI_COFFEE_SCHEDULER_DIR || join("/tmp", `pi-coffee-subagents-${process.getuid!()}`);
  const dir=join(root,"sessions",createHash("sha256").update(rootSession).digest("hex"),"processes");
  let active=0;
  try {
    for(const file of readdirSync(dir)) {
      const record=JSON.parse(readFileSync(join(dir,file),"utf8"));
      if(!Number.isSafeInteger(record.pid) || typeof record.start!=="string")return {known:false,active};
      try {
        const info=readFileSync(`/proc/${record.pid}/stat`,"utf8");
        const fields=info.slice(info.lastIndexOf(")")+1).trim().split(/\s+/);
        if(fields[19]===record.start && !["Z","X"].includes(fields[0]))active++;
      }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")return {known:false,active};}
    }
    return {known:true,active};
  }catch(e){return {known:(e as NodeJS.ErrnoException).code==="ENOENT",active};}
}
