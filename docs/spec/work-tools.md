> Repository placement: [ADR-0021](../adr/0021-pi-only-source-authority.md). This package owns Pi behavior; Host/Web integration belongs to the Server consumer. Historical branch evidence is not current-main acceptance.

# Work 工具设计与现有实现

状态：2026-09-22 已完成运行时迁移。owner 在实际工具链测试后批准精简基础集合，并要求使用 Skill + CLI 的 LSP 中间层。2026-09-20 的原表继承决定已被本轮明确精简取代，已有执行器与按需发现架构继续复用。

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

主系统提示词保持项目中立；实际 CLI 命令和 LSP 规则进入 Skill。常驻表删减已同步更新提示词、工具测试与探针；当前正文已改为通过 Bash 执行项目验证。

## 当前代码事实

`src/harness/mode.ts` 与 `src/harness/extension.ts` 只提供 Chat/Work。Work 为上述 6/7 项；Chat 为 read、edit、write、bash、web_search 五项，没有 recall、能力发现或自动 Skill 元数据。真实 Pi 请求测试覆盖切换、模型变更和进程恢复。

| 已有能力 ID | 已注册工具 | 激活条件 |
|---|---|---|
| `web` | `web_search`、`research_seal` | 本地可信目录；首次执行检查搜索通路 |
| `web-access` | `fetch_content`、`source_check`、`get_search_content` | 依赖信任、runner conformance 等条件 |
| `subagent` | `subagent`、`bg_wait` | 现有适配器与本地 manifest |

发现只返回摘要，激活后工具 schema 在下一模型请求生效。`search_tools` 不承担 Skill 启动；Host 通过 Pi 原生 `--skill` 装配 `lsp`，Skill 经 Bash 调用已打包的 `coffee-lsp`。pi-lens 仍不是默认 LSP 后端。

## 迁移范围与待讨论事项

1. Work 工具表已迁移；不再注册模型 Verify 工具。用户显式 `/verify` 命令与历史配置继续可用，旧文件和验证记录不会删除。
2. Git schema 收紧到执行器实际支持的动作。checkpoint、undo、transfer、adopt 等占位动作不得继续误导模型；本轮只有设计结论，代码未改。
3. LSP CLI、原生 Skill 加载和默认不启用 pi-lens 已完成；Chat 不收到自动 Skill 元数据已在真实 Pi 请求中验证。
4. VM 需要可用 Bash、Git、rg、文件发现命令、Node 及语言服务器运行时。普通与登录 shell 的环境必须分别验证；不把本机临时绝对路径固化成部署约定。
5. Web 与网页内容仍分包。Chat 直接搜索；Work 延续已有研究委派策略，delegate=false 直接搜索。激活能力仅在 Work 的下一请求生效；切换模式或模型会撤销。

## 实测证据与下一次验收

[固定响应接线探针](https://github.com/awangs1986/pi-coffee-server/blob/112ef53a0e2b04bd9d7cf283faa04754bc84c9ab/docs/reviews/toolchain-smoke-20260921.md)与[真实模型探针](https://github.com/awangs1986/pi-coffee-server/blob/112ef53a0e2b04bd9d7cf283faa04754bc84c9ab/docs/reviews/real-agent-toolchain-20260921.md)均针对原工具表。真实 `eidolon/gpt-5.6-terra` 会主动使用基础工具；Web 与子 Agent 发现/激活/调用有证据。pi-lens 原生工具 registered 但不 active；单独对照的 LSP 诊断不确定、导航为空，索引和 AST 能力可用。Verify 登录 shell 找不到 Node。不能把这些结果算作新工具集合或 LSP 中间层的验收。

新探针入口为 `npm run smoke:lsp-agent`；[结果](https://github.com/awangs1986/pi-coffee-server/blob/112ef53a0e2b04bd9d7cf283faa04754bc84c9ab/docs/reviews/lsp-agent-evaluation-20260921.md)记录 3 个 fixture × 3 次真实 `eidolon/gpt-5.6-terra` 运行，结果为 3/3、2/3、3/3。已更新到当前工具表的探针是 `npm run smoke:toolchain` 与 `npm run smoke:toolchain:real`；固定响应探针验证工具执行与隔离，真实模型探针用于自主发现评测。

本轮迁移证据见[验收记录](https://github.com/awangs1986/pi-coffee-server/blob/112ef53a0e2b04bd9d7cf283faa04754bc84c9ab/docs/reviews/chat-work-migration-20260922.md)。既有真实模型报告仍只证明报告所列版本。
