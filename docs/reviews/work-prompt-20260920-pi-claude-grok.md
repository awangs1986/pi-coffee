# Work 提示词三仓库交叉评审（Pi / Claude Code full / Grok Build）

日期：2026-09-20。范围：按 owner 要求，只评审并扩展通用 Work 软件开发系统提示词。目标是在 Pi 原生系统提示词基础上做加法，完善程度向 Claude Code 的完整默认提示词靠拢；遵循“宁缺毋错”，不迁移 Chat/Work 运行时、不新增工具、不改 Pi 内核。

本文是 dated review，不替代当前合同。持续规则仍由 [`docs/spec/harness-prompt.md`](../spec/harness-prompt.md) 和 [`docs/spec/pi-agent.md`](../spec/pi-agent.md) 维护。

## 1. 固定来源与实读文件

| 来源 | 固定版本 | 本次实际读取的系统提示词相关文件 | 用于学习的重点 |
|---|---|---|---|
| `earendil-works/pi` | `c596d09d9cef6fdf0db2dd08f3eec8582b7fe8ba` | `packages/coding-agent/src/core/system-prompt.ts`；`packages/coding-agent/src/core/tools/{read,write,edit,bash,powershell,grep,find,ls}.ts` 中的 `promptSnippet` / `promptGuidelines` | 原生 Base 的真实构成：`preamble` 身份、`<tools>` 仅列激活工具、`<rules>` 汇总工具 guideline 与内置简洁/路径、`<project_context>` 项目指导、Skills/文档指针、CWD |
| `claude-code-best/claude-code` | `77a7934e15d69da13879112ed7db695c9ee7a52a` | `src/constants/prompts.ts` 的 `getSimpleIntroSection`、`getSimpleSystemSection`、`getSimpleDoingTasksSection`、`getActionsSection`、`getUsingYourToolsSection`、`getSessionSpecificGuidanceSection`、`getOutputEfficiencySection`、`getSystemPrompt`；`src/constants/systemPromptSections.ts`；`src/utils/systemPrompt.ts` | **full 默认路径**，不是 `CLAUDE_CODE_SIMPLE` lean 路径：任务边界、行动授权、工具纪律、验证与报告、沟通规则、静态/动态分区缓存思路 |
| `xai-org/grok-build` | `4247f661689354b831191f11eeeac8424993fe3d` | `crates/codegen/xai-grok-agent/templates/prompt.md`、`apply_patch_prompt.md`、`subagent_prompt.md`；`src/prompt/{context,template}.rs` | 新一代 harness 的模板化取舍：dangerous_actions、work_policy、communication、background_tasks、browser_verification、AGENTS/project-instruction 规则、按工具存在性裁剪的正文 |

体量参考：Pi 的 `system-prompt.ts` 源码 9,427 字节（Base 动态生成）；Claude `prompts.ts` 55,483 字节但含大量动态/产品/工具常量，不能直接当最终提示词长度；Grok Build 基础模板 10,179 字节、apply-patch profile 21,360 字节、subagent 模板 4,918 字节。我们的 Work 正文从 6,185 → **8,794 UTF-8 字节 / 1,295 空白分词**，工程预算上调为 **9,000 字节**。这是仍然比 Grok 基础模板小得多的扩展，不是复制 Claude 全文。

## 2. 采纳的规则（都属于通用软件开发，不依赖我们未实现的工具）

| 采纳 | 主要参考 | 进入正文的位置 / 原因 |
|---|---|---|
| 用软件工程上下文解释请求；明确“改代码”的请求要定位并修改代码，而不是只回片段 | Claude `Doing tasks`；Grok `work_policy` | `Scope and execution`：避免模型对泛化请求只回答文本，也避免把问题/审查当实施授权 |
| 审查/诊断请求输出发现，且不顺手改文件 | Claude/Grok 的 review/report 边界；我们已有 WP-009 | 强化 WP-009：报告输出与实施授权分离 |
| 工作路径超出已加载项目指导时，检查额外项目指令文件；更局部指令在其范围内覆盖更宽指令；用户/治理指令覆盖项目文件 | Grok `project_instructions_spec` / `AGENTS.md spec`；Pi 已有 `<project_context>` | 只写“项目指令文件”的行为层级，不把项目文件名或本仓库路径写进通用正文（PA-010） |
| 显式需求保持可见直到完成、被用户取代或确实阻塞；阻塞要明说 | Grok `work_policy` | 防止长任务中静默丢掉用户明确要求 |
| 精确范围内外科手术式修改；开放/新任务可更主动但要说明假设、不过度镀金 | Grok apply-patch “Ambition vs. precision”；Claude “minimum complexity + finish line” | 与既有“最小完整”互补：开放任务不被过窄执行，精确任务不被扩大 |
| 安全边界：在边界验证不可信输入，避免 injection/XSS/secret exposure；发现相邻确认风险要报告但不顺手扩大 scope | Claude `Doing tasks` 安全段 | 保留通用安全底线；不添加安全产品/扫描器规则 |
| 已有专用工具优先于 shell 等价物；shell 工具保留给真正 shell 工作；引用未见过文件/符号先搜索再说未知 | Claude `Using your tools`；Pi 原生工具 guideline | 保留上一轮“专用工具优先”，补“先搜索再宣称未知”的判断规则 |
| 用户/权限控制拒绝工具调用后，不重复完全相同的调用；理解拒绝原因并调整或询问 | Claude `System`、Grok dangerous_actions | 防止把权限拒绝当成盲目重试信号 |
| 工具输出中关键事实在依赖前记录；大材料仍留 artifact；不生成或猜测 URL | Claude `summarize_tool_results` / intro URL 限制；Grok communication | 与上下文节制合并；不承诺无限上下文或自动恢复成功 |
| 验证从窄到广；UI 影响变化在接口可用时端到端验证；只修自己引入的回归，既有失败要区分并报告 | Claude/Grok validation、Grok browser_verification | 通用软件开发验证纪律；不指定浏览器工具名，不要求不可用的界面 |
| 授权边界具体化：删除/覆盖、force-push/reset shared history、移除/降级依赖、CI/权限、外部发布/上传；授权只覆盖声明范围 | Claude `Executing actions with care`；Grok `<dangerous_actions>` | 已在 WP-006 泛化授权原则，本轮补常见“难逆/共享/外传”清单和 scope 语义 |
| 面向不可见工具调用的沟通：用户看不到工具/内部笔记；非平凡动作前用用户语言说明；最终消息可独立阅读；能回答先回答；一次只问必要澄清；避免时间估算 | Claude `Communication style`；Grok `<communication>` | 与 Pi 原生“Be concise”不重复：这不是再说简洁，而是说清楚该选哪些信息给用户 |

