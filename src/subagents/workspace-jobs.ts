import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Thin, read-only seam for pinned native async artifacts. No scheduling/cancellation engine.
 * Native capacity/fleet snapshots can be zero between acceptance and runner startup.
 * Durable tool-result references cover that interval and survive parent restarts.
 * Missing/unrecognized artifacts never count as proof of quiescence.
 */
export function pendingNativeRuns(entries: readonly unknown[]): number {
  const refs=new Map<string,string>();
  for(const entry of entries) {
    const e=entry as any;
    if(e?.type!=="message" || e.message?.role!=="toolResult")continue;
    const d=e.message.details;
    if(typeof d?.asyncId==="string" && typeof d.asyncDir==="string" && basename(d.asyncDir)===d.asyncId)refs.set(d.asyncId,d.asyncDir);
  }
  let pending=0;
  for(const [id,dir] of refs) {
    try {
      const status=JSON.parse(readFileSync(join(dir,"status.json"),"utf8"));
      if(status.runId!==id || !["complete","failed","stopped","rejected"].includes(status.state))pending++;
    }catch {pending++;}
  }
  return pending;
}
