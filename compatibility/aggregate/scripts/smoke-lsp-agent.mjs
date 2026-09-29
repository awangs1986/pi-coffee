import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { resolvePiSkills, withCoffeeLspPath } from "../dist/src/pi-skills.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const provider = "eidolon";
const model = "gpt-5.6-terra";
const repeats = positiveInteger(process.env.PI_COFFEE_LSP_SMOKE_REPEATS, 3);
const reportPath = join(repo, "docs/reviews/lsp-agent-evaluation-20260921.json");

async function main() {
  const root = await mkdtemp(join(tmpdir(), "pi-coffee-lsp-agent-"));
  const requested = new Set((process.env.PI_COFFEE_LSP_SMOKE_SCENARIOS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const scenarios = [typescriptMismatch, referenceImpact, pythonMismatch].filter((scenario) => requested.size === 0 || requested.has(scenario.id));
  const runs = [];
  try {
    for (const scenario of scenarios) {
      for (let repetition = 1; repetition <= repeats; repetition += 1) {
        const workspace = join(root, `${scenario.id}-${repetition}`);
        const fixture = await scenario.create(workspace);
        runs.push(await runAgent({ scenario, repetition, workspace, fixture }));
      }
    }
    const assessment = Object.fromEntries(scenarios.map((scenario) => {
      const selected = runs.filter((run) => run.scenario === scenario.id);
      const passed = selected.filter((run) => run.ok).length;
      return [scenario.id, { passed, total: selected.length, accepted: passed >= Math.min(2, selected.length) }];
    }));
    const report = {
      generatedAt: new Date().toISOString(), provider, model, repeats,
      fixture: "Disposable TypeScript and Python projects; commands and outcomes are sanitized; no transcripts or credentials retained.",
      assessment, runs,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ report: reportPath, assessment, runs: runs.map(compact) }, null, 2));
    if (Object.values(assessment).some((item) => !item.accepted)) process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runAgent({ scenario, repetition, workspace, fixture }) {
  const calls = [];
  const extensionErrors = [];
  const env = {
    ...withCoffeeLspPath(process.env),
    PI_COFFEE_ROOT_SESSION: `lsp-smoke-${scenario.id}-${repetition}-${Date.now()}`,
    PI_COFFEE_LSP_IDLE_MS: "1000",
  };
  const client = new RpcClient({
    cliPath,
    cwd: workspace,
    provider,
    model,
    env,
    args: ["--no-extensions", "--no-session", "--thinking", "low", "--skill", resolvePiSkills()[0]],
  });
  const unsubscribe = client.onEvent((event) => {
    if (event.type === "tool_execution_start") {
      const input = event.args ?? event.input ?? {};
      const command = event.toolName === "bash" && typeof input.command === "string" ? sanitizeCommand(input.command, workspace) : undefined;
      calls.push({ tool: event.toolName, ...(command ? { command } : {}) });
    }
    if (event.type === "extension_error") extensionErrors.push(String(event.error ?? event.message ?? "extension error").slice(0, 500));
  });
  let fatalError;
  let skillVisible = false;
  let finalText = "";
  try {
    await client.start();
    skillVisible = (await client.getCommands()).some((command) => command.name === "skill:lsp");
    await client.promptAndWait(scenario.prompt, undefined, 360_000);
    finalText = (await client.getLastAssistantText())?.slice(0, 800) ?? "";
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
  } finally {
    unsubscribe();
    await client.stop().catch(() => {});
  }
  const check = fixture.check();
  const lspCommands = calls.filter((call) => call.command?.includes("coffee-lsp"));
  const operations = [...new Set(lspCommands.flatMap((call) => ["status", "symbols", "definition", "references", "hover", "diagnostics"].filter((operation) => new RegExp(`coffee-lsp\\s+${operation}\\b`).test(call.command))))];
  const changed = execFileSync("git", ["diff", "--name-only"], { cwd: workspace, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  return {
    scenario: scenario.id,
    repetition,
    ok: fatalError === undefined && skillVisible && lspCommands.length > 0 && operations.some((item) => item !== "status") && check.ok && extensionErrors.length === 0,
    skillVisible,
    toolCalls: calls.map((call) => call.tool),
    lspOperations: operations,
    changed,
    check,
    extensionErrors,
    ...(fatalError ? { fatalError } : {}),
    finalText,
  };
}

const typescriptMismatch = {
  id: "typescript-cross-file",
  prompt: "这个一次性 TypeScript 项目的跨文件调用导致类型检查失败。请自行调查，做最小正确修复，并用项目检查验证。不要问我该用什么工具，也不要提交。",
  async create(workspace) {
    await createTypeScriptBase(workspace);
    await writeFile(join(workspace, "src/lib.ts"), "export function formatTotal(value: number): string { return value.toFixed(2); }\n");
    await writeFile(join(workspace, "src/app.ts"), "import { formatTotal } from './lib.js';\nexport const result: number = formatTotal(7);\n");
    commit(workspace);
    return { check: () => commandCheck(join(repo, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit"], workspace) };
  },
};

const referenceImpact = {
  id: "typescript-reference-impact",
  prompt: "把 src/domain.ts 中公开函数 describeUser 的参数从 User 对象改成 userId 字符串，并修复这个符号的所有真实调用方。项目里还有同名局部函数，不要误改。完成后运行项目检查，不要提交。",
  async create(workspace) {
    await createTypeScriptBase(workspace);
    await writeFile(join(workspace, "src/domain.ts"), "export interface User { id: string; name: string }\nexport function describeUser(user: User): string { return user.id; }\n");
    await writeFile(join(workspace, "src/app.ts"), "import { describeUser } from './domain.js';\nexport const label = describeUser({ id: 'u1', name: 'Ada' });\n");
    await writeFile(join(workspace, "src/unrelated.ts"), "function describeUser(value: number): number { return value + 1; }\nexport const untouched = describeUser(2);\n");
    commit(workspace);
    return { check: () => commandCheck(join(repo, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit"], workspace) };
  },
};

const pythonMismatch = {
  id: "python-cross-file",
  prompt: "这个一次性 Python 项目有一个跨文件类型错误。请自行定位并做最小修复，然后运行项目配置的类型检查。不要提交。",
  async create(workspace) {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "pyproject.toml"), "[tool.pyright]\ntypeCheckingMode = \"strict\"\n");
    await writeFile(join(workspace, "lib.py"), "def greet(name: str) -> str:\n    return f\"hello {name}\"\n");
    await writeFile(join(workspace, "app.py"), "from lib import greet\nresult: int = greet(\"world\")\n");
    commit(workspace);
    return { check: () => commandCheck(join(repo, "node_modules/.bin/pyright"), ["."], workspace) };
  },
};

async function createTypeScriptBase(workspace) {
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true }, include: ["src/**/*.ts"] }, null, 2));
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "coffee-lsp-fixture", private: true, type: "module", scripts: { check: "tsc -p tsconfig.json --noEmit" } }, null, 2));
  await mkdir(join(workspace, "node_modules/.bin"), { recursive: true });
  await symlink(join(repo, "node_modules/typescript"), join(workspace, "node_modules/typescript"), "dir");
  await symlink(join(repo, "node_modules/.bin/tsc"), join(workspace, "node_modules/.bin/tsc"), "file");
}

function commit(workspace) {
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspace });
}

function commandCheck(command, args, cwd) {
  try {
    const output = execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60_000 });
    return { ok: true, output: output.slice(-500) };
  } catch (error) {
    return { ok: false, output: String(error.stdout ?? "").slice(-500), error: String(error.stderr ?? error.message ?? error).slice(-500) };
  }
}

function sanitizeCommand(command, workspace) {
  return command.replaceAll(workspace, "<workspace>").slice(0, 600);
}

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function compact(run) {
  return { scenario: run.scenario, repetition: run.repetition, ok: run.ok, skillVisible: run.skillVisible, lspOperations: run.lspOperations, check: run.check.ok };
}

await main();
