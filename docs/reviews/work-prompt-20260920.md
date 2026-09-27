# Work 提示词源码对照与改进

日期：2026-09-20。范围：评审并修改现有 Work 软件开发提示词；不迁移 Chat/Work 运行时、不新增工具、不改 Pi 内核，也不读取 V3 代码。

**两份外部参照**：第一轮 `claude-code-best/claude-code` @ `77a7934e`（第 1–7 节），第二轮 `openai/codex` @ `5ee2bdf1` 并加取 Pi 原生提示词（第 8 节）。体量、采纳/拒绝清单、减法与限制见第 8 节。

## 1. 对照依据：实际源码，而非只读 SPEC

本地旧正文：`bcd2a655446c85b87a76a355da02247c5a15cdf5:src/harness/prompts/software-development.md`。同时检查 renderer、Harness 注入、`search_tools` schema/执行器、搜索和子任务工具说明，确认改写不会教模型调用不存在的 API。

外部依据固定为 owner 指定的第三方仓库 `claude-code-best/claude-code`，提交 **`77a7934e15d69da13879112ed7db695c9ee7a52a`**。这是该仓库的实现参考，**不能等同于 Anthropic 官方最新部署的完整提示词**；本次也没有做 Codex 源码审计。

实际阅读的核心源码：

