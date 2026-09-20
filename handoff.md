# Handoff — Work 系统提示词与 Pi Agent 规格

生成时间：2026-09-20 · 分支 `arena/01a0bb30-pi-coffee` · 基线提交 `ff0c6ed055503bdd18a4ce0e50a1da35586bdce4`

> 本文件按 `mattpocock/skills@c55ee46` 的 `skills/productivity/handoff` 技能格式生成。该技能默认写入系统临时目录；本次按 owner 明确要求改为随分支提交，仓库内路径为 `handoff.md`。其余约定（引用已有产物、不重复正文、含 suggested skills、脱敏）均遵守。
>
> **交接焦点：系统提示词是未完成工作。** 下一会话最重要的任务是行为验证与模式迁移，不是继续润色文案。

---

## 1. 一句话现状

Work 正文（`src/harness/prompts/software-development.md`）已按 owner 指定的 **Pi 源码 + Claude Code full + Grok Build** 三仓库交叉参考扩展到 8,794 字节，并通过更新后的文本契约/接缝/全量测试与 smoke；**但它仍只被证明"写对了"和"接得上"，从未被证明"模型会照做"，且 Chat/Work 两个模式在产品层面根本还没有实现。**

## 2. 本会话做了什么（细节见引用文档，此处不重复）

| 产物 | 路径 |
|---|---|
| Pi Agent 主 SPEC（PA-001..010、PA-Q01..06、PA-AC01..09、决策沿革） | `docs/spec/pi-agent.md` |
| 对照评审（Claude Code 与 Codex 两份参照、采纳/拒绝清单、限制） | `docs/reviews/work-prompt-20260920.md` |
| 三仓库交叉评审（Pi 源码、Claude Code full、Grok Build；采纳/拒绝、证据与限制） | `docs/reviews/work-prompt-20260920-pi-claude-grok.md` |
| Work 提示词 SPEC（WP-001..010、预算 9,000、WP-AC01..15、外部参考与沿革） | `docs/spec/harness-prompt.md` |
| 正文本体（8,794 字节 / 1,295 词，预算上限 9,000） | `src/harness/prompts/software-development.md` |
| renderer（`work` 为默认，旧名保留兼容） | `src/harness/prompt.ts` |
| 契约测试（含项目中立守卫 + 正向对照、三仓库扩展规则断言） | `test/harness-prompt.test.ts`、`test/harness-extension.test.ts` |

本会话确认的四条设计原则：**插件扩展并保留 Pi 升级能力（PA-001）**、**只有 Chat/Work 两个模式且 Chat 连原生系统提示词都不要（PA-002/003）**、**在 Pi 原生提示词上做适量加法而非重写（PA-009）**、**通用正文必须项目中立（PA-010）**。

关键事实：Pi 原生 `buildSystemPrompt` 已提供身份、激活工具列表（含 `promptSnippet`）、Guidelines（含各工具 `promptGuidelines` + 简洁/列路径）、`<project_context>` 项目指令。**新增规则前必须先读原生内容，重复即视为"多"。**

## 3. 未完成工作（按优先级）

### 3.1 系统提示词：只做了文本层，行为层空白 ⚠️

- **WP-AC04～15 一条都没跑。** 十二个行为样例（范围判断/项目指令、工具发现与拒绝、失败处置、上下文节制、验证真实性、授权边界、审查报告方式、意外状态、收尾、UI 端到端与独立最终消息）已在 SPEC 中定义，**没有任何真实模型数据**。
- **测试通过 ≠ 提示词有效。** `test/harness-prompt.test.ts` 是字符串断言，`test/harness-extension.test.ts` 是 FakePi 接线测试；刚完成的三仓库扩展只证明正文按参考补齐了文本规则。真实结论只能来自：同一模型、同一工具、同一仓库初态下跑任务，记录实际工具序列/修改/验证结果，并统计**违反**（规则被打破）与**无效**（规则从未触发）两类。
- **"无效"清单是删减依据。** owner 的原则是"宁缺毋错"：跑完应产出一张"该加哪条、该删哪条"的清单，而不是继续加规则。
- **不要在没有证据前继续扩写正文。** 预算上限已从 6,400 上调到 9,000，是因为 owner 明确要求按 Pi/Claude/Grok 三仓库扩充；再次上调需要新的失败样例或明确的新缺口。

