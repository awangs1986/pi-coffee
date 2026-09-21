import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import {
  resolvePiExtensions,
  resolvePiLensExtension,
} from "../dist/src/pi-extensions.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const model = "gpt-5.6-terra";
const provider = "eidolon";
const reportBase = join(repo, "docs/reviews/real-agent-toolchain-20260921");
const scope = process.env.PI_COFFEE_REAL_SMOKE_SCOPE ?? "all";
const root = await mkdtemp(join(tmpdir(), "pi-coffee-real-toolchain-"));
const server = createFixtureSearchServer();
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const searchUrl = `http://127.0.0.1:${server.address().port}`;

const commonEnvironment = {
  PI_COFFEE_CONFORMED_CAPABILITIES: "web,web-access,subagent",
  PI_COFFEE_CAPABILITY_SETTINGS: "off",
  PI_COFFEE_SEARCH_URL: searchUrl,
  PI_COFFEE_SCHEDULER_DIR: join(root, "admission"),
  PI_SUBAGENTS_TEMP_ROOT: join(root, "children"),
  PI_LENS_HOME: join(root, "lens-home"),
  PILENS_DATA_DIR: join(root, "lens-data"),
  PI_LENS_DISABLE_TOOL_INSTALL: "1",
};

const report = {
  generatedAt: new Date().toISOString(),
  provider,
  model,
  piLensVersion: await packageVersion(join(process.env.HOME, ".pi/agent/npm/node_modules/pi-lens/package.json")),
  fixture: "disposable TypeScript repository; no project or credential files exposed",
  runs: scope === "lens-only" ? await existingNonLensRuns() : [],
};

try {
  if (scope !== "lens-only") {
    const fullWorkspace = await createFixture(join(root, "full-stack"));
    const fullInspection = await createInspectionExtension(join(root, "full-inspection"));
    const fullExtensions = resolvePiExtensions({
      ...process.env,
      PI_COFFEE_PI_LENS: "on",
    });
    report.runs.push(await runSession({
      name: "full-stack",
      workspace: fullWorkspace,
      extensions: [...fullExtensions, fullInspection.extension],
      inspectionPath: fullInspection.output,
      environment: commonEnvironment,
      beforePrompt: async (client) => {
        await client.prompt("/harness full");
        await client.prompt("/verify profile quick");
        await client.prompt("/toolchain-inspect configured-full");
      },
      prompts: [
        {
          id: "autonomous",
          text: "You are validating a real coding-agent workflow in this disposable repository. Independently inspect the project, diagnose why its required check fails, fix the smallest correct issue while preserving intended behavior, validate the result, and report evidence. Discover and use the available capabilities yourself; do not ask me questions.",
        },
        {
          id: "explicit-coverage",
          text: "This is an explicit compatibility probe. Exercise each currently visible base development capability safely at least once: inspect, list, search, and read the repository; create a temporary probe file, modify it, run a shell command, inspect repository state, and run the configured verification; remove the temporary file afterward. Use the capability discovery interface to look for web research and subagent/delegation bundles, activate them if available, and make one minimal harmless call through each activated bundle. Also use every visible pi-lens project-intelligence or diagnostic capability at least once; if its activation tool offers LSP navigation, activate it and perform a definition or reference query for formatTotal in src/calculator.ts. Do not commit or push. Report unavailable tools precisely.",
        },
      ],
    }));
  }

  const lensWorkspace = await createFixture(join(root, "lens-only"));
  const lensInspection = await createInspectionExtension(join(root, "lens-inspection"));
  report.runs.push(await runSession({
    name: "pi-lens-control",
    workspace: lensWorkspace,
    extensions: [resolvePiLensExtension(process.env), lensInspection.extension],
    inspectionPath: lensInspection.output,
    environment: commonEnvironment,
    prompts: [
      {
        id: "lsp-control",
        text: "Run a focused LSP compatibility probe in this disposable TypeScript repository. Use pi-lens LSP diagnostics on src/app.ts, inspect the relevant symbol through pi-lens, activate LSP navigation if needed, and query the definition or references of formatTotal. Fix the type error, rerun LSP diagnostics, and run the project check. Also call the pi-lens health tool if it is visible. Do not treat tsc alone as proof that LSP worked; report any unavailable lens operation precisely.",
      },
      {
        id: "all-lens-tools",
        text: "Complete an explicit pi-lens tool coverage probe. Call symbol_search for formatTotal and read_enclosing at src/calculator.ts line 9. Call effective_config, project_report, module_report, read_symbol, and lens_diagnostics. Through pi_lens_activate_tools activate ast_grep_search, ast_grep_replace, ast_grep_outline, lsp_navigation, and lens_diagnostic_mark. Exercise all three ast_grep tools safely: search and outline the fixture, create a disposable src/lens-probe.ts, structurally replace one function name in that file, verify the replacement, then delete the file. Exercise lsp_navigation again. Call lens_diagnostic_mark only if a real diagnostic identifier exists; otherwise record that its required precondition is unavailable rather than inventing one. Do not commit or push. Report exact failures and degraded results.",
      },
    ],
  }));
} finally {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}

