# PI Coffee `/harness` 提示词审查

日期：2026-09-02  
范围：V3 提示词来源与内容、V5 harness 状态模型、PI Coffee 的“提示词 + 工具”目标

## 结论

V3 的提示词内容可以作为 PI Coffee 的行为基线，但不能把它标注为“已由 Claude Code 官方资料证明的逐字提取”。当前仓库证据只证明它是由 Picode 作者维护的本地提示词增量：文件在 V3 的提交 `98247db` 中作为新文件加入，`git blame` 的原始行作者为 `awangs`；V3 自己的设计文档还明确禁止复制其他产品的未授权提示词正文。

因此本项目采用以下 provenance 标签：

> **本地衍生/适配文本；与 Claude Code 的部分公开行为模式相符；逐字来源未验证。**

“确保和 V3 一样”在 PI Coffee 中应解释为：保留 V3 已验证的行为语义和提示词结构，保留可复用的文字；不继承 V3 已不存在的 sandbox、Guard、权限审批、VM 管理器或 Devloop 强制能力，也不声称拥有 Claude Code 的私有系统提示词。

## 已检查的本地证据

| 来源 | 观察 | 结论 |
|---|---|---|
| `v3/prompts/harness-core.md` | 33 行；标准/Lean 行为增量；包含工具使用纪律、范围、谨慎操作和诚实报告 | 可复用，但“permission mode”和 Windows sandbox provider 与 PI Coffee 执行模型冲突 |
| `v3/prompts/tdd-core.md` | 66 行；Context authority、最小切片、TDD RED/GREEN、验证预算、Git 和报告规则 | 可复用指导语义；不能宣称 PI Coffee 已实现 Devloop Gate/Completion Label |
| `v3/src/extension/prompts.ts` | 通过占位符映射工具名、移除作者 HTML 注释，并在 `before_agent_start` 适配层注入 | 这是移植实现可参考的机制，不是 Claude Code 来源证明 |
| `v3/PICODE-HARNESS-PROMPT-DESIGN.md` | 定义 Pi Base Prompt + Picode delta；明确“不复制 Claude Code…未授权提示词正文” | 直接否定“V3 是官方原文逐字副本”的可验证说法 |
| `V5/src/engine/harness-mode.ts` | `simple/full` harness axis，verification profile 独立；工具集合按 mode 计算；状态由 `ProductStateStore` 持久化 | PI Coffee 应采用该状态/组合思路，但去掉执行性 permission/sandbox axis |
| `V5/extensions/harness.ts` | `/harness`、`setActiveTools`、`search_tools`、session 恢复和 custom entry | 可参考命令、工具 profile 和原生 Pi session seam；不移植 Guard/TDD enforcement |

V3 `harness-core.md` 的实际正文包含以下与 PI Coffee 兼容的核心语义：

- Pi 原生工具优先，读文件与列目录区分；独立调用可并行、依赖调用保持顺序。
- 修改应遵循现有文件风格、尽量小范围，不暗中扩大范围。
- 问题、审查、诊断本身不授权实现。
- 检查目标、在不可逆/共享/外向动作前确认，并诚实报告实际验证结果。

这些语义应保留。以下语义必须在 PI Coffee 版本删除或改写：

- “工具运行在用户选择的 permission mode”以及被拒绝后的权限流程；PI Coffee 不提供进程内权限审批执行器。
- “Picode sandbox provider”、Windows PowerShell sandbox 以及任何 OS sandbox 断言。
- Guard、grant、Devloop、Completion Label 是运行时强制机制的表述；第一张 Harness 工单只实现提示词与工具，不能在提示词中伪造这些能力。
- VM manager/自动快照/自动恢复；VM 由所有者维护，VM 隔离才是执行边界。

## Claude Code 官方资料的核验边界

本审查只使用 Anthropic/Claude Code 一手资料。资料能支持 Claude Code 的公开行为和配置模型，但没有公开一份可用于逐字比对的完整 system prompt。因此它们不能证明 V3 文本的逐字来源。

