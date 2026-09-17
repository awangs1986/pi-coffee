import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const launcher = resolve("src/subagents/launch.py");
function run(root: string, session: string, probe: string, extra = {}) {
  const child = spawn("python3", [launcher], { env: { ...process.env,
    PI_COFFEE_SCHEDULER_DIR: root, PI_COFFEE_ROOT_SESSION: session,
    PI_COFFEE_NODE: process.execPath, PI_COFFEE_PI_CLI: probe, PI_SUBAGENT_DEPTH: "1",
    ...extra,
  }, stdio: ["ignore", "pipe", "pipe"] });
  let error = ""; child.stderr.on("data", d => error += d);
  return { child, done: new Promise<number | null>((r, reject) => { child.on("error", reject); child.on("exit", code => r(code)); }), error: () => error };
}

describe.skipIf(process.platform !== "linux")("VM-wide native child admission on the Linux User VM", () => {
  it("enforces 3 per root session and 5 per VM across independent processes, queuing extras", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-admission-"));
    const probe = join(root, "probe.mjs");
    await writeFile(probe, `import {appendFileSync} from 'node:fs';
const p=process.env.PI_COFFEE_SCHEDULER_DIR+'/events'; const s=process.env.PI_COFFEE_ROOT_SESSION;
appendFileSync(p,JSON.stringify({phase:'start',s,pid:process.pid})+'\\n');
setTimeout(()=>{appendFileSync(p,JSON.stringify({phase:'end',s,pid:process.pid})+'\\n');},250);`);
    try {
      const runs = Array.from({ length: 14 }, (_, i) => run(root, i < 7 ? 'a' : 'b', probe));
      expect(await Promise.all(runs.map(r => r.done))).toEqual(Array(14).fill(0));
      const counts: Record<string, number> = { a: 0, b: 0 }; let total = 0, peak = 0;
      for (const event of (await readFile(join(root, 'events'), 'utf8')).trim().split('\n').map(x => JSON.parse(x))) {
        const delta = event.phase === 'start' ? 1 : -1;
        counts[event.s] += delta; total += delta; peak = Math.max(peak, total);
        expect(counts[event.s]).toBeLessThanOrEqual(3); expect(total).toBeLessThanOrEqual(5);
      }
      expect(peak).toBe(5); expect(total).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15000);

  it("releases permits on SIGKILL and rejects recursive children", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-admission-"));
    const probe = join(root, "probe.mjs");
    await writeFile(probe, `process.stdout.write('ready\\n');setInterval(()=>{},1000);`);
    const jobs: ReturnType<typeof run>[] = [];
    try {
      for (let i = 0; i < 3; i++) { const r = run(root, 'a', probe); jobs.push(r); await new Promise<void>(resolve => r.child.stdout.once('data', () => resolve())); }
      const fourth = run(root, 'a', probe); jobs.push(fourth);
      let started = false; const ready = new Promise<void>(resolve => fourth.child.stdout.once('data', () => { started = true; resolve(); }));
      await new Promise(r => setTimeout(r, 150)); expect(started).toBe(false);
      // Cancelling another queued launcher must not start it or release an active child's permit.
      const cancelled = run(root, 'a', probe); jobs.push(cancelled);
      let cancelledStarted = false; cancelled.child.stdout.once('data', () => { cancelledStarted = true; });
      await new Promise(r => setTimeout(r, 100)); cancelled.child.kill('SIGTERM'); await cancelled.done;
      expect(cancelledStarted).toBe(false);
      jobs[0].child.kill('SIGKILL'); await ready;
      const nested = run(root, 'a', probe, { PI_SUBAGENT_DEPTH: '2' });
      expect(await nested.done).not.toBe(0); expect(nested.error()).toContain('nested');
    } finally { for (const j of jobs) j.child.kill('SIGKILL'); await Promise.all(jobs.map(j => j.done)); await rm(root, { recursive: true, force: true }); }
  }, 15000);
});
