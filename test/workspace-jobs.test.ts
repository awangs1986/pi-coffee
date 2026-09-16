import { it,expect } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pendingNativeRuns } from '../src/subagents/workspace-jobs.js';
import { childProcesses } from '../src/subagents/admission.js';
it('treats accepted but not started/missing/paused native work as non-quiescent',()=>{
 const root=mkdtempSync(join(tmpdir(),'coffee-job-'));const dir=join(root,'job');mkdirSync(dir);
 const entries=[{type:'message',message:{role:'toolResult',details:{asyncId:'job',asyncDir:dir}}}];
 try {
  expect(pendingNativeRuns(entries)).toBe(1);
  for(const state of ['queued','running','paused','partial','unrecognized']){writeFileSync(join(dir,'status.json'),JSON.stringify({runId:'job',state}));expect(pendingNativeRuns(entries)).toBe(1);}
  writeFileSync(join(dir,'status.json'),JSON.stringify({runId:'job',state:'complete'}));expect(pendingNativeRuns(entries)).toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('checks process birth identity, including queued launchers; PID reuse is not active work',()=>{
 const root=mkdtempSync(join(tmpdir(),'coffee-process-'));const old=process.env.PI_COFFEE_SCHEDULER_DIR;process.env.PI_COFFEE_SCHEDULER_DIR=root;
 const dir=join(root,'sessions',createHash('sha256').update('root').digest('hex'),'processes');mkdirSync(dir,{recursive:true});
 const info=readFileSync('/proc/self/stat','utf8');const start=info.slice(info.lastIndexOf(')')+1).trim().split(/\s+/)[19];
 try{
  writeFileSync(join(dir,'child.json'),JSON.stringify({pid:process.pid,start}));expect(childProcesses('root')).toEqual({known:true,active:1});
  writeFileSync(join(dir,'child.json'),JSON.stringify({pid:process.pid,start:'other birth'}));expect(childProcesses('root')).toEqual({known:true,active:0});
  writeFileSync(join(dir,'child.json'),'invalid');expect(childProcesses('root').known).toBe(false);
 }finally{if(old===undefined)delete process.env.PI_COFFEE_SCHEDULER_DIR;else process.env.PI_COFFEE_SCHEDULER_DIR=old;rmSync(root,{recursive:true,force:true});}
});
