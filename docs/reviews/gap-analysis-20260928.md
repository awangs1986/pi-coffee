# pi-coffee-lsp 差距审核（对标 Claude Code / oh-my-pi / OpenCode / Grok Build / Codex）

审核日期：2026-09-28  
审核对象：`main@04623e7`（Pi 0.87.1，当前 npm 最新版即 0.87.1）  
审核目标：以"Claude Code / Codex / Grok Build 内置 LSP 集成"的水平为基准，找出这个插件在
**日常网页 / 游戏 / 小软件开发** 场景下还缺什么。

> **进展（2026-09-28，v0.2.0）**：P0-1（Pi 扩展层：`lsp` 工具、edit/write 后自动诊断、
> `/lsp` 命令、会话级 daemon 生命周期）已实现，并按 Pi 标准包格式（`package.json` 的
> `pi.extensions` + `pi.skills`、`pi-package` 关键字、宿主包作为 peerDependencies）打包，
> 可通过 `pi install npm:pi-coffee-lsp` 安装。见 `src/extension/`、`test/extension.test.ts` 与 README。
> **进度更新（2026-09-28，v0.3.0）**：P0-2 已完成——`src/lsp/registry.ts` 引入了改编自 OMP `lsp/defaults.json`
> 的 server 注册表（50 个内置条目：网页 HTML/CSS/JSON/YAML/Vue/Svelte/Astro/ESLint/Tailwind…，游戏 C#/OmniSharp/
> clangd/Lua/GLSL/WGSL/Zig/Odin/CMake…，应用 Java/Kotlin/Dart/Swift/Ruby/Bash/Dockerfile…），`coffee-lsp.json` 的
> `servers` 段可新增/覆盖/禁用任意 server，`PI_COFFEE_<ID>_LSP_COMMAND` 对所有条目生效，新增 `coffee-lsp servers`
> 与 `coffee-lsp install <id>`（npm 分发的 server 装进 `~/.pi/agent/coffee-lsp/npm`），并区分 TypeScript 5
> （typescript-language-server）与 TypeScript 7（原生 `tsc --lsp`）。仍未做：同一文件多 server 并行（linter 与
> 语言服务器同时出诊断）、`tcp` 传输（Godot）、tree-sitter 降级。
> 其余条目（P0-3 快照、P0-4 Windows、P1-1 冷启动预算等）仍待处理。
> **进度更新（2026-09-28，v0.4.0）**：只做"日常开发时 agent 少犯错"闭环需要的部分——
> (1) 关联诊断：一次编辑在同一 daemon 里其他已打开文件中**新**造成的错误随自动诊断一并出现（`related` /
> `LSP related diagnostics`，只报增量、不重复）；(2) `--symbol name[#n]` 按名字定位，不再手数列号；
> (3) P0-3 完成：快照扫描器跳过 Unity/Unreal/Godot/前端缓存目录与根 `.gitignore` 目录名，`package-lock.json`
> 等数据文件不再当配置变化，超过 50000 项降级为 `snapshot_truncated` 而不是失败；(4) `tcp` 传输 + 内置
> `gdscript`（Godot 编辑器内 LSP，127.0.0.1:6005，端口可配）；(5) 2 MiB 文档上限（`file_too_large`）；
> (6) 语言无可用 server 时在编辑结果里提示一次。仍未做（有意）：P0-4 Windows 命名管道、P1-1 预算调整、
> 多 server 合并诊断、tree-sitter 降级、workspaceSymbol/rename/codeAction 等写操作。

---

## 0. 结论摘要（TL;DR）

**核心引擎是好的，外围全缺。** 这个包的 LSP client / daemon / 诊断新鲜度判定，比大多数同类 Pi 扩展都严谨
（59 个测试全过，绝不把"没收到报告"当成 clean）。但对标 Claude Code 级别，差距主要在 5 个地方：

