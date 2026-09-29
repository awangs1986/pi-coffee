import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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

describe.skipIf(process.platform !== 'linux')('real native subagents and official direct search (Linux User VM)', () => {
 it.each(['subagent', 'large-child', 'cancel', 'web', 'batch', 'background', 'work', 'override', 'chat-web', 'chat-no-subagent', 'web-multi', 'web-error'] as const)('honors harness policy for %s with native package discovery and execution', async (route) => {
  const chat = route.startsWith('chat-') || route === 'chat-web';
  const webRoute = route === 'web' || route.startsWith('web-') || route.endsWith('-web');
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-rpc-'));
  const agentDir = join(root, 'agent'); await mkdir(agentDir); await writeFile(join(agentDir,'web-search.json'),JSON.stringify({searchProvider:'serper',workflow:'none',maxInlineContentChars:4000}));
  let nativeRun: {asyncId:string;asyncDir:string} | undefined;
  let releaseChild!: () => void; const childGate = new Promise<void>(r => { releaseChild = r; });
  const requests: any[] = []; let searches = 0;
  const server = createServer(async (req, res) => {
   let text = ''; for await (const chunk of req) text += chunk;
   const input = JSON.parse(text || '{}');
   if (req.url === '/v1/search/serper') {
    searches++; if(route==='web-error'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({message:'fixture query rejected'}));return;} res.setHeader('content-type','application/json'); res.end(JSON.stringify({ organic: [{ title: 'Primary', link: 'https://example.com/primary', snippet: 'evidence '.repeat(6000)+'RAW_SEARCH_TAIL_NOT_FOR_PARENT' }] })); return;
   }
   requests.push(input);
   if (requests.length > 12) { res.writeHead(500); res.end('loop'); return; }
   const messages = input.messages ?? [];
   const hasResult = (name: string) => {
    const ids = messages.flatMap((m:any) => m.tool_calls ?? []).filter((t:any) => t.function?.name === name).map((t:any)=>t.id);
    return messages.some((m:any) => m.role === 'tool' && (m.name === name || ids.includes(m.tool_call_id)));
   };
   if (input.model === 'child') {
    if(route === 'cancel') await childGate;
    if (hasResult('web_search')) {completion(res, input.model, undefined, route === 'large-child' ? 'native evidence '.repeat(4000)+'NATIVE_CHILD_TAIL' : undefined);}
    else completion(res, input.model, { name: 'web_search', args: { query: 'capacity test'} }); // Explicit researcher uses the same official tool.
    return;
   }
   if (route === 'chat-no-subagent') {
    if (hasResult('subagents_enable')) completion(res, input.model);
    else completion(res, input.model, { name: 'subagents_enable', args: {} });
    return;
   }
   const finalTool = webRoute ? 'web_search' : 'subagent';
   if (hasResult(finalTool)) {
    if (route === 'cancel' && messages.flatMap((m:any)=>m.tool_calls??[]).filter((t:any)=>t.function?.name==='subagent').length === 1) {
      completion(res, input.model, {name:'subagent',args:{action:'stop',id:nativeRun?.asyncId}}); return;
    }
    if (route === 'background' && !hasResult('bg_wait')) completion(res, input.model, { name: 'bg_wait', args: { all: true, timeoutMs: 20000 } });
    else completion(res, input.model);
    return;
   }
   if (!input.tools?.some((t: any) => t.function?.name === finalTool)) {
    completion(res, input.model, webRoute ? { name: 'search_tools', args: { action: 'activate', capability_id: 'web' } } : { name: 'subagents_enable', args: {} }); return;
   }
   completion(res, input.model, { name: finalTool, args: webRoute ? (route==='web-multi'?{queries:['capacity one','capacity two']}:{ query: 'capacity test' }) : route === 'batch' ? { workflowScript: `return await runs.all([1,2].map(i => ({ key: 'child-'+i, agent: 'coffee-research', task: 'Search capacity test '+i, model: 'localtest/child' })));`, async: false } : { ...(route === 'large-child' ? {maxOutput:{bytes:2400,lines:40}} : {}), context: 'fresh', agent: 'coffee-research', task: 'Search capacity test and cite a primary source', async: route.startsWith('background') || route === 'cancel', ...(route === 'override' ? { model: 'localtest/child' } : {}) } });
  });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const port = (server.address() as {port:number}).port;
  await writeFile(join(agentDir,'models.json'), JSON.stringify({ providers: { localtest: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-test-placeholder', models: ['parent','child'].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 })) } } }));
  await mkdir(join(agentDir,'agents'));
  await writeFile(join(agentDir,'agents','coffee-research.md'), `---\nname: coffee-research\ndescription: Isolated native-package research fixture\ntools: web_search, read\nextensions:\n  - ${resolve('node_modules/pi-web-access/index.ts')}\ndefaultContext: fresh\n---\nSearch once and return a short source citation.\n`);
  await writeFile(join(agentDir,'settings.json'), JSON.stringify({ packages: [dirname(createRequire(import.meta.url).resolve('pi-subagents'))], subagents: { defaultModel: route === 'override' ? 'localtest/unused' : 'localtest/child' }, compaction: { enabled: false } }));
  const sourceRoot = resolve("src");
  const buildRoot = resolve("dist/src");
  const extensions = resolvePiExtensions({ PI_COFFEE_AGENT_DIR: agentDir }).map((path) => {
    const local = relative(sourceRoot, path);
    return local.startsWith('..') ? path : resolve(buildRoot, local);
  });
  const client = new RpcClient({ cliPath: resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), cwd: root, provider: 'localtest', model: 'parent',
   env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SUBAGENTS_TEMP_ROOT: join(root,'native-temp'), SERPER_API_KEY: 'fixture-only', PI_COFFEE_SERPER_FIXTURE_URL: `http://127.0.0.1:${port}/v1/search/serper`, NODE_OPTIONS: `--import ${resolve('test/fixtures/serper-preload.mjs')}`, PI_SUBAGENT_PI_BINARY: '' },
   args: ['--offline', '--session-dir', join(root,'sessions'), ...extensions.flatMap(p => ['--extension',p])],
  });
  let events: unknown[] = [];
  try {
   await client.start();
   if (!chat) await client.prompt('/harness work');
   else { await client.prompt('/harness work'); await client.prompt(route === 'chat-web' ? '/harness chat' : '/harness chat'); }
   let notify!: () => void;
   let timer: ReturnType<typeof setTimeout> | undefined;
   const notified = route.startsWith('background') ? new Promise<void>((resolve, reject) => {
    notify = resolve;
    timer = setTimeout(() => reject(new Error('No native background completion')), 30000);
   }) : Promise.resolve();
   const off = client.onEvent((event: any) => {
    if (event.type === 'tool_execution_end' && event.toolName === 'subagent' && event.result?.details?.asyncId) nativeRun=event.result.details;
    if (event.type === 'message_end' && event.message?.customType === 'subagent-notify') notify?.();
   });
   events = await client.promptAndWait(`Use ${route} for capacity research`, undefined, 45000);
   try { await notified; } finally { clearTimeout(timer); off(); }
   await writeFile(join(root,'events.json'),JSON.stringify(events));
   if (route === 'cancel') {
    expect(nativeRun?.asyncId).toBeTruthy();
    await expect.poll(async()=>JSON.parse(await readFile(join(nativeRun!.asyncDir,'status.json'),'utf8')).state,{timeout:10000}).toBe('stopped');
    return;
   }
   if (route === 'chat-no-subagent') {
    expect(searches).toBe(0);
    expect(requests.every(r => r.model === 'parent')).toBe(true);
    expect(requests.every(r => !r.tools.some((t:any) => ['subagent','subagents_enable','bg_wait','subagent_supervisor'].includes(t.function.name)))).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Activated subagent;');
    return;
   }
   expect(JSON.stringify(events), `events: ${JSON.stringify(events).slice(-4000)}`).not.toContain('Activation failed');
   expect(searches, `events: ${JSON.stringify(events).slice(-5000)}`).toBe(route === 'batch' || route === 'web-multi' ? 2 : 1);
   if(route==='web-error')expect(JSON.stringify(events)).toMatch(/400|fixture query rejected/);
   expect(requests[0].tools.map((t:any)=>t.function.name)).toHaveLength(chat ? 5 : 10);
   const entries=JSON.stringify((await client.getEntries()).entries.filter((e:any)=>e.type==='message' && e.message?.role==='toolResult'));
   expect(entries).not.toContain('RAW_SEARCH_TAIL_NOT_FOR_PARENT');
   if (chat || webRoute) {
    if(chat) expect(requests.every(r => !r.messages.some((m:any) => ['system','developer'].includes(m.role)))).toBe(true);
    expect(requests.every(r => r.model === 'parent')).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('RAW_SEARCH_TAIL_NOT_FOR_PARENT');
    return;
   }
   if (route === 'large-child') {
    expect(JSON.stringify(requests.filter(r => r.model === 'parent'))).not.toContain('NATIVE_CHILD_TAIL');
    const results=(await client.getEntries()).entries.filter((e:any)=>e.type==='message' && e.message?.role==='toolResult' && e.message.toolName==='subagent');
    const text=results.flatMap((e:any)=>e.message.content).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
    const artifact=text.match(/full output at ([^\]\n]+)\]/)?.[1];
    expect(artifact, text).toBeTruthy();
    expect(await readFile(artifact!, 'utf8')).toContain('NATIVE_CHILD_TAIL');
   }
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