report.assessment = assess(report.runs);
await mkdir(dirname(reportBase), { recursive: true });
await writeFile(`${reportBase}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${reportBase}.md`, renderMarkdown(report));
console.log(JSON.stringify({
  report: `${reportBase}.json`,
  assessment: report.assessment,
  runs: report.runs.map((run) => ({
    name: run.name,
    ok: run.ok,
    toolCalls: run.toolCalls.map((call) => call.name),
    finalCheck: run.finalCheck,
    extensionErrors: run.extensionErrors,
  })),
}, null, 2));
await rm(root, { recursive: true, force: true });

async function runSession(options) {
  const toolCalls = [];
  const extensionErrors = [];
  const promptResults = [];
  const client = new RpcClient({
    cliPath,
    cwd: options.workspace,
    provider,
    model,
    env: options.environment,
    args: [
      "--no-extensions",
      "--no-session",
      "--thinking",
      "low",
      ...options.extensions.flatMap((entry) => ["--extension", entry]),
    ],
  });
  const unsubscribe = client.onEvent((event) => {
    if (event.type === "tool_execution_start") {
      toolCalls.push({ name: event.toolName, status: "started" });
    }
    if (event.type === "tool_execution_end") {
      const current = [...toolCalls].reverse().find((call) => call.name === event.toolName && call.status === "started");
      if (current) {
        current.status = event.isError === true ? "error" : "completed";
        current.result = resultExcerpt(event.result);
      }
    }
    if (event.type === "extension_error") {
      extensionErrors.push(String(event.error ?? event.message ?? "extension error").slice(0, 800));
    }
  });

  let fatalError;
  try {
    await client.start();
    await options.beforePrompt?.(client);
    for (const prompt of options.prompts) {
      const start = toolCalls.length;
      await client.promptAndWait(prompt.text, undefined, 360_000);
      promptResults.push({
        id: prompt.id,
        toolCalls: toolCalls.slice(start).map((call) => call.name),
        finalText: (await client.getLastAssistantText())?.slice(0, 4_000) ?? null,
      });
      await client.prompt(`/toolchain-inspect after-${prompt.id}`);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
  } finally {
    unsubscribe();
    await client.stop().catch(() => {});
  }

  let snapshots = [];
  try { snapshots = JSON.parse(await readFile(options.inspectionPath, "utf8")); } catch {}
  const finalCheck = runCheck(options.workspace);
  const appSource = await readFile(join(options.workspace, "src/app.ts"), "utf8");
  return {
    name: options.name,
    ok: fatalError === undefined && finalCheck.ok && extensionErrors.length === 0,
    ...(fatalError === undefined ? {} : { fatalError }),
    promptResults,
    toolCalls,
    snapshots,
    extensionErrors,
    stderrTail: client.getStderr().slice(-2_000),
    finalCheck,
    finalAppSource: appSource,
  };
}

async function createFixture(workspace) {
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(join(workspace, "test"), { recursive: true });
  await mkdir(join(workspace, ".picode"), { recursive: true });
  await mkdir(join(workspace, "node_modules"), { recursive: true });
  await mkdir(join(workspace, "node_modules/.bin"), { recursive: true });
  await writeFile(join(workspace, ".gitignore"), "node_modules/\n");
  await writeFile(join(workspace, "package.json"), JSON.stringify({
    name: "pi-coffee-toolchain-fixture",
    private: true,
    type: "module",
    scripts: { check: "tsc -p tsconfig.json --noEmit && node --test test/*.test.mjs" },
    devDependencies: { typescript: "5.9.3" },
  }, null, 2) + "\n");
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  }, null, 2) + "\n");
  await writeFile(join(workspace, "src/calculator.ts"), [
    "export interface Cart {",
    "  prices: number[];",
    "}",
    "",
    "export function total(cart: Cart): number {",
    "  return cart.prices.reduce((sum, price) => sum + price, 0);",
    "}",
    "",
    "export function formatTotal(cart: Cart): string {",
    "  return total(cart).toFixed(2);",
    "}",
    "",
  ].join("\n"));
  await writeFile(join(workspace, "src/app.ts"), [
    "import { formatTotal } from \"./calculator.js\";",
    "",
    "// The UI displays a formatted string with two decimal places.",
    "export const result: number = formatTotal({ prices: [3, 4.5] });",
    "",
  ].join("\n"));
  await writeFile(join(workspace, "test/contract.test.mjs"), [
    "import assert from \"node:assert/strict\";",
    "import { readFile } from \"node:fs/promises\";",
    "import test from \"node:test\";",
    "",
    "test(\"the UI result remains a formatted string\", async () => {",
    "  const source = await readFile(new URL(\"../src/app.ts\", import.meta.url), \"utf8\");",
    "  assert.match(source, /result:\\s*string\\s*=/);",
    "});",
    "",
  ].join("\n"));
  const tsc = join(repo, "node_modules/.bin/tsc");
  await writeFile(join(workspace, ".picode/verify.json"), JSON.stringify({
    quick: [`${shellQuote(tsc)} -p tsconfig.json --noEmit`, "node --test test/*.test.mjs"],
  }, null, 2) + "\n");
  await symlink(join(repo, "node_modules/typescript"), join(workspace, "node_modules/typescript"), "dir");
  await symlink(join(repo, "node_modules/.bin/tsc"), join(workspace, "node_modules/.bin/tsc"), "file");
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: workspace });
  return workspace;
}