| # | 缺口 | 影响 | 证据 |
|---|---|---|---|
| P0-1 | **集成方式是 Skill + Bash CLI，没有"编辑后自动回灌诊断"** | 模型必须自己想起来调 `coffee-lsp`。你们自己的验收记录写着"模型自主使用得分 0/9"。Claude Code / OMP / OpenCode / Grok Build / 其它 Pi LSP 扩展全部是 edit/write 之后**自动**把错误塞回上下文 | `skills/lsp/SKILL.md`、`docs/extraction.md` |
| P0-2 | **语言覆盖只有 6 家硬编码，没有通用 server 注册表** | `.vue .svelte .html .css .scss .json .yaml .lua .gd .glsl .wgsl .java .kt .mts .cts` 全部 `unsupported language`。网页三大框架里 Vue/Svelte 整框架不可用；游戏里 Godot/Love2D/Roblox/着色器全部不可用；`coffee-lsp.json` 只能改 settings，不能加 server | 实测（见 §7.1） |
| P0-3 | **项目快照扫描器不适合真实项目** | 硬上限 20000 个目录项 → Unity `Library/`、Unreal `Intermediate/ Saved/ Content/`、Godot `.godot/` 直接触发 `server_failed`；忽略列表不读 `.gitignore`（`.next .nuxt .svelte-kit .turbo coverage .cache venv` 都不忽略）→ Next.js dev server 写 `.next/` 时查询报 `stale_snapshot`；任何 `.json` 变化（含 `package-lock.json`）都判为"配置变化"→ 重启 TS server | 实测（见 §7.3–7.5） |
| P0-4 | **Windows 上 daemon 大概率不可用** | socket 路径是 `%TEMP%\pi-coffee-lsp-*.sock`，Node 在 Windows 只支持 `\\.\pipe\` 命名管道；`chmodSync` 也会失败。游戏开发（Unity/Unreal）主战场是 Windows | 代码推断（`transport.ts: lspDaemonSocket`），你们文档也写"Windows lifecycle not certified" |
| P1-1 | **冷启动 + 干净文件 + 默认 10s 超时 = `inconclusive`** | 12s 的 cold-publish 保护窗 > 10s 默认预算，模型第一次调 diagnostics 就得到"不确定"，并且 `npm install` 之后又会重来一遍 | 实测（见 §7.2、7.4） |

其余缺口（操作面：workspaceSymbol / call hierarchy / rename / code action / 工作区诊断；输出 token 效率；
`doctor`/`daemon stop`/日志等运维命令；按符号名定位）见 §4。

一句话建议：**把现有 CLI 内核保留，用 Pi extension 包一层**（注册 `lsp` 工具 + `tool_result` 钩子自动诊断 +
`session_shutdown` 收 daemon），同时把 profile 改成可配置的 `lsp.json` 注册表，并把快照扫描换成 daemon 内的
文件监听。这三件事做完，才算达到 Claude Code 的"基础线"。

---

## 1. 审核方法

1. 通读 `src/lsp/*`、`skills/lsp/SKILL.md`、`README.md`、`docs/extraction.md`、测试与 probe 脚本。
2. `npm ci && npm run build && vitest run`：59/59 通过（含真实 tsserver / Pyright 测试）。
3. 在临时 TS 项目上实测 CLI 行为：语言识别、冷/热延迟、并发、快照上限、`.next/` 写入、`package-lock.json` 变化、`.mts`。
4. 查阅对标产品的公开资料（Claude Code 插件手册的 `lspServers` 字段、Claude Code LSP 工具的 9 个操作、
   oh-my-pi 的 lsp 工具、OpenCode 内置 LSP 列表与自动安装、Grok Build 的 `lsp.json` 三级合并与被动诊断、
   Codex 的 LSP 现状，以及同平台的 `samfoy/pi-lsp-extension`、`@gitawego/pi-lsp`、`@ian-pascoe/pi-lsp`）。

标注约定：**[实测]** = 本次跑出来的；**[代码]** = 读源码推断；**[资料]** = 对标产品公开文档。

---

## 2. 值得保留的优点

- **诊断新鲜度语义严谨**：版本匹配 / settle 窗 / 冷启动空报告保护 / pull 失败与空报告分离 / `inconclusive` 状态，
  比 OMP、samfoy 等"收到什么算什么"的实现更可信。这是本包最有价值的资产。
- **daemon 生命周期扎实**：启动锁、失败退避、配置变化即淘汰、请求级取消与 deadline、进程组回收、shutdown guard。
- **位置语义清晰**：1-based Unicode code point，`EquivalentUriMap` 处理 URI 等价，`--expect-sha256` 防陈旧位置。
- **测试真实**：不是 mock 一把梭，有 fake server + 真实 tsserver/Pyright，覆盖了很多边角（EPIPE、初始化被杀、
  动态能力注销、批量超时保留已确认结果……）。
- **来源与许可证干净**：OMP 归属、逐文件对照表、tarball 门禁。

这些不要在重构时丢掉——下面所有建议都是"在这个内核外面加东西"，不是推倒重来。

---

## 3. 对标矩阵

"✅ 有 / ⚠️ 部分 / ❌ 无"。对标列信息来自公开资料，可能随版本变化。

| 能力 | pi-coffee-lsp | Claude Code | oh-my-pi | OpenCode | Grok Build | Codex CLI | samfoy/pi-lsp-extension |
|---|---|---|---|---|---|---|---|
| 集成形态 | Skill + Bash CLI | 内置 `LSP` 工具 + 自动诊断 | 内置 `lsp` 工具 + 写入路径钩子 | 内置，编辑后回灌诊断 | 被动诊断 + 可选 `lsp` 工具 | ❌ 原生无（Issue #8745 开放中，靠 MCP 桥） | Pi extension：工具 + `tool_result` 自动诊断 |
| **编辑后自动诊断回灌** | ❌ | ✅（"Found N new diagnostic issues"） | ✅ | ✅ | ✅ | ❌ | ✅（仅 errors，≤10 行） |
| diagnostics（单文件） | ✅（严谨） | ✅ | ✅ | ✅ | ✅ | – | ✅ |
| diagnostics（工作区级） | ❌（≤20 个 `--file`） | ⚠️ | ✅ | ⚠️ | ⚠️ | – | ✅（`"*"`） |
| definition / references / hover / implementation | ✅ | ✅ | ✅ | ⚠️（以诊断为主） | ?（有 `lsp` 工具，操作集未核实） | – | ✅ |
| documentSymbol | ✅ | ✅ | ✅ | – | ? | – | ✅ |
| **workspaceSymbol（按名字全局找符号）** | ❌ | ✅ | ✅ | – | ? | – | ✅ |
| typeDefinition | ❌ | ❌ | ✅ | – | – | – | ❌ |
| **call hierarchy（incoming/outgoing）** | ❌ | ✅ | ⚠️（可走 raw 请求） | – | – | – | ❌ |
| rename（预览/应用） | ❌（设计上只读） | ❌ | ✅（含 willRenameFiles） | – | – | – | ✅（预览） |
| code actions / quick fix | ❌ | ❌ | ✅ | – | – | – | ✅ |
| format on write | ❌ | ❌（走 hooks） | ✅ | – | – | – | ❌ |
| completions / signature help | ❌ | ❌ | ❌ | – | – | – | ✅ |
| **通用 server 配置文件** | ❌（6 家硬编码 + env 覆盖） | ✅ `.lsp.json` | ✅ `lsp.json`（40+ 语言） | ✅ `lsp` 配置 + 自动安装 | ✅ `lsp.json` 用户/项目/插件三级合并 | – | ✅ `.pi-lsp.json servers` + `/lsp-config` |
| 同一扩展名多 server（TS + ESLint + Tailwind） | ❌ | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| TCP/socket 传输（Godot 需要） | ❌ | ⚠️ 接受 `socket` 字段 | ? | ❌ | ? | – | ? |
| 自动安装 / doctor | ❌ | ❌（插件给安装提示） | ⚠️ | ✅ 自动下载 | ? | – | ❌ |
| daemon 跨会话共享 | ✅（按 session id） | – | ✅ mux | – | – | – | ✅ |
| restart / status 命令 | ❌（只有 API `stopLspDaemon`） | `/plugin` | `lsp status/reload` | – | – | – | `/lsp` `/lsp-restart` |
| 调试日志开关 | ❌（只截 8KB stderr 进错误信息） | `--debug` | ✅ | ✅ | `~/.grok/logs` | – | `PI_LSP_DEBUG=1` |
| 无 server 时的降级（tree-sitter） | ❌ | ❌ | ✅（AST 工具） | ❌ | ✅ code graph | ❌ | ✅ |
| 诊断可信度判定 | ✅✅（最强） | ⚠️ | ⚠️ | ⚠️ | ? | – | ⚠️ |
| Windows | ❌ 疑似 daemon 不可用 | ✅ | ✅ | ✅ | ✅ | ✅ | ? |

---

## 4. 缺口清单（按优先级）

### P0-1 集成形态：从 Skill+Bash 升级为 Pi extension（这是最大的一项）

**现状** [代码]：模型只能通过 Bash 调 `coffee-lsp ...` 并读 JSON。是否调用完全靠 SKILL.md 说服模型。
`docs/extraction.md` 明确写着"strict autonomous-model score is 0/9"，即模型基本不会自发用。

**对标** [资料]：Claude Code 在每次 Edit 之后自动跑 LSP 诊断并把 "Found N new diagnostic issues in M files"
塞进上下文，插件清单里 `diagnostics` 字段默认 `true`；Grok Build 把 LSP 分成"被动诊断"和"可选 lsp 工具"；
OMP 是 "Diagnostics on write/edit"；OpenCode 是"编辑后把编译器诊断喂回模型"；同平台的 samfoy/pi-lsp-extension
在 `write`/`edit` 成功后自动把 errors 追加到工具结果。**这才是 LSP 对 agent 真正产生价值的地方**——
不是导航，而是"改完立刻知道错了"。

**建议**：新增 `src/extension/index.ts`（Pi 0.87.1 的 `ExtensionAPI`），复用现有 daemon：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runCoffeeLsp } from "../lsp/cli.js";        // 直接进程内调用，不必再 spawn CLI
import { stopLspDaemon } from "../lsp/transport.js";

export default function (pi: ExtensionAPI) {
  // 1) 一等公民工具：schema 直接给模型，比 Bash+JSON 省 token、省猜测
  pi.registerTool({
    name: "lsp",
    description: "Language-server queries: diagnostics, definition, references, hover, symbols, workspace_symbol, implementation …",
    parameters: Type.Object({
      operation: Type.Union([...]),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Integer()), column: Type.Optional(Type.Integer()),
      symbol: Type.Optional(Type.String()),   // 见 P1-5：按符号名定位
      query: Type.Optional(Type.String()),    // workspace_symbol
    }),
    async execute(_id, p, signal, _u, ctx) { /* runCoffeeLsp(...) → 紧凑文本 */ },
  });

  // 2) 自动诊断：edit/write 成功后，对被改文件跑一次 diagnostics（热 server ~300–700ms），
  //    只追加 error（可配置 warning），限 N 行；server 未启动时可选择懒启或跳过
  pi.on("tool_result", async (ev, ctx) => {
    if (!["edit", "write"].includes(ev.toolName) || ev.isError) return;
    const text = await diagnosticsSummary(ev.input.path, ctx.signal);
    if (text) return { content: [...ev.content, { type: "text", text }] };
  });

  // 3) 系统提示引导 + 生命周期
  pi.on("before_agent_start", (ev) => { /* 追加一段 "prefer lsp over grep" guideline */ });
  pi.on("session_shutdown", () => stopLspDaemon(sessionId));
  pi.registerCommand("lsp", { /* status / restart / doctor */ });
}
```

要点：
- 保留 CLI（Bash 用户、其它 agent 仍可用），extension 只是另一个入口，两者共用 daemon。
- `tool_result` 追加内容要**极简**（`src/game.ts:10:11 error TS2345: Argument of type 'string' …`），
  Claude Code 那种一行摘要 + 展开的体验就是靠"少"。
- `inconclusive` 时不要追加任何东西（否则每次冷启动都给模型噪音），或只在 debug 模式提示。
- 通过 `pi.skills`/`pi.extensions` manifest 一起发布，解决 README 里"`pi install` 后 `coffee-lsp` 不在 PATH"的问题
  （extension 自己知道 bin 路径，可用现有 `withCoffeeLspPath`）。

### P0-2 语言覆盖与 server 注册表

**现状** [实测 §7.1]：只有 `.ts .tsx .js .jsx .mjs .cjs .py .cs .c/.h/.cc/.cpp/.cxx/.hpp/.hh/.hxx .rs .go`。
以下全部 `unsupported language`：`vue svelte astro html css scss less json jsonc yaml toml md lua gd glsl wgsl hlsl
shader java kt swift dart zig php rb sh mts cts pyi`。`coffee-lsp.json` 只接受 `settings`/`initializationOptions`，
**不能新增 server**；`PI_COFFEE_*_LSP_COMMAND` 只能替换那 6 家的命令。

**对标** [资料]：Claude Code `.lsp.json`：`command / args / env / extensionToLanguage / transport(stdio|socket) /
initializationOptions / settings / workspaceFolder / startupTimeout / shutdownTimeout / restartOnCrash / maxRestarts /
diagnostics`。Grok Build：`~/.grok/lsp.json`（用户）+ `.grok/lsp.json`（项目）+ 插件 `.lsp.json`，按 server 名合并，
项目 > 用户 > 插件。OMP：`lsp.json`，40+ 语言。OpenCode：内置 20+ 并按项目依赖自动启用/自动下载。
同平台的 `@gitawego/pi-lsp`：默认目录 < `~/.pi/agent/pi-lsp.json` < `<ws>/.pi/pi-lsp.json`（仅受信项目）。

**建议**：
1. 把 `profiles.ts` 改成"内置目录 + 三级合并"的注册表，字段**兼容 Claude Code `.lsp.json`**
   （这样用户可以直接抄 Piebald-AI / boostvolt 市场里几十个现成配置），再加 `rootMarkers`、`requires`（项目依赖探测）。
2. 允许**一个扩展名对应多个 server**（`.tsx` → tsserver + eslint + tailwind；`.vue` → volar + tsserver+`@vue/typescript-plugin`），
   诊断结果按 `source` 合并。
3. 增加 `transport: "tcp"`（Godot 编辑器内置 LSP 只走 `127.0.0.1:6005`）。
4. 项目级配置里的 `command` 必须过 Pi 的 project-trust 门（否则等于任意代码执行），用户级不受限。
5. 内置目录建议（对应你的三个场景，见 §5）。

### P0-3 项目快照扫描器（`snapshot.ts`）不适合真实项目

**现状** [代码 + 实测]：
- 每次请求走 **3 次全量目录遍历**（CLI 前后各一次 `projectFingerprint`，daemon `acquire` 一次 `projectSnapshot`），
  即使 server 已热。5k 个静态资源文件就让热查询从 ~90ms 涨到 ~330ms [实测]。
- **硬上限 20000 个目录项**（任何类型的文件都计数）。20500 个空文件的 `Library/Artifacts/` 让所有查询变成
  `server_failed: Project snapshot exceeds 20000 entries` [实测 §7.3]。Unity `Library/` 常见几十万文件、Unreal
  `Intermediate/ Saved/ DerivedDataCache/ Content/`、Godot `.godot/`，都会撞上。
- 忽略列表只有 `.git node_modules target bin obj .venv __pycache__ dist build`，**不读 `.gitignore`**。
  `.next .nuxt .svelte-kit .turbo .cache .parcel-cache coverage out storybook-static venv .tox .mypy_cache .idea .vs
  Library Temp Logs Intermediate Saved DerivedDataCache Binaries .godot .import` 均不忽略。
- Next.js dev server 往 `.next/static/chunks/*.js` 写文件期间查询 → `stale_snapshot`，并且这些 `.js` 会被当成
  **源码**发 `didChangeWatchedFiles` [实测 §7.5]。
- 所有 `.json/.toml/.yaml` 都算"配置"，任何变化 → **整个 server 淘汰重启**。`npm install` 改了 `package-lock.json`，
  下一次 diagnostics 就冷启动 + 撞上 P1-1 → `inconclusive` 10 秒 [实测 §7.4]。

**建议**：
1. 快照/变更检测搬进 daemon，用 `fs.watch({recursive:true})`（Node 22 三平台都支持）或 `@parcel/watcher`
   做增量维护，CLI 端不再遍历；`stale_snapshot` 改为"仅当**被查询文件或其所属项目源文件**在查询期间变化"才触发。
2. 读取 `.gitignore`（含嵌套）+ 一份更完整的默认忽略表；`--workspace` 之外的目录不扫。
3. "配置变化 → 重启"的判定收窄到真正影响 server 的文件：`tsconfig*.json jsconfig.json package.json pyproject.toml
   pyrightconfig.json Cargo.toml go.mod *.csproj *.sln compile_commands.json .clangd coffee-lsp.json`；
   `package-lock.json` / `*.tsbuildinfo` / 任意 `.json` 不算。
4. 20000 上限要么去掉，要么改成"超限降级为不做快照校验并在 `issues` 里注明"，而不是让功能整体失效。

### P0-4 Windows

**现状** [代码]：`lspDaemonSocket()` 返回 `%TEMP%/pi-coffee-lsp-<uid>-<hash>.sock`；Node 在 Windows 的 IPC
`listen(path)` 只接受 `\\.\pipe\...` / `\\?\pipe\...`，随后 `chmodSync(socketPath, 0o600)` 也会抛错。
daemon 侧 `server.on("error")` 只吞 `EADDRINUSE`，其它错误直接抛出崩溃；CLI 侧要么 `daemon_failed`（exit 5），
要么重试到期 `request_timeout`（exit 4），都**不会自动降级到 `--no-daemon`**。**结论：Windows 上除 `status` 外所有操作大概率全挂**，需要一台 Windows 机器实证。

**建议**：`process.platform === "win32"` 时使用 `\\\\.\\pipe\\pi-coffee-lsp-<hash>`，跳过 chmod 与 `.starting`
锁目录的语义检查；daemon 启动 `spawn(..., { detached: true, windowsHide: true })`；把 Windows 加进 CI matrix。
游戏开发者大多在 Windows，这一项不解决，"游戏"场景等于没有。

### P1-1 冷启动 + 干净文件 + 默认预算 = `inconclusive`

**现状** [实测 §7.2]：`DEFERRED_DIAGNOSTICS_WAIT_TIMEOUT_MS = 12_000` > 默认 `--timeout-ms 10000`。
tsserver 冷启动后对干净文件返回的是 version=null 的空报告，被判"疑似占位"，等满 12s 才认；但 10s 预算先到期，
返回 `diagnosticState: inconclusive`，总耗时 10.07s。有错误的文件则 ~2.2s 就能返回。
SKILL.md 让模型"冷项目用 `--timeout-ms 30000`"，等于把系统缺陷转嫁给模型。

**建议**（任选其一或组合）：
- 客户端已经在跟踪 `$/progress`；typescript-language-server 初始化时会发 work-done progress。
  **进度结束之后**收到的空报告就应视为权威，不必再等 12s。
- 默认预算改为 ≥ 冷启动保护窗（例如 15s），或让保护窗 = `min(12s, 预算 − settle − 余量)`。
- 服务器就绪后主动预热：daemon 首次拉起 TS server 时对被查询文件先 `didOpen` 一次，等诊断"落地"后再算就绪。

### P1-2 操作面补齐

按对 agent 的价值排序：

1. **`workspace_symbol`**（`workspace/symbol`）：模型最常见的问题是"`PlayerController` 定义在哪"，现在必须先猜文件。
   Claude Code / OMP / Grok / samfoy 都有。
2. **`rename`**（`textDocument/rename` → `WorkspaceEdit`）：先做 `--dry-run` 返回 edits 列表（保持只读契约），
   再考虑 `--apply`（可以走 Pi 的 `withFileMutationQueue`）。OMP 把这作为招牌功能；跨文件重命名是 agent 最容易用
   grep+edit 改漏的操作。
3. **`incoming_calls` / `outgoing_calls`**（call hierarchy）：Claude Code 有；改函数签名前的影响面分析。
4. **`code_actions`**：至少暴露 quick fix 标题与 edits（auto-import、缺失 await、unused import）；是否应用可分两步。
5. **`type_definition`**：OMP 有，成本极低。
6. **工作区级诊断**：`diagnostics --all` / `--changed`（git diff 名单），对 TS 可用 tsserver 的项目级 `geterr`，
   或对每个已打开文件汇总；≤20 个 `--file` 的批处理对"我改的接口影响了谁"不够。
7. 次要：`signature_help`、`document_highlight`、`inlay_hints`（可让模型看到推断类型）。

### P1-3 输出的 token 效率

**现状** [实测]：一个 12 行的 TS 文件，`symbols` 输出 3009 字节。每个 item 都带 `path`（绝对路径）+ 64 位 `sha256`
+ 4 字段 `location`，外加 `snapshot`、`workspace`、`projectRoot`、`coverage`、`schemaVersion`。
`references` 每条约 250 字节，16 KiB 上限≈ 60 多条就截断。

**建议**：保留 JSON 作为机器契约，但给 extension/`--format compact` 一个紧凑文本：

```
game.ts:1:18  interface Entity
game.ts:2:14  class Player            (implements Entity)
game.ts:4:3   method Player.move(dx: number, dy: number): void
game.ts:6:17  function update
```

`sha256` 只在 envelope 顶层给一次；路径相对 `workspace`。同样内容大约省 5–10 倍 token。

### P1-4 运维能力

- `coffee-lsp doctor [--workspace .]`：扫描项目里出现的语言 → 哪些 server 找到了/缺失、版本、安装命令、
  项目前置条件（tsconfig / compile_commands / .sln / go.mod）是否满足。现在 `status` 只能按单个文件问。
- `coffee-lsp daemon status|stop|restart [--server typescript]`：现在只能通过 API `stopLspDaemon` 或手动找 socket。
- `PI_COFFEE_LSP_LOG=<file>` / `--debug`：daemon 目前 `stdio: "ignore"`，server 崩溃只保留 8KB stderr 拼进错误信息。
  跨平台排障必须有日志。
- 默认 `maxClients = 4`、`idle 5min`：全栈游戏项目（TS 客户端 + Python 工具链 + Rust 服务端 + C#）会互相淘汰；
  rust-analyzer / clangd(Unreal) / jdtls 这类冷启动几分钟的 server 被 5 分钟空闲回收后代价极大。
  建议：`maxClients` 可配置，idle 默认 30–60 分钟，extension 模式下随 Pi session 生命周期。
- `--timeout-ms` 硬上限 60s：rust-analyzer 在 Bevy 项目、clangd 在 Unreal 项目的首次加载经常超过 60s，
  应允许 server 级 `startupTimeout`（Claude Code 有此字段），初始化预算与单次查询预算分离。

### P1-5 位置输入的易用性

模型数列号经常出错（尤其中文/emoji/制表符）。建议所有位置型操作支持 `--symbol <name>[#n]`：
先 `documentSymbol` 找到名字匹配的 `selectionRange` 再发请求，一步到位；名字重复时返回候选列表。
这比 `--expect-sha256` 那套对模型友好得多（模型几乎不会主动用 sha256）。

### P2 其它

- `.mts .cts .pyi .pyw .cu .inl` 等扩展名补齐 [实测 `.mts` unsupported]。
- Deno 项目（`deno.json`）应走 `deno lsp` 而不是 tsserver，否则 URL import 全是错。
- Pyright 的 venv：确认 `.venv/` 自动识别；否则通过 `settings.python.venvPath/venv` 或 `pythonPath` 注入。
- 可选支持 `tsgo`（`@typescript/native-preview` 的 `--lsp`）：TS 冷启动从十几秒降到亚秒，对 P1-1 也是釜底抽薪。
- `emit()` 里 16 KiB 截断后 `issues` 会标 `output_truncated`，但 `coverage.truncated` 与 `--limit` 语义有重叠，文档需说明。
- CLI `--version` 硬编码 `0.1.0`，应读 `package.json`。
- `references` 在 `startedAt + 3000ms` 内空结果自动重试是 OMP 的启发式，对大项目的 tsserver 首轮索引偏短，建议与
  `$/progress` 联动。

---

## 5. 三个场景逐项核对

### 5.1 网页

| 技术栈 | 现状 | 缺什么 |
|---|---|---|
| React / Next.js（TS/TSX） | ✅ tsserver 可用 | `.next/` 不忽略 → 开发时 `stale_snapshot`；无 ESLint / Tailwind 诊断；无 `.css/.scss` |
| **Vue / Nuxt** | ❌ `.vue` unsupported | `@vue/language-server` + tsserver 注入 `@vue/typescript-plugin`（hybrid mode）；需要"一个扩展名多 server" |
| **Svelte / SvelteKit** | ❌ `.svelte` unsupported | `svelte-language-server`；`.svelte-kit/` 忽略 |
| Astro | ❌ | `@astrojs/language-server` |
| 纯 HTML / CSS / JS 站点 | JS ✅（无 jsconfig 时 root=cwd，靠 inferred project）；HTML/CSS ❌ | `vscode-langservers-extracted`（html/css/json/eslint 四合一） |
| Tailwind | ❌ | `@tailwindcss/language-server` |
| ESLint / Biome / oxlint | ❌ | `vscode-eslint-language-server` / `biome lsp-proxy` / `oxlint --lsp`（OpenCode 三个都内置，按项目依赖自动启用） |
| JSON / YAML 配置（tsconfig、GitHub Actions、docker-compose） | ❌ | `vscode-json-language-server` + `yaml-language-server`（schema 校验对 agent 很有用） |
| Deno / Bun | Deno ❌（会误用 tsserver） | `deno lsp` 按 `deno.json` 探测 |
| `npm install` 之后 | TS server 被重启 + 首次 clean 查询 `inconclusive` [实测] | 见 P0-3 / P1-1 |

### 5.2 游戏

| 引擎 / 技术 | 语言 | 现状 | 缺什么 |
|---|---|---|---|
| **Unity** | C# | 语言 ✅（csharp-ls）；项目 ❌ | `Library/` 触发 20000 上限 [实测同类]；Unity 频繁重生成 `.csproj` → 每次都"配置变化"重启；Windows daemon；建议增加 Roslyn `Microsoft.CodeAnalysis.LanguageServer` 选项（VS Code C# 扩展同款，对 Unity 生成的 sln 兼容更好） |
| **Godot 4** | GDScript | ❌ `.gd` unsupported | 编辑器内置 LSP **仅 TCP 127.0.0.1:6005**（需编辑器运行）→ 需要 `transport: tcp`；`.godot/` 忽略；Godot C# 走 csharp-ls ✅ |
| **Unreal** | C++ | 语言 ✅（clangd + UBT 生成的 compile_commands.json）；项目 ❌ | `Intermediate/ Saved/ Binaries/ DerivedDataCache/ Content/` 全不忽略 → 必撞上限；clangd 首次索引 > 60s 上限；Windows |
| Web 游戏（Phaser / Three.js / PixiJS / Babylon） | TS | ✅ | 着色器 `.glsl/.wgsl/.frag/.vert` ❌（`glsl_analyzer` / `wgsl-analyzer`） |
| Bevy / macroquad | Rust | ✅ rust-analyzer | 首次加载常 > 60s 硬上限；5 分钟空闲被回收后再次冷启动代价大 |
| Love2D / Defold | Lua | ❌ | `lua-language-server`（可带 Love2D/Defold 注解库） |
| Roblox | Luau | ❌ | `luau-lsp` |
| Minecraft 模组 | Java / Kotlin | ❌ | `jdtls` / `kotlin-lsp`（Gradle 项目，冷启动很慢，需要 `startupTimeout` 与 `autoStart`） |
| Pygame / Ren'Py | Python | ✅ Pyright | Ren'Py `.rpy` 无 LSP（无解，跳过） |
| Unity ShaderLab / HLSL | shader | ❌ | 现成 server 少，可忽略 |

### 5.3 小软件

| 类型 | 现状 | 缺什么 |
|---|---|---|
| Python CLI / GUI（tkinter、PyQt） | ✅ | venv 识别需核实；`.pyi` 扩展名 |
| Go CLI / 服务 | ✅ | — |
| Rust CLI / Tauri 后端 | ✅ | 冷启动预算 |
| C# / .NET 桌面（WPF/Avalonia/MAUI） | ✅ | 多 `.csproj` 无 `.sln` 时 `ambiguous_project`，需要 `--solution` 覆盖，体验差；建议自动选最近的 `.csproj` |
| C/C++ 小工具（CMake） | ✅（要求 compile_commands.json） | 可对 CMake 项目自动 `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` 提示 |
| Electron / Tauri 前端 | ✅ TS | 同网页场景 |
| Shell 脚本 / Dockerfile / TOML / SQL | ❌ | `bash-language-server`、`dockerfile-language-server`、`taplo`（可选） |
| Java / Kotlin / Swift / Dart | ❌ | 通用注册表解决 |

---

## 6. 建议路线图

**阶段 A（达到 Claude Code 基础线，约 1–2 周工作量）**
1. Pi extension：`lsp` 工具 + `tool_result` 自动诊断 + `session_shutdown` + `/lsp` 命令（P0-1）。
2. `lsp.json` 注册表（兼容 Claude Code 字段）+ 内置目录扩到网页/游戏常用 server + 多 server/扩展名 + `tcp`（P0-2）。
3. 快照扫描改 daemon 内监听 + `.gitignore` + 收窄"配置变化"定义 + 去掉 20000 硬失败（P0-3）。
4. Windows 命名管道 + CI（P0-4）。
5. 修默认预算 vs 冷启动保护窗（P1-1）。

**阶段 B（补齐操作面与运维）**
6. `workspace_symbol`、`rename --dry-run`、`type_definition`、call hierarchy、`code_actions`（P1-2）。
7. 紧凑输出格式（P1-3）；`--symbol` 定位（P1-5）。
8. `doctor` / `daemon stop|restart` / 日志 / `startupTimeout` / idle 与 maxClients 可配置（P1-4）。

**阶段 C（超越）**
9. 无 server 时 tree-sitter 降级（symbols/definition 的近似结果，OMP/samfoy 都有）。
10. 受管安装目录 + 可选自动下载（OpenCode 模式）。
11. `tsgo` 选项、Deno 探测、ESLint/Biome 的按依赖自动启用。

**验收标准建议**（替换现在的"0/9 自主使用"）：
- 在一个 Next.js + 一个 Unity（或 Godot）+ 一个 Python 项目里，模型做 10 次带类型错误的修改，
  **未被提示的情况下** ≥ 9 次在下一轮就修正（靠自动诊断），且没有一次因为 `stale_snapshot`/`inconclusive`/`server_failed`
  产生噪音。

---

## 7. 本次实测记录（Linux，Node 22.22.3，tsserver 4.3.4，Pyright 1.1.405）

### 7.1 语言识别
`status --file src/a.<ext>` 对 `vue svelte html css scss json lua gd glsl wgsl hlsl java kt swift dart zig php rb sh mts`
全部返回 `unavailable / missing_server: unsupported language`。

### 7.2 延迟与冷启动
| 场景 | 耗时 | 结果 |
|---|---|---|
| 冷 daemon，文件有错误，`--timeout-ms 30000` | 2.2s | `findings` |
| 冷 daemon，文件干净，`--timeout-ms 30000` | 12.2s | `clean` |
| **冷 daemon，文件干净，默认 10s** | **10.07s** | **`inconclusive`**（`diagnostics_unconfirmed`） |
| 热 diagnostics ×3 | 315 / 312 / 410 ms | `findings` |
| 热 hover / symbols | 95 / 78 ms | ok |
| 改坏 → diagnostics；改好 → diagnostics | 691 / 698 ms | `findings` → `clean` ✅ |
| Pyright 冷启动期间并发的热 TS hover | 378 ms（单独 60 ms） | daemon 全局串行队列（`daemon.ts: chain`）可观测；rust-analyzer 冷启动时会把 TS 查询卡满 |

### 7.3 20000 条目上限
在 TS 项目内创建 `Library/Artifacts/` 下 20500 个空文件 → 所有查询 `status: error`，
`server_failed: Project snapshot exceeds 20000 entries; select a narrower --workspace/project root.`

### 7.4 `.json` 变化 → server 重启
热 server（320ms `clean`）→ 写入 `package-lock.json` → 下一次 diagnostics 10.06s 返回 `inconclusive`
（配置哈希变化 → 淘汰 client → 冷启动 → 撞 P1-1）。

### 7.5 构建产物写入期间查询
后台向 `.next/static/chunks/` 连续写 30 个 `.js`（模拟 Next dev server）期间 diagnostics →
`status: partial`，`stale_snapshot: Project files changed during this query`。

### 7.6 其它
- `symbols` 对 12 行文件输出 3009 字节 JSON。
- `diagnostics` 不带 `--file` → `invalid_arguments`（无工作区级诊断）。
- `implementation` 对 `interface Entity` 正确返回 `class Player`。
- `npm run build` + `vitest run`：59/59 通过，约 61s。