## 3. 拒绝或延后（保持一致性，不照搬）

| 未采纳 | 理由 |
|---|---|
| Claude / Grok 的身份、产品名称、官方 CLI 表述、反馈通道、TUI/user-guide 指针、Slack/Gitea/Claude Code 专属命令 | 违反 PA-010；通用正文不能含特定产品身份或项目/服务路径。 |
| `SearchExtraTools` / `ExecuteExtraTool` / `TodoWrite` / `AskUserQuestion` / `apply_patch` / hashline / plan-tool 状态机 | SEPACC 我们没有这些工具或已定协议；正文仍只使用真实 `search_tools` 两步示例和当前工具契约（WP-002）。 |
| Claude “自动压缩意味着会话不受 context window 限制” | 会掩盖 owner 已指出的统计偏差与压缩失败；我们只保留“统计为估算、恢复有条件”。 |
| Claude/Grok 的 memory / skills / MCP / scratchpad / token_budget / proactive / coordinator / verification-agent 框架 | 依赖各自运行时和未确认的 Chat/Work、搜索/子 Agent/recall 分配（PA-Q04/Q05/Q06）；不通过提示词假装 framework 存在。 |
| Grok 的 sandbox/approval/background task/monitor 细则 | Pi/PI Coffee 的 VM 边界、权限和后台工具合同另有专项 SPEC；通用正文不硬编码不存在工具。 |
| 详细最终答案排版规则（header、bullet、行内代码、colon、emoji 等） | 大多属于 UI/输出风格或模型训练偏好；只保留“用户可读、最终消息可独立、引用文件时给 path 和 line”的通用最低规则。 |
| “非必要不创建文件”“默认不写注释”“不加版权头”“格式化最多重试 N 次”等细则 | 与不同代码库约定冲突风险高于收益；我们的正文已要求复用现有模式、少注释、最小完整。若有真实失败样例再按证据加。 |

## 4. 当前正文变化摘要

唯一正文仍为 [`src/harness/prompts/software-development.md`](../../src/harness/prompts/software-development.md)。本轮主要在既有 7 类结构内补可执行判断规则：

- `Scope and execution`：软件工程上下文、代码定位优先、项目指令作用域、显式需求保持、精确/开放范围比例、安全边界。
- `Tool use`：先搜索再称未知、工具/权限拒绝处理；保留真实 `search_tools` 示例。
- `Context discipline`：关键事实记录、不猜 URL、不承诺无限上下文。
- `Verification and user control`：窄到广验证、UI 端到端、无关失败处理、具体授权范围和 scope。
- `Communication`：面向不可见工具调用与中途离开的用户；最终消息独立；一次必要澄清；避免时间估算。

renderer、插件接缝、旧模式工具表和 Pi 包均未修改；Work 正文仍通过既有 `before_agent_start` 追加到 Pi Base，Chat/Work 运行时迁移不属于本轮实现。

## 5. 验证证据与限制

- 文档/规格同步：`docs/spec/harness-prompt.md` 修订 4 更新 WP 合同、工程预算、外部参考与 WP-AC13～15 待执行样例；`docs/index.md` 加入本评审入口。
- 文本合同：`npm test -- test/harness-prompt.test.ts` 通过，文件由 13 增至 **15 项**；新增断言覆盖软件工程上下文、项目指令范围、精确/广泛比例、安全边界、工具拒绝、先搜索再称未知、关键事实记录、不猜 URL、窄到广/UI 验证、授权 scope 和不可见工具调用沟通。项目中立守卫仍 0 命中，V3 合成缺陷仍能命中全部类别。
- 接缝：`npm test -- test/harness-extension.test.ts` 通过，`search_tools` 示例仍按真实 TypeBox schema 执行，重复注入幂等和动态状态未回归。
- 全量：`npm run check` 通过，**31 个测试文件 / 185 项测试**。
- 扩展 smoke：`npm run smoke:subagents`、`npm run smoke:web` 均 `ok: true`。
- 已知无害告警：构建时 `public/vendor-marked.js`、`public/vendor-purify.js` sourcemap ENOENT，未属于本轮引入。
- 未执行：真实 provider 模型行为评测、真实 Serper 搜索、浏览器端、目标 VM、Chat 零系统提示词 payload 抓取、跨 Pi 版本升级兼容验收。WP-AC04～15 只是行为样例定义，没有任何模型运行数据；文本/接缝通过不等于模型会照做。
- Gitea `testpc` 在当前环境 DNS 不可解析；Issue 同步、状态更新与关闭均未执行。
