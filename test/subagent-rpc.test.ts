import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { resolvePiExtensions } from "../src/pi-extensions.js";

function completion(res: any, model: string, tool?: { name: string; args: unknown }, text = "Completed with source https://example.com/primary") {
 res.writeHead(200, { 'content-type': 'text/event-stream' });
 const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${Math.random().toString(16).slice(2)}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: 'assistant', content: text };
 res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
 res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
 res.end('data: [DONE]\n\n');
}

describe('real native subagents and delegated search', () => {
 it.each(['subagent', 'web', 'batch', 'background', 'background-guard', 'full', 'override', 'simple-web', 'lean-web', 'simple-no-subagent'] as const)('honors harness policy for %s with real native execution and bounded results', async (route) => {
  const simple = route.startsWith('simple-') || route === 'lean-web';
  const webRoute = route === 'web' || route.endsWith('-web');
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-rpc-'));
  const agentDir = join(root, 'agent'); await mkdir(agentDir);
  let releaseChild!:()=>void;const childGate=new Promise<void>(r=>{releaseChild=r;});
  const requests: any[] = []; let searches = 0; let heldPermits = 0;
  const server = createServer(async (req, res) => {
   let text = ''; for await (const chunk of req) text += chunk;
   const input = JSON.parse(text || '{}');
   if (req.url === '/v1/search/serper') {
    searches++; res.setHeader('content-type','application/json'); res.end(JSON.stringify({ responseId: 'real-search', queries: ['capacity test'], results: [{ title: 'Primary', url: 'https://example.com/primary', snippet: 'evidence '.repeat(70)+'RAW_SEARCH_TAIL_NOT_FOR_PARENT' }] })); return;
   }
   requests.push(input);
   if (requests.length > 12) { res.writeHead(500); res.end('loop'); return; }
   const messages = input.messages ?? [];
   const hasResult = (name: string) => {
    const ids = messages.flatMap((m:any) => m.tool_calls ?? []).filter((t:any) => t.function?.name === name).map((t:any)=>t.id);
    return messages.some((m:any) => m.role === 'tool' && (m.name === name || ids.includes(m.tool_call_id)));
   };
   if (input.model === 'child') {
    const probe = spawnSync('python3', ['-c', `import fcntl,glob
n=0
for p in glob.glob(${JSON.stringify(join(root,'admission','vm','*'))}):
 f=open(p)
 try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError: n+=1
 f.close()
print(n)`], {encoding:'utf8'});
    heldPermits = Math.max(heldPermits, Number(probe.stdout.trim()));
    if (hasResult('web_search')) {if(route==='background-guard')await childGate;completion(res, input.model);}
    else completion(res, input.model, { name: 'web_search', args: { query: 'capacity test', delegate: true } }); // nested delegation must become a direct child search
    return;
   }
   if (route === 'simple-no-subagent') {
    if (hasResult('search_tools')) completion(res, input.model);
    else completion(res, input.model, { name: 'search_tools', args: { action: 'activate', capability_id: 'subagent' } });
    return;
   }
   const finalTool = webRoute ? 'web_search' : 'subagent';
   if (hasResult(finalTool)) {
    if (route === 'background' && !hasResult('bg_wait')) completion(res, input.model, { name: 'bg_wait', args: { all: true, timeoutMs: 20000 } });
    else completion(res, input.model);
    return;
   }
   if (!input.tools?.some((t: any) => t.function?.name === finalTool)) {
    completion(res, input.model, { name: 'search_tools', args: { action: 'activate', capability_id: webRoute ? 'web' : 'subagent' } }); return;
   }
   completion(res, input.model, { name: finalTool, args: webRoute ? { query: 'capacity test', ...(simple ? { delegate: true } : {}) } : route === 'batch' ? { tasks: [1,2].map(i => ({ agent: 'coffee-research', task: `Search capacity test ${i} and cite a primary source` })), async: false } : { agent: 'coffee-research', task: 'Search capacity test and cite a primary source', async: route.startsWith('background'), ...(route === 'override' ? { model: 'localtest/child' } : {}) } });
  });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const port = (server.address() as {port:number}).port;
  await writeFile(join(agentDir,'models.json'), JSON.stringify({ providers: { localtest: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-test-placeholder', models: ['parent','child'].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 })) } } }));
  await writeFile(join(agentDir,'settings.json'), JSON.stringify({ subagents: { defaultModel: route === 'override' ? 'localtest/unused' : 'localtest/child' }, compaction: { enabled: false } }));
  const extensions = resolvePiExtensions({ PI_COFFEE_AGENT_DIR: agentDir }).map(p => p.replace(resolve("src")+"/", resolve("dist/src")+"/"));
  const client = new RpcClient({ cliPath: resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), cwd: root, provider: 'localtest', model: 'parent',
   env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SUBAGENTS_TEMP_ROOT: join(root,'native-temp'), PI_COFFEE_SEARCH_URL: `http://127.0.0.1:${port}`, PI_COFFEE_SCHEDULER_DIR: join(root,'admission') },
   args: ['--offline', '--session-dir', join(root,'sessions'), ...extensions.flatMap(p => ['--extension',p])],
  });
  let events: unknown[] = [];
  try {
   await client.start();
   if (!simple) await client.prompt('/harness full');
   else { await client.prompt('/harness full'); await client.prompt(route === 'lean-web' ? '/harness lean' : '/harness simple'); }
   let notify!: () => void;
   let timer: ReturnType<typeof setTimeout> | undefined;
   const notified = route.startsWith('background') ? new Promise<void>((resolve, reject) => {
    notify = resolve;
    timer = setTimeout(() => reject(new Error('No native background completion')), 30000);
   }) : Promise.resolve();
   const off = client.onEvent((event: any) => {
    if (event.type === 'message_end' && event.message?.customType === 'subagent-notify') notify?.();
   });
   events = await client.promptAndWait(`Use ${route} for capacity research`, undefined, 45000);
   if(route==='background-guard') {
    const nonce='00000000-0000-0000-0000-000000000001';
    await client.prompt(`/coffee-workspace-jobs ${nonce}`);
    const snapshot=(await client.getEntries()).entries.filter(e=>e.type==='custom' && e.customType==='coffee-workspace-jobs').at(-1) as any;
    expect(snapshot.data.known).toBe(true);expect(snapshot.data.active).toBeGreaterThan(0);
    releaseChild();
   }
   try { await notified; } finally { clearTimeout(timer); off(); }
   await writeFile(join(root,'events.json'),JSON.stringify(events));
   if (route === 'simple-no-subagent') {
    expect(searches).toBe(0);
    expect(requests.every(r => r.model === 'parent')).toBe(true);
    expect(requests.every(r => !r.tools.some((t:any) => ['subagent','bg_wait'].includes(t.function.name)))).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Activated subagent;');
    return;
   }
   expect(JSON.stringify(events), `events: ${JSON.stringify(events).slice(-4000)}`).not.toContain('Activation failed');
   expect(searches, `events: ${JSON.stringify(events).slice(-5000)}`).toBe(route === 'batch' ? 2 : 1);
   expect(requests[0].tools.map((t:any)=>t.function.name)).toHaveLength(simple ? 9 : 11);
   if (simple) {
    expect(heldPermits).toBe(0);
    expect(requests.every(r => r.model === 'parent')).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('RAW_SEARCH_TAIL_NOT_FOR_PARENT');
    return;
   }
   expect(heldPermits).toBeGreaterThanOrEqual(1); // Real Pi has not closed the admission descriptors.
   expect(heldPermits).toBeLessThanOrEqual(3);
   expect(requests.some(r => r.model === 'child')).toBe(true);
   expect(JSON.stringify(requests.filter(r => r.model === 'parent'))).not.toContain('RAW_SEARCH_TAIL_NOT_FOR_PARENT');
   expect(requests.filter(r => r.model === 'child')[0].tools.map((t:any)=>t.function.name)).toContain('web_search');
   expect(requests.filter(r => r.model === 'child')[0].tools.map((t:any)=>t.function.name)).not.toContain('subagent');
  } finally {
   releaseChild();

   await client.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(()=>r())); await rm(root,{recursive:true,force:true});
  }
 },60000);
});
