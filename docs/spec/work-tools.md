# Work 工具设计与现有实现

状态：目标于 2026-09-21 更新，**运行时尚未迁移**。owner 在实际工具链测试后批准精简基础集合，并要求使用 Skill + CLI 的 LSP 中间层。2026-09-20 的原表继承决定已被本轮明确精简取代，已有执行器与按需发现架构继续复用。

## 已确认的目标集合

| 分组 | 常驻模型工具 | 理由 |
|---|---|---|
| 文件与执行 | `read`、`edit`、`write`、`bash` | 保留明确文件接口，Bash 承担通用执行 |
| Git | `git` | 保留结构化仓库操作；模型 schema 应只暴露已实现动作 |
| 能力发现 | `search_tools` | 发现与激活 Web、子 Agent |
| 恢复基础设施 | `recall_folded`（已注册且恢复可用时） | 按需读取折叠证据 |

基础 **6 个**，恢复扩展可用时通常 **7 个**。从 Work 模型工具表移除 `ls`、`grep`、`find`、`verify`；对应目录浏览、文本搜索、文件发现与项目验证通过 Bash 的实际命令完成，不再为这四个工具增加唤醒轮次。此处是工具暴露迁移，不是要求删除 Pi 内置实现或用户历史验证配置。

LSP 的定义/引用/类型信息由语义查询提供；Bash + rg 只承担文本检索，不能把所有同名匹配称为精确引用。

## 按需能力与 Skill

| 入口 | 目标行为 | 当前状态 |
|---|---|---|
| `search_tools` → Web | 搜索与必要网页内容读取按需使用 | 现有 `web` 与 `web-access` 分包；是否合包及信任/就绪策略仍待讨论 |
| `search_tools` → Subagent | 委派与等待按需使用 | 已有 `subagent` / `bg_wait`，保留其执行合同 |
| Pi 原生 `lsp` Skill → Bash CLI | 获取项目可用能力，执行诊断、定义、引用、类型与符号查询 | V1 CLI/Skill 与 TS/Python Profile 已实现并实测；不用 MCP，不新增 LSP 模型工具 |

Work 预先看见 LSP Skill 的名称、用途和真实路径，按需读取正文；语言服务器首次语义查询时启动并复用。能力摘要可见不等于服务器已经运行。LSP 不依赖 `search_tools` 激活，也不加载 pi-lens 原生 Pi 工具。

主系统提示词保持项目中立；实际 CLI 命令和 LSP 规则进入 Skill。常驻表删减时同步更新提示词中的 Verify 描述、工具相关测试和部署命令；当前正文没有因此悄悄改变。

## 当前代码事实

`src/harness/mode.ts` 与 `src/harness/extension.ts` 仍暴露原基础 10 项，恢复可用时通常为 11 项。兼容运行时与 Chat/Work 目标隔离尚未迁移；目标 6/7 项不能写作已发布。

| 已有能力 ID | 已注册工具 | 激活条件 |
|---|---|---|
| `web` | `web_search`、`research_seal` | 本地可信目录；首次执行检查搜索通路 |
| `web-access` | `fetch_content`、`source_check`、`get_search_content` | 依赖信任、runner conformance 等条件 |
| `subagent` | `subagent`、`bg_wait` | 现有适配器与本地 manifest |

发现只返回摘要，激活后工具 schema 在下一模型请求生效。`search_tools` 不承担 Skill 启动；Host 通过 Pi 原生 `--skill` 装配 `lsp`，Skill 经 Bash 调用已打包的 `coffee-lsp`。pi-lens 仍不是默认 LSP 后端。

## 迁移范围与待讨论事项

1. 调整 Work 工具表，保留已有恢复机制与 Web/子任务执行器。移除模型可见 Verify 时解释历史配置的迁移方式，不能直接删用户文件或改变历史证据。
2. Git schema 收紧到执行器实际支持的动作。checkpoint、undo、transfer、adopt 等占位动作不得继续误导模型；本轮只有设计结论，代码未改。
3. LSP CLI、原生 Skill 加载和默认不启用 pi-lens 已完成；仍需随 Chat/Work 装配迁移验证 Chat 不收到 Skill 元数据。
4. VM 需要可用 Bash、Git、rg、文件发现命令、Node 及语言服务器运行时。普通与登录 shell 的环境必须分别验证；不把本机临时绝对路径固化成部署约定。
5. Web 搜索/正文是否合包、委派研究默认策略、能力 schema 的生命周期与预算继续沿用 PA-Q01/04 讨论。本轮不扩大 Chat：其四个基础工具与搜索接口仍待明确。

## 实测证据与下一次验收

[固定响应接线探针](../reviews/toolchain-smoke-20260921.md)与[真实模型探针](../reviews/real-agent-toolchain-20260921.md)均针对原工具表。真实 `eidolon/gpt-5.6-terra` 会主动使用基础工具；Web 与子 Agent 发现/激活/调用有证据。pi-lens 原生工具 registered 但不 active；单独对照的 LSP 诊断不确定、导航为空，索引和 AST 能力可用。Verify 登录 shell 找不到 Node。不能把这些结果算作新工具集合或 LSP 中间层的验收。

新探针入口为 `npm run smoke:lsp-agent`；[结果](../reviews/lsp-agent-evaluation-20260921.md)记录 3 个 fixture × 3 次真实 `eidolon/gpt-5.6-terra` 运行，结果为 3/3、2/3、3/3。旧工具表探针仍是 `npm run smoke:toolchain` 与 `npm run smoke:toolchain:real`；它们不能代替尚未完成的精简工具表迁移。

本轮更新属于 PA-011/012 的设计记录。Gitea 不可连接，待同步相关工单；未修改或关闭远端状态。