### 3.2 Chat 模式：产品设计已定，实现为零

- 需要**完全不向 provider 发送任何系统指令**（连 Pi 原生 Base 都不要），且只有 4 个基础工具 + Web 搜索。
- 当前代码是旧 `simple`/`lean`/`full` 接线，`before_agent_start` 会把 Work 正文追加到 Pi Base；**旧 `simple` 不等于 Chat**。
- 验收方法写在 `docs/spec/pi-agent.md` PA-AC03：必须抓取**发送前的真实 provider 请求**，覆盖新建/恢复/切模型/插件加载；不能只测 renderer 返回空串。注意 Pi 的 `--system-prompt` 是**整体替换**（PA-Q02 未决）。
- 工具 schema 与系统提示词是不同输入，不要为"零提示词"删掉工具定义。

### 3.3 待确认项（owner 未拍板，不得自行补全）

- **PA-Q01**：Chat 的 4 个基础工具确切名称；Work 约 11 个工具的完整名单。**不要为凑数增加工具，也不要把旧 9/11 当目标。**
- **PA-Q02**：Work 正文替换还是追加 Pi Base。
- **PA-Q03**：模式默认值、切换入口、持久化字段、旧会话/旧命令迁移。
- **PA-Q04**：现有搜索/子 Agent/`recall_folded` 策略如何分配到两个模式。
- **PA-Q05**：上下文统计的 provider 数据来源、误差容限、触发阈值、媒体计量。
- **PA-Q06**：哪些规则该下沉为工具的 `promptGuidelines`（随工具激活才出现），哪些留在正文。

### 3.4 上下文问题：仅部分缓解，未解决

owner 的原始痛点（几轮就满、统计与实际占用偏差、不该进上下文的内容进了上下文）**没有被本会话修复**。现有保护（入口 12000 字节归档、短搜索摘要、context-fold、最终 payload 保守估算）是既有实现，属于"已实现基线"，不是"问题已解决"。领域文档：`docs/spec/context-recovery.md`，验收：`docs/spec/pi-agent.md` PA-AC06。

## 4. 下一会话建议顺序

1. **先读** `docs/spec/pi-agent.md` 与 `docs/spec/harness-prompt.md`（这是当前权威），再读 `docs/reviews/work-prompt-20260920-pi-claude-grok.md` 与 `docs/reviews/work-prompt-20260920.md` 了解取舍理由。
2. **跑 WP-AC04～15 行为样例**，产出一份带真实工具序列的证据文件；据此得出增删清单。这是唯一能把"结构对齐"变成"实际好用"的动作。
3. **再与 owner 确认 PA-Q01/Q02**（工具名单 + 替换/追加），然后才动手做 Chat/Work 运行时迁移。
4. 迁移必须先在公共 seam 写失败测试（仓库规则：red → green，`npm run check`）。

## 5. 坑与约束

- **不要**把旧 `simple` 当 Chat，或把旧 `full` 当 Work；不要在提示词改动里顺手迁移模式，也不要在迁移里偷偷删除旧数据。
- **不要**把项目专属内容（本产品名称、本仓库路径/命令、工单/ADR 编号、前端偏好）写进通用正文——这正是 V3 的历史缺陷。已有类别级守卫与正向对照测试；改名不能绕过。
- **不要**照搬 Codex 的 `update_plan`/apply_patch/输出格式细则（我们没那些工具），也不要把 Codex 的 Frontend 设计规则写进通用正文（应进项目 AGENTS.md）。
- **不要**把测试通过或 stub 通过当作模型质量或部署验收；不要在文档里写"已验收"。
- **不要**在没有 owner 确认的情况下把未决项写成决定。
- 参考的第三方提示词文本抓在 `.scratch/`（已被 `.gitignore` 忽略，**不在提交里**）。需要时按第 7 节 SHA 重新获取，勿另找版本。
- 内网 Gitea（`testpc:3000`）在当前沙箱**DNS 不可解析**，本会话所有 Issue 同步、状态更新、关闭动作**均未执行**，属待办。
- 已知无害告警：构建时 `public/vendor-marked.js`、`public/vendor-purify.js` 的 sourcemap ENOENT。