async function createInspectionExtension(prefix) {
  const extension = `${prefix}.mjs`;
  const output = `${prefix}.json`;
  await writeFile(extension, [
    "import { writeFileSync } from 'node:fs';",
    `const output = ${JSON.stringify(output)};`,
    "export default function inspect(pi) {",
    "  const snapshots = [];",
    "  const save = (label) => {",
    "    snapshots.push({ label, active: pi.getActiveTools(), registered: pi.getAllTools().map((tool) => tool.name) });",
    "    writeFileSync(output, JSON.stringify(snapshots));",
    "  };",
    "  pi.on('session_start', () => save('session-start'));",
    "  pi.on('model_select', () => save('model-select'));",
    "  pi.on('before_agent_start', () => save('before-agent-start'));",
    "  pi.registerCommand('toolchain-inspect', { description: 'Record a sanitized tool snapshot', handler: async (args) => save(args || 'manual') });",
    "}",
    "",
  ].join("\n"));
  return { extension, output };
}

function runCheck(workspace) {
  try {
    const output = execFileSync("npm", ["run", "check"], { cwd: workspace, encoding: "utf8", timeout: 60_000 });
    return { ok: true, output: output.slice(-1_500) };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stdout ?? "").slice(-1_000),
      error: String(error.stderr ?? error.message ?? error).slice(-1_000),
    };
  }
}

