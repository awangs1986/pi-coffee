# 真实 Pi Agent 工具链测试 — 2026-09-21

结论：**模型会主动发现和使用 Work 工具；基础工具、Web 和子 Agent 可以共存。pi-lens 与 Harness 存在确定的活动工具表冲突，且 pi-lens 单独运行时 LSP 后端仍未通过功能验收。**

本次使用本机 Pi 0.84.4、真实模型 `eidolon/gpt-5.6-terra` 和用户级 `pi-lens 4.2.1`。用户级版本原先缺失，项目依赖为 4.1.3；先执行了 owner 指定的 `pi install npm:pi-lens`，npm 最新版与安装结果均为 4.2.1。项目 `package.json` 中的回退依赖仍是 4.1.3，本次没有顺带升级它。

测试在两个一次性 TypeScript Git 仓库中进行，没有把 PI Coffee 源码、认证文件或 provider 请求正文交给模型。原始结构化证据见 [JSON](./real-agent-toolchain-20260921.json)，复现脚本为 `scripts/smoke-real-agent-toolchain.mjs`。

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 模型主动发现工具 | **通过** | 首轮提示只要求自主检查、修复并验证，没有给工具名。模型主动调用 `ls`、`git`、`find`、`read`、`bash`、`verify`、`search_tools`、`edit`，修复类型错误并完成验证。 |
| Work 十个基础工具 | **全部实际调用** | `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`、`search_tools`、`git`、`verify` 均产生真实工具事件。临时文件被创建、修改、读取并删除，最终 Git 状态仅保留预期修复。 |
| Web 按需能力 | **通过** | 模型通过 `search_tools` 发现并激活 `web`，下一请求成功调用 `web_search`。搜索端点是本机合成服务，验证的是发现、激活和适配器执行，不是外部搜索质量。 |
| 子 Agent 按需能力 | **通过并能恢复错误** | 模型发现并激活 `subagent`。第一次错误选择未注册的 `explorer`，随后改用已注册的 `scout` 并成功返回目标文件。 |
| 扩展稳定性 | **通过** | 两组会话均无 `extension_error`，独立 `npm run check` 均通过 TypeScript 与 1 项契约测试。 |
| Harness + pi-lens | **冲突确认** | 完整栈中 13 个 pi-lens 工具全部 registered，但在会话开始、Work 工具表应用和模型请求前均无一 active；`search_tools` 也找不到 lens 能力。模型明确报告无法调用 LSP。 |
| pi-lens 单独对照 | **核心与 AST 工具可执行** | 常驻工具进入 active；动态激活后，`symbol_search`、`read_enclosing`、`effective_config`、`project_report`、`module_report`、`read_symbol`、三个 `ast_grep` 工具和 `lsp_navigation` 均被真实调用。AST outline、结构替换与替换后搜索成功。 |
| LSP diagnostics | **未通过，结果不确定** | 修复前存在真实 TS2322 类型错误，但 `lens_diagnostics source=lsp` 返回 0 diagnostics、`clean=0`、`inconclusive=1`，明确说明不能视为 clean。修复后结果相同。 |
| LSP navigation | **未通过** | definition、references、hover、documentSymbol 都完成调用，但全部返回 `status=empty` / `no-results`。工具接口存在，未取得任何语言服务结果。 |
| `lens_diagnostic_mark` | **未执行语义操作** | 工具成功注册并激活，但会话没有真实诊断标识；该工具要求精确诊断前置条件，测试没有伪造标识。 |

## 判定

模型侧没有“不会主动用工具”的问题。面对一个小型修复任务，它会先观察仓库、运行检查、使用结构化 Git/Verify、编辑并复验；在显式兼容性任务中也会使用能力发现并激活 Web 与子 Agent。

pi-lens 与其他工具的共存目前**有冲突**。冲突点不在注册：完整栈能看到所有 pi-lens 注册项。问题发生在活动集合：Harness 的 `setActiveTools` 将集合重置为自己的基础表，pi-lens 常驻工具和它自己的激活器因此都不会发送给模型。这也解释了为什么 `search_tools` 无法补救；当前能力目录没有 pi-lens manifest。

pi-lens 单独对照又发现第二个独立问题。去掉 Harness 后，项目索引、语法树、符号读取和 AST 替换工作正常，但 LSP 诊断为 inconclusive，所有导航为空。因此修复活动集合冲突后仍不能直接宣布 LSP 集成完成，还要查 TypeScript language server 的启动、文档打开/同步和首次请求时序。

`verify` 工具本身可调用，但其登录 shell 找不到 `node`，所以配置中使用普通 `node` 的契约测试失败；同一临时仓库在测试进程的明确 PATH 下最终检查通过。这个部署环境问题与 pi-lens 冲突分开处理。

## 建议顺序

1. 让 Harness 应用模式时保留其他已加载扩展声明的常驻工具，或把 pi-lens 做成正式能力 manifest，由 `search_tools` 激活；必须覆盖会话开始、模式切换、恢复和模型切换四条路径。
2. 增加完整栈测试，断言 pi-lens 常驻工具和 `pi_lens_activate_tools` 实际出现在下一次模型请求，而不只检查 registered。
3. 单独修复 TypeScript LSP 的功能探针：错误修改前应看到 TS2322，定义或引用至少返回一条；修复后诊断应消失。`inconclusive` 不能算通过。
4. 统一 User VM 的登录 shell PATH，使 `verify` 能找到部署使用的 Node；不要把本机绝对路径写入产品配置。

## 复现

```bash
npm run smoke:toolchain:real
```

仅重跑 pi-lens 对照并保留已有完整栈结果：

```bash
PI_COFFEE_REAL_SMOKE_SCOPE=lens-only node scripts/smoke-real-agent-toolchain.mjs
```

该命令会调用真实模型账号。固定响应、无真实模型费用的执行接线测试仍使用 `npm run smoke:toolchain`。