- [任务、行动边界、工具策略与沟通正文](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/constants/prompts.ts#L175-L415)：`getSimpleDoingTasksSection`、`getActionsSection`、`getUsingYourToolsSection`、`getSessionSpecificGuidanceSection`、`getOutputEfficiencySection`。
- [静态/动态段组装](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/constants/prompts.ts#L423-L542)、[段缓存](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/constants/systemPromptSections.ts)及[最终提示词选择](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/systemPrompt.ts)。
- [工具发现的两步调用说明](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/prompt.ts#L9-L60)。它使用 `SearchExtraTools → ExecuteExtraTool`，**不是**本项目的激活协议。
- [Read](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/FileReadTool/prompt.ts)、[Edit](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/FileEditTool/prompt.ts)、[Grep](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/GrepTool/prompt.ts) 的工具专属说明。参数/限制放在工具侧，而不是把全部说明复制进主提示词。

没有运行参考仓库，也没有将其源码或完整提示词作为项目依赖导入。本地正文是结合现有 Pi 工具契约重新编写的规则。

## 2. 结论：骨架好，欠缺的是可执行的判断规则

原版已经有先读后改、最小完整修改、动态能力发现、证据落盘、定向 recall、验证和用户授权等正确方向。**不需要推倒重写，更不应靠增加工具数量来追赶参考实现。** 与参考相比，薄弱点是若干重要规则只说了原则，没有说清下一步动作和失败边界。

| 维度 | 原版与参考的差异 | 本次改动 |
|---|---|---|
| 范围与执行 | 原版要求最小完整修改；参考更明确地区分解释和执行、避免未读代码就提方案 | 保留分析不授权实施；实施请求不能停在建议/计划，做到相关验证；复杂任务短计划，小任务不走仪式 |
| 工具怎么调用 | 原版只有“使用真实 schema”和“搜索→激活”；参考的发现工具给了具体参数与顺序 | 明确活动 schema 才是权威；给出本地 `search_tools` 的两个真实 JSON 调用，发现不等于激活，下次请求出现 schema 才调用；不复制参考工具名/字段 |
| 失败后怎么办 | 原版主要是“不盲目重试”；参考强调先诊断，不马上放弃，也不强行绕过限制 | 参数错误先核对 schema；超时/部分执行先检查状态，避免重复副作用；禁止静默换账户/供应商 |
| 上下文 | 原版已有短摘要、artifact、recall；参考也隔离子任务输出，但有不适合此产品的无限上下文承诺 | 明确“请求输出前限量”、复用已知证据、按剩余问题扩展；截断预览不是完整证据；统计是估算，不能把自动恢复当成保证 |
| 委派 | 原版把旧模式名、3/5 并发和模型政策写进固定正文；参考一部分指导按能力动态装配 | 固定正文只保留可用/被允许时才委派、不重复搜索、小任务输入/短结果、完成后消费证据；队列/模型/配额仍由工具和运行时决定 |
| 验证质量 | 原版要求运行测试和检查 diff；参考明确禁止制造绿色、把未运行检查说成成功 | 增加不弱化检查、区分旧失败/环境阻塞/新回归，单测不代表端到端，子任务自报完成不等于验证 |
| 授权与安全 | 原版列举禁止动作；参考按可逆性、影响范围和已有授权判断 | 已授权的可逆本地工作直接做；破坏性/发布/共享状态/外传数据按范围确认；不删除锁或绕过检查来消除阻塞 |
| 收尾与克制 | 原版要求简洁沟通；参考对工作进度与结果报告更具体 | 保留关键进展、真实结果和路径；请求完成即停，不追加无关工作或强制报告 |

对“优秀”的判断限定为结构与可操作性：原版是合格骨架，新版补齐了更明确的执行约束。**尚无同模型、同任务的 A/B 证据，不能声称实际能力已经媲美 Codex 或 Claude。**

## 3. 有意不照搬

1. 不写 Claude 身份、特定 CLI/供应商、`TodoWrite`、`AskUserQuestion`、规划模式、代理执行器等不存在的能力；不为支持参考提示词新增任何工具。
2. 不复制参考的“自动摘要使上下文无限/不受窗口限制”表述（参考 `prompts.ts` 第 133、195 行）。这会掩盖 owner 已遇到的统计偏差和压缩失败。
3. 不移植参考的缓存框架、权限内核、强制独立审核 Agent、自动持续运行或最低 token 消耗目标。现有 Pi 公开插件接缝足够承载本次改动。
4. 不在稳定正文硬编码模式工具数量、3/5 名额或完整 schema。也不把原生基础工具的详细参数复制成另一份可能随 Pi 升级过期的手册。
5. 不把所有工具结果重新复述到对话来“防丢”；只保留必要结论与证据路径。实际工具结果裁剪、token 统计和 compaction 触发属于运行时工作，不靠一句提示词宣称已修复。

## 4. 改动范围与体积

- 修改唯一正文 `src/harness/prompts/software-development.md`。
- renderer 增加明确的 `work` 名称并作为默认；旧调用名仅保留兼容。Harness 改为明确读取 `work`，其工具表和模式路由不变。
- 继续通过 `before_agent_start` 注入，保留现有去重与动态状态分离；没有修改 Pi 包或依赖，也没有新增工具/hook。
- 第一轮后渲染正文从 **4,803 → 5,945 UTF-8 字节**，空白分词 **706 → 853**（+1,142，约 23.8%）；第二轮加减法后为 **6,185 字节 / 892 词**，测试上限 6,400 字节。这是字节/词数，不冒充精确 token 计数；不包含 Pi Base、schema、项目指令和历史。
- 已记录 Chat 必须连 Pi 默认系统提示词都移除；**没有实现或验证 Chat 零 system payload**。此检出版本仍向所有旧 Harness 模式注入正文，不能把它当成已经完成的 Chat/Work 产品切换。

## 5. 验证证据与限制

- Red：先补正文合同和可执行调用示例测试，运行两个 Harness 测试文件；旧实现 **7 项失败、12 项通过**，失败涵盖旧模式文案、缺失的具体约束与缺少工具调用示例。
- Green：修改后相同两个文件 **19 项通过**。正文中的两次 `search_tools` 调用被实际提取、通过工具自己的 TypeBox schema 检查并执行；搜索不激活，激活后返回 next-model-request。测试也检查重复注入幂等、保留 Base、动态状态更新和无新增工具。
- 全量 `npm run check`：TypeScript 构建成功，**31 个文件、179 项测试通过**；`npm run smoke:subagents` 与 `npm run smoke:web` 均为 `ok: true`。测试含真实 Pi CLI/子进程配合本地假模型/Relay 的协议验证，不是商业模型质量评测。
- 构建正文与源 Markdown 逐字节一致；`git diff --check` 通过。仍有基线已有的 `marked` / `dompurify` vendor sourcemap 缺失警告，不影响本轮检查结果；未顺带修改前端构建。
- 内容匹配测试只能防止提示词合同漂移；FakePi 测试验证接线/调用协议，不验证模型是否遵守规则。没有使用真实供应商、收费模型或 Serper 做行为评测。
- Gitea `testpc` DNS 不可解析；Issue 未读取成功、未更新、未关闭。此次以 owner 明确授权的提示词改动为范围，不宣称外部验收完成。

## 6. 后续验收的维护位置

本次评审提出的行为场景已整理到 [Work SPEC 的 WP-AC04～10](../spec/harness-prompt.md)，由该规格持续维护；当次状态仍是**模型行为尚未评测**，不因移动文档变为通过。

Agent 设计、Chat 零系统提示词、模式迁移、上下文计量与工具清单见 [Pi Agent 主 SPEC](../spec/pi-agent.md)。本评审保留来源、比较理由和当次运行证据，不单独维护另一套当前规则。

## 7. 同日 SPEC 维护轮证据

owner 要求讨论和修改留下可维护的 SPEC。本轮只整理文档，不再次修改功能代码：

- 建立 `docs/spec/pi-agent.md` 固定主入口；将 Work 合同整理为 WP 规则与验收样例，模式/工具待定项归 PA-Q。
- 更新 AGENTS 与开发工作流，修正 README/CONTEXT/BACKLOG/文档索引及相关专项 SPEC 的旧模式冲突；历史切片标注替代关系，不伪造当时状态。
- 检查 17 个累计变更 Markdown 文件的本地链接、PA/WP 规则/验收编号与主入口；Markdown 表格解析通过，`git diff --check` 通过。
- 文档整理前后对 `src/harness/{extension,prompt}.ts`、正文和两个 Harness 测试做 SHA-256 比对，一致；此次没有新增工具或运行时行为。
- 重新运行 `npm run check`：构建成功，31 个测试文件、179 项通过；仍有已知 vendor sourcemap 警告。本轮未重复运行两个 smoke，其证据仍为上方提示词实现轮，未冒充新的模型或部署验收。
- Gitea 再次探测仍为 DNS 不可解析，未读取/更新/关闭 Issue；相关同步明确待办。

## 8. Codex 交叉对照（同日第二轮）

第一轮对照的是 `claude-code-best/claude-code`；本轮按 owner 指定补充 `openai/codex`，并把 Pi 的**真实原生系统提示词**一并取出比较。Pi 原生正文不在仓库里以 Markdown 形式存在，是从已安装的 `@earendil-works/pi-coding-agent@0.84.4` 编译产物中的 `buildSystemPrompt` 提取的。

### 8.1 三份参照的实际体量与结构

| 来源 | 版本 | 体量 | 结构特点 |
|---|---|---|---|
| **Pi 原生**（我们的底座） | 0.84.4 编译产物 | 模板本体很短 | 身份 + `Available tools`（仅激活工具，逐条取 `promptSnippet`）+ `Guidelines`（各工具 `promptGuidelines` + 内置“简洁”“列路径”）+ `<project_context>` 项目指令 + Skills/文档指针/CWD |
| **Codex** `gpt-5.2-codex_prompt.md` | `5ee2bdf1` | 80 行 / 7,589 字节 | 面向编程模型，条目式：General、Editing constraints、Plan tool、Special user requests、Frontend tasks、Presenting your work |
| **Codex** `gpt_5_codex_prompt.md` | `5ee2bdf1` | 68 行 / 6,647 字节 | 同上更短版本 |
| **Codex** `gpt_5_2_prompt.md` | `5ee2bdf1` | 298 行 / 21,652 字节 | 面向通用 GPT-5.2，含 Personality、AGENTS.md spec、Autonomy and Persistence、Planning（含样例）、Validating your work、Tool Guidelines |
| 我们的 Work 正文（修订 3） | 工作区 | 6,185 字节 | 7 类行为规则 + 工具发现示例 |

**关键数据**：Codex 面向**编程专用模型**的提示词与我们同一量级（6.6k–7.6k 字节），而它面向通用模型的那份大 3 倍以上。这说明体积由“模型已内化的程度 + harness 承担多少”决定，不是越大越好——支持 owner 的“宁少勿错”。

### 8.2 采纳：加法（有明确缺口）

| 新增 | 依据 | 为什么属于通用软件开发 |
|---|---|---|
| WP-009 审查/诊断的报告方式（先列缺陷、按严重度、带文件与行号、区分已确认与待确认、无缺陷明说） | Codex `Special user requests` 明确规定 review 心智与输出顺序；我们此前只有“审查不授权改动”，没有“审查怎么产出” | 任何项目都需要的产出契约；且与我们既有的“不授权实施”正好配对 |
| WP-010 他人工作与意外状态（不认识的改动/异常状态先调查再问，删除/回滚/覆盖前确认） | Codex `Editing constraints` 的 dirty worktree 与“发现非自己造成的改动立即停并询问”；我们此前只覆盖“保留无关工作”和破坏性操作授权，缺少触发条件 | 误删用户进行中的工作是通用事故；靠行为约束即可，无需新增机制 |
| 优先专用工具而非等价 shell 命令 | Claude Code `Using your tools` 明确要求；Pi 原生 Guidelines 未覆盖 | 防止用 `cat`/`sed` 绕过结构化工具，属通用工具纪律 |
| 工具发现示例（上一轮已加，本轮保留） | Pi 原生只列工具名与用途，未说明发现→激活的两步顺序 | 直接对应 owner 提出的“LLM 不知道怎么调用工具” |

### 8.3 拒绝或延后：不照搬

| 未采纳 | 理由 |
|---|---|
| Codex 的 `Frontend tasks`（字体、配色、避免“AI slop”） | 属于**项目/产品偏好**。按 PA-010，这类内容应进项目 AGENTS.md，而不是通用正文；写进正文等于重演 V3 的“把特定项目的事写进通用提示词” |
| Codex 的 `update_plan` 工具细则（状态机、一次一个 in_progress、禁止跳级） | 我们**没有**该工具；Pi 原生也没有规划工具。写规则会让模型引用不存在的机制（PA-005/007） |
| Codex 的 apply_patch / ASCII 默认 / 输出格式细则（头部、bullet 数、文件引用语法） | 依赖其 CLI 与模型训练；我们的渲染层与 Pi 工具契约不同。格式类偏好等有真实失败样例再谈 |
| Codex 的 Personality 与 `AGENTS.md` 优先级长文 | Pi 已通过 `<project_context>` 注入项目指令并标注路径；重复写一遍即为“多” |

### 8.4 同时执行的减法（因为原生已经说了）

| 删除 | 原生已在何处覆盖 |
|---|---|
| “give brief updates … not a narration of every tool call”“avoid repeated logs” | 原生 Guidelines：`Be concise in your responses`（保留不重复的“里程碑式进展”语义） |
| “Include relevant paths or sources” | 原生 Guidelines：`Show file paths clearly when working with files`（改为只保留“外部来源需引用”） |
| 逐工具用途枚举“read for content, ls/find for navigation…” | 原生 `Available tools` 已按激活工具逐条给出用途 |

净结果：**5,945 → 6,185 字节（+240）**，即新增 3 条规则 + 删除 3 处重复，而不是单纯 +400 以上。

### 8.5 本轮验证与限制

- 红→绿：6 条新规则在改前正文中全部不存在（对 `HEAD` 版本逐条断言为 False）；修改后 `test/harness-prompt.test.ts` 由 9 项增至 13 项通过。
- 项目中立守卫：真实正文 0 命中；合成 V3 式正文 4 类全部命中，证明守卫非空转。
- 仍未执行：WP-AC11/12（审查质量、意外状态）等模型行为样例；Codex 提示词**没有**在任何真实运行中做过 A/B，本轮只是源码级对照。
- `openai/codex` 固定 `5ee2bdf1e0e04064bc427ae31a49a01e8f7064df`；`gpt_5_2_prompt.md` 等仅为仓库中对应模型的模板，真实部署可能另行组合或裁剪。