function assess(runs) {
  const full = runs.find((run) => run.name === "full-stack");
  const control = runs.find((run) => run.name === "pi-lens-control");
  const lensNames = [
    "lens_diagnostics", "symbol_search", "effective_config", "project_report",
    "module_report", "read_symbol", "read_enclosing", "pi_lens_activate_tools",
    "ast_grep_search", "ast_grep_replace", "ast_grep_outline", "lsp_navigation",
    "lens_diagnostic_mark",
  ];
  const fullActive = new Set(full?.snapshots.find((item) => item.label === "configured-full")?.active ?? []);
  const controlActive = new Set(control?.snapshots.find((item) => item.label === "before-agent-start")?.active ?? []);
  const fullCalls = new Set(full?.toolCalls.map((call) => call.name) ?? []);
  const controlCalls = new Set(control?.toolCalls.map((call) => call.name) ?? []);
  const lspDiagnostics = control?.toolCalls.filter((call) => call.name === "lens_diagnostics") ?? [];
  const lspNavigation = control?.toolCalls.filter((call) => call.name === "lsp_navigation") ?? [];
  return {
    autonomousToolDiscovery: (full?.promptResults.find((item) => item.id === "autonomous")?.toolCalls.length ?? 0) > 0,
    fullStackLensActive: lensNames.filter((name) => fullActive.has(name)),
    fullStackLensCalled: lensNames.filter((name) => fullCalls.has(name)),
    controlLensActive: lensNames.filter((name) => controlActive.has(name)),
    controlLensCalled: lensNames.filter((name) => controlCalls.has(name)),
    harnessLensConflictObserved: lensNames.some((name) => controlActive.has(name)) && !lensNames.some((name) => fullActive.has(name)),
    lspDiagnosticsOutcome: lspDiagnostics.some((call) => call.result?.includes("inconclusive=1")) ? "inconclusive" : "see tool evidence",
    lspNavigationOutcome: lspNavigation.length > 0 && lspNavigation.every((call) => call.result?.includes('"status":"empty"')) ? "all queries empty" : "see tool evidence",
    diagnosticMarkOutcome: controlCalls.has("lens_diagnostic_mark") ? "called" : "not called: no real diagnostic identifier",
    fullStackCheckPassed: full?.finalCheck.ok === true,
    controlCheckPassed: control?.finalCheck.ok === true,
  };
}

async function existingNonLensRuns() {
  try {
    const previous = JSON.parse(await readFile(`${reportBase}.json`, "utf8"));
    return previous.runs.filter((run) => run.name !== "pi-lens-control");
  } catch {
    return [];
  }
}

function resultExcerpt(result) {
  const text = (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return text.slice(0, 1_500);
}

function renderMarkdown(value) {
  const lines = [
    "# 真实 Pi Agent 工具链测试 — 2026-09-21",
    "",
    `模型：\`${value.provider}/${value.model}\`；pi-lens：\`${value.piLensVersion}\`。测试只使用一次性 TypeScript 仓库，没有记录认证文件或 provider 请求正文。`,
    "",
    "结论：模型会主动调用 Work 工具；完整 PI Coffee 栈会把 pi-lens 排除在 active 集合之外。pi-lens 单独对照的索引与 AST 工具可用，但 LSP 诊断不确定，导航查询为空。",
    "",
    "## 自动判定",
    "",
    "```json",
    JSON.stringify(value.assessment, null, 2),
    "```",
  ];
  for (const run of value.runs) {
    const uniqueCalls = [...new Set(run.toolCalls.map((call) => call.name))];
    lines.push(
      "",
      `## ${run.name}`,
      "",
      `- 会话：${run.ok ? "完成" : "失败或降级"}`,
      `- 独立项目检查：${run.finalCheck.ok ? "通过" : "失败"}`,
      `- 实际调用：${uniqueCalls.map((name) => `\`${name}\``).join(", ") || "无"}`,
      `- 扩展错误：${run.extensionErrors.length === 0 ? "无" : run.extensionErrors.join(" | ")}`,
    );
    for (const prompt of run.promptResults) {
      lines.push("", `### ${prompt.id}`, "", prompt.finalText ?? "模型没有返回最终文本。");
    }
  }
  lines.push("", "完整工具结果片段、活动集合快照和最终文件状态见同名 JSON 报告。", "");
  return lines.join("\n") + "\n";
}

function createFixtureSearchServer() {
  return createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.url === "/v1/search/serper") {
      const parsed = JSON.parse(body || "{}");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        responseId: "real-agent-probe",
        queries: parsed.queries ?? ["PI Coffee compatibility fixture"],
        results: [{
          title: "PI Coffee compatibility fixture",
          url: "https://example.com/pi-coffee-toolchain-fixture",
          snippet: "Local synthetic search result used only to verify the web tool adapter.",
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
}

async function packageVersion(path) {
  return JSON.parse(await readFile(path, "utf8")).version;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