- [Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)：说明可使用 `claude_code` 预设或追加自定义 prompt，并指出系统提示词涉及工具指导、安全、工作目录和环境等上下文。
- [Memory / CLAUDE.md](https://code.claude.com/docs/en/memory)：说明项目上下文会在会话中加载；它是指导性上下文，不是权限执行器。
- [Best practices](https://code.claude.com/docs/en/best-practices)：公开 explore → plan → code 及验证导向的工作方式，与 V3 的小步、检查和诚实报告语义相容。
- [Tools reference](https://code.claude.com/docs/en/tools-reference)：公开工具/技能的使用模型；具体工具名仍应由 PI Coffee 当前 Pi runtime 提供。
- [Permissions](https://code.claude.com/docs/en/permissions)：权限由产品机制执行，而不是靠提示词声明。PI Coffee 不应把 Claude Code 的 permission 语义搬进一个没有对应执行器的 prompt。
- [Security](https://code.claude.com/docs/en/security)：说明提示注入、权限和沙箱是互补的安全议题；这支持把“防止不可信内容改变任务意图”的指导保留为 prompt，但不把它当作安全边界。

## PI Coffee 的建议目标模型

### 两个 harness 维度

PI Coffee 的第一阶段只拥有两个可交付维度：

1. **Prompt profile**：选择稳定的 V3-derived prompt 增量，并通过 Pi 的 `before_agent_start` seam 追加到原生 Pi Base Prompt 后面。
2. **Tool profile**：根据 V5 的 `simple/full` mode 设置当前可见工具；只列出实际注册成功的工具。

V5 中的 `verificationProfile` 可以先作为未来兼容字段或不暴露给用户；它不能在本工单中声称提供自动 TDD Gate。V5 的 `permissionTier`、Guard 和 sandbox 不进入 PI Coffee Harness 的执行模型。

### 推荐的用户可见命名

采用 V5 的内部主模型，同时接受 V3 兼容别名：

| 用户命令 | 内部 mode/profile | 第一阶段行为 |
|---|---|---|
| `/harness simple` | `simple` + `none` | 保持 Pi 原生提示词；使用最小工具集 |
| `/harness full` | `full` + `lean` | 注入 PI Coffee 改写后的 V3 Lean prompt；使用完整的当前工具集 |
| `/harness standard` | `full` + `lean`（兼容别名） | 与 `full` 相同，不建立第三套工具表 |
| `/harness tdd` | `full` + `tdd-guidance`（兼容别名） | 只有在明确标注“指导性、未接入自动 Gate”时才允许启用；也可以先延后到 Verify 工单 |

建议第一张工单先交付 `simple/full`，并测试 `standard` 别名；`tdd` 是否在同一工单暴露是一个需要产品确认的范围选择。

### 注入与持久化

- 状态写入 Pi native session custom entry，归属于 User VM；不写入 Web Server/Control Plane。
- 每个 session start/resume 恢复一次状态；重复恢复不能重复拼接同一 prompt block。
- `/harness` 切换在下一次 agent turn 生效，切换时替换稳定 block 并开启新的 prompt/cache epoch。
- prompt 正文保持稳定；不要把日期、模型名、绝对路径、密钥、动态工具清单或完整 Task 状态拼进稳定前缀。
- 工具清单由实际 runtime 能力决定。`search_tools` 只能发现/激活真实存在的可选工具，不能让 prompt 宣称不存在的能力。

## 第一张工单建议边界（待确认）

**标题建议：** `HARNESS-001：PI Coffee 原生 `/harness`（V5 状态模型 + V3-derived prompt）`

**交付范围：**

1. 增加 Harness 状态类型与 session 持久化（`simple/full`；可选 V3 alias）。
2. 增加 V3-derived、PI Coffee 语义修订后的 Lean prompt fixture；工具占位符只映射到实际 Pi 工具。
3. 在 Pi adapter 的 `before_agent_start` seam 注入/恢复 prompt，保证不重复追加。
4. `/harness` 查询/切换结果和当前工具 profile 可观察。
5. 用 fake Pi seam 覆盖切换、重启/恢复、工具缺失和 prompt 不含 sandbox/permission/VM-manager 断言。

**明确不在本工单：** Guard、sandbox、权限审批、VM 生命周期、Worktree、Devloop 自动 Gate、Web UI 专用控制面、增强 Web Search。

**验收底线：** 测试只能证明 prompt 被选择、渲染、注入和持久化；不能把模型遵循 prompt 当作权限或安全证明。

## 研究限制

- 没有对 Claude Code 私有/未公开 system prompt 做逆向或提取；“逐字相同”无法从公开一手资料验证。
- 本文没有修改冻结的 `V5` 仓库，也没有修改 V3 工作树。
- 本文是设计审查记录，不代表 `HARNESS-001` 已获准实施；范围确认后再创建/更新 Gitea Issue 和 Project 1 卡片。