## 6. 验证状态（精确表述）

- 已执行：`npm test -- test/harness-prompt.test.ts`（15 项）与 `npm test -- test/harness-extension.test.ts`（10 项）通过；`npm run check` 通过，**31 个测试文件 / 185 项测试**；`npm run smoke:subagents`、`npm run smoke:web` 均为 `ok: true`。
- 未执行：真实供应商模型调用、真实 Serper 搜索、浏览器端、目标部署 VM（单机与双 VM 均未做）、Chat 零系统提示词的 payload 抓取、跨 Pi 版本升级兼容验收。
- 覆盖范围：本地集成测试使用**真实 Pi CLI/子进程**配合**本地假模型/Relay 服务**，因此不等同于线上行为。
- 提示词行为质量：**零数据**。三仓库交叉评审是源码/模板级证据，不是模型行为 A/B。

## 7. 外部参照（复现用）

| 参照 | 版本 | 取用方式 |
|---|---|---|
| Pi 原生系统提示词（源码） | `earendil-works/pi@c596d09d9cef6fdf0db2dd08f3eec8582b7fe8ba` | `packages/coding-agent/src/core/system-prompt.ts` 及 `core/tools/*/promptSnippet`、`promptGuidelines` |
| Pi 原生系统提示词（安装包） | `@earendil-works/pi-coding-agent@0.84.4` | 从安装包编译产物中的 `buildSystemPrompt` 提取（非 Markdown 源）；与源码证据分开标注 |
| `openai/codex` | `5ee2bdf1e0e04064bc427ae31a49a01e8f7064df` | `codex-rs/core/gpt-5.2-codex_prompt.md`（7,589 B）、`gpt_5_codex_prompt.md`（6,647 B）、`gpt_5_2_prompt.md`（21,652 B） |
| `claude-code-best/claude-code` | `77a7934e15d69da13879112ed7db695c9ee7a52a` | `src/constants/prompts.ts`、`systemPromptSections.ts`、`utils/systemPrompt.ts`；早轮另读 `packages/builtin-tools/src/tools/**/prompt.ts` |
| `xai-org/grok-build` | `4247f661689354b831191f11eeeac8424993fe3d` | `crates/codegen/xai-grok-agent/templates/{prompt,apply_patch_prompt,subagent_prompt}.md`、`src/prompt/{context,template}.rs` |
| handoff 技能模板 | `mattpocock/skills@c55ee46073ed923f86ce59a5eb3b6d895095d1b7` | `skills/productivity/handoff/SKILL.md` |

`claude-code-best/claude-code` 与 `xai-org/grok-build` 是第三方/公开重建性质，不等同官方最新部署；Pi 源码和当前安装包版本也可能不同。本会话只在源码/模板层对照，未运行这些参考产品或真实模型。

## 8. Suggested skills

若下一会话运行在带 Skill 工具的环境，建议按序调用：

1. **`productivity/handoff`**（本次模板）— 会话结束时再次生成交接，保持 `handoff.md` 新鲜。
2. **`productivity/pr-description`（如存在同类技能）** — 若要把本分支开成 PR，用它生成 PR 描述；本分支已按仓库习惯写好中文 conventional commit，可直接复用。
3. 行为评测若无现成技能，按 `docs/spec/harness-prompt.md` 的 WP-AC 表格手工执行即可——**不要**为此发明新的技能或工具，owner 的"非必要不增加"同样约束流程。

> 注：本仓库是 PI Coffee 自身，未安装 Pi 的 Skill 扩展；上述技能是给**外部 agent 会话**（如 Arena/Claude Code/Codex）使用的建议，不代表仓库运行时依赖。
