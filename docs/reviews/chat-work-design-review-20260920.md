# Chat/Work 与 Work 提示词设计审核

> 后续状态（2026-09-21）：owner 已批准并应用本文六项提示词建议，见[修订证据](./work-prompt-revision-20260921.md)。下文“未应用”等描述保留为 09-20 审核时的历史状态；工具接口与身份守卫缺口未在此轮顺带修改。

日期：2026-09-20。用户要求：统一设计文档为 Chat/Work；先审核提示词，再提供 owner 自行运行的测试方法；讨论 Work 工具数量。

固定审核基线 `b027838`，提示词方案变化为 `git diff bcd2a65...b027838`，包含 `1d64478`、`ff0c6ed`、`b027838`。重点是 `docs/spec/harness-prompt.md`、`src/harness/prompts/software-development.md`、`src/harness/prompt.ts` 与两个对应测试。下述行号均指审核基线；本轮文档整理后的行号可能变化。

判断：分层方向合理，已有执行、工具、上下文、验证和沟通骨架；应该进入行为测试，而不是继续按参考产品体量扩写。正文保留为基线，以下建议未偷偷改进模型提示词。独立审阅按 Standards/Spec 分开记录；重叠问题不计作两种根因。

## 本人的逐条设计判断（owner 补充要求后）

这是我重新对正文逐句阅读，并对照当前 Pi Base、renderer、工具 schema 与调用路径后作出的判断，不以“需要实测”代替设计结论。结论：**保留现有结构和大多数内容；需要一次有针对性的删改，不应继续扩写。** 当前正文项目中立、核心工具契约真实；主要问题是几条过宽的禁止句把本来需要区分的行为混在一起。

### 应当修改的四处

| 位置（正文行号） | 我的判断 | 建议文案（仅提案，未写入正文） |
|---|---|---|
| **7：Questions, reviews, and diagnoses do not authorize implementation** | 应限定为“只要求解释/审查/诊断”。“能帮我修好吗？”是问句，也可能是明确实施请求；“诊断并修复”已经授权修改。不能让句式或任务标签压过用户意图 | `Requests limited to explanation, review, or diagnosis are read-only. When the user also asks for a fix or implementation, complete that authorized work and verify it.` |
| **34：deleting or overwriting files / changing CI** | 应明确正常实施包含必要可逆本地编辑。“修 CI”已授权编辑仓库内 CI 文件；删除已明确要求删除的文件不应再次问。应围绕是否超出范围、是否丢弃他人成果、是否影响共享系统判断，而非只看动作名称 | `An implementation request authorizes the necessary reversible local edits and checks, including edits to tracked files. Ask only when an action exceeds that scope, discards unrelated work, changes shared systems, or performs an external action not already authorized.` |
| **27：Do not generate or guess URLs** | “不编造来源”正确，“不生成 URL”过宽。生成本地预览地址、按已知仓库/提交构造链接、为用户编写 URL 本来就是合法任务 | `Never invent source citations or claim an unvisited page supports a fact. Construct task-required URLs from verified inputs, and distinguish constructed links from sources you actually inspected.` |
| **9：when working outside already-loaded project guidance** | 检查局部项目指导不应以“离开已加载指导范围”为前提。根目录指导覆盖子目录，并不意味着子目录没有更具体的指导；这个条件可能导致漏读 | `Before editing, check for applicable project instructions along the target file's directory scope, including more specific instructions below the project root.` |

这些是规则边界本身的问题，我建议直接修正文案；模型测试用于检验修改效果和是否引入新的歧义，不是决定这些区别是否存在。

### 两处建议收敛

- **第 11 行禁止一次性 helper 等实现手段**：应保留“不过度设计”，删除对具体手段的一刀切。一次使用的 helper 也可能让复杂逻辑更清楚；兼容层也可能是用户明确要求的必要实现。更准确的是 `Avoid abstractions and compatibility machinery that the requested behavior does not need.`
- **第 40 行必要澄清限制为一个问题**：应强调最少打断、合并相关必要问题，而不是无条件一次一个。否则同一个决定的几个维度可能被拆成多轮，拖慢执行。建议 `Ask only questions whose answers materially affect the work; group closely related necessary questions and continue independent work.`

### 我明确赞成保留的部分

- **第 16～20 行工具纪律**：活动 schema 为准、现有工具直接用、缺能力才发现/激活、下一请求生效、失败先诊断。尤其真实的两步示例有用，不能因为通用提示词要短就删除。
- **第 21 行委派边界**：传有界输入、短结论与证据索引、等待完成而非启动 ACK，能配合现有子任务架构。父端不重复已委派调查，同时验证重要结论，两者并不矛盾。
- **第 25～28 行上下文节制**：输出前限量、定向读取、复用事实、截断不是完整证据、回忆有条件。这些应保留；真正的请求预算/压缩仍由代码负责。
- **第 32～33 行验证真实性**：区分既有失败与新回归、单测与端到端、真实执行与自报。这是成熟开发 Agent 的必要规则。
- **第 39～41 行沟通大方向**：使用用户语言、只报有意义进展、最终消息独立、任务结束即停。除了“一个问题”的硬限制，其余无需模仿别家再增加排版条款。

### 对五个核心文件的结论

| 文件 | 结论 |
|---|---|
| `docs/spec/harness-prompt.md` | 分层和验收结构值得保留；追加/替换矛盾已纠正。9,000 字节是体量护栏，不能以比另一仓库源码短作为质量证据 |
| `src/harness/prompts/software-development.md` | 骨架合格、无需推翻；四处边界应修改，两处可删减。当前没有发现项目专属内容泄漏 |
| `src/harness/prompt.ts` | 单一 Markdown 源、换行处理和基本输入检查足够简单；不需要加模板框架。renderer 不是模式隔离层，这一点要保持 |
| `test/harness-prompt.test.ts` | 可作为轻量文本防回归，不能当质量评分；项目身份守卫的未知名字缺口应修。当前有些精确词句断言会锁住上面的过宽规则，文案修正时要同步改断言，不宜为了旧测试保留歧义 |
| `test/harness-extension.test.ts` | 去重、注入与真实 schema 示例测试有实际价值，继续保留；补真人测试不是否定这些接缝测试 |

### 与现有 Work 工具设计的关系

我接受 owner 明确的继承方向。已核对的设计是 10 个基础工具＋通常常驻的回忆工具，另有可发现/激活的 Web、正文读取和子 Agent 能力包。它与正文“先用已有工具，必要时再发现”的规则相匹配。

`git`/`verify` 的不支持 action 暴露属于工具接口问题，不能靠在系统提示词追加更多“别调这些 action”的禁令补救。应保留工具本身，在 schema 接缝解决；这比把已实现的工具删掉或重新凑数更合理。细节见[工具设计审核](../spec/work-tools.md)。

## Standards

1. **P2，确定的规格维护问题**：`docs/spec/harness-prompt.md:48`、`:57` 与 `docs/spec/pi-agent.md:106` 把替换/追加仍列为未决，但 PA-009 及 Work SPEC 第 34 行已明确在 Pi 原生之上做加法。违反维护流程中替代旧决定、避免冲突入口的要求，可能让后续实现者整体替换 Base。**本轮文档已修正**：保留 Base＋追加正文确定，装配与去重另行验收。
2. **P2，待行为测试的风险**：`src/harness/prompts/software-development.md:34` 把删除/覆盖文件、移除依赖、改 CI 纳入求授权示例。虽保留“已有授权范围除外”，但没有明确必要本地编辑何时包含在修复请求中，可能导致多余确认，与第 7 行持续实施存在解释张力。用人工测试 T02/T09 观察后再改，不能据静态阅读宣称模型已发生阻塞。

Standards 共 2 项，最严重 P2；其中 1 项确定问题、1 项风险判断。未发现需要套用代码 smell 的问题。

## Spec

1. **P2，确定的分层规格矛盾**：PA-009 与 PA-Q02 同时保留冲突选择，位置同上。**本轮文档已修正**，不代表模式运行时已经迁移。
2. **P2，确定的守卫覆盖缺口**：PA-010 明确要求类别级守卫，而 `test/harness-prompt.test.ts:11` 身份匹配仍为已知名字集合，`:33–43` 正向样例也只用已知词。`You are maintaining Acme, the Acme agent product.` 不命中任何类别，改名可绕过“项目身份”检查。应补未知产品名的自开发指令样例并如实限定静态守卫能力；本文只报告，当前测试和正文保持不变。人工项目中立审核与 T10 是补充，不能由正则替代。

Spec 共 2 项，最严重 P2；未发现本轮方案新增工具、修改 Pi 内核或擅自迁移模式的 scope creep。

## 已核实与测试边界

- `software-development.md:18` 的 `search_tools` 搜索/激活示例与 `extension.ts:394–417` schema 及下一次请求生效规则相符；`test/harness-extension.test.ts:338–361` 确实执行该定义。
- renderer 从单一 Markdown 读取、去作者注释、规范换行；不负责工具集合或 Chat 隔离。当前所有兼容路径追加正文，因此不能以 UI 名称或 renderer 默认参数验收 Chat。
- 原生 Base＋稳定正文＋项目指令＋动态事实分层合理。9,000 字节只是工程限制，与其他产品源码长度对比不能证明质量，也不代表完整模型请求占用。
- 现有关键词测试证明内容存在，公共接缝测试证明注入和调用示例可用；两者都不证明模型实际遵守。未执行真实 provider、Serper、目标 VM、Chat 最终 payload 或模型 A/B。
- “一次只问一个问题”、审查/诊断不实施等是可测试的交互选择。它们不应压过用户同一请求中已经明确授权的实施部分；混合请求可作为后续扩展样例。

## 本轮交付与待办

- 文档只保留 Chat/Work 设计；退役命令、模式表与分派规则从当前 Markdown 撤下，历史原文仍在 `b027838`。不将历史行为改名伪造成新模式，不删除兼容代码和会话数据。
- 新增文档回归检查覆盖仓库 Markdown，允许历史文件名/URL作为引用；先观察失败，再清理到通过。普通英文表示“完整”的措辞改用其他表达，避免名称歧义。
- [人工测试手册](../testing/work-prompt-manual.md)含生成器、明确初态、可复制输入、动作判分、失败/阻塞区分与记录模板。所有真实模型结果待 owner 执行。
- [工具设计](../spec/work-tools.md)已按 owner 后续纠正：Work 继承现有常驻集合与按需能力；撤回重新选基础集合的提案。Chat 基础工具名称与 Work 接口/搜索政策细节继续讨论。
- Gitea `http://testpc:3000` 本次连接失败；Issue #1 未成功读取。Issue #13/#14/#15 的决定与验收同步待恢复；不声称远端已更新或关闭。

## 本轮实际验证

- Linux，Node `24.19.0`、npm `10.9.2`；按最新分支 lockfile 独立执行 `npm ci --no-audit --no-fund`。初次借用旧工作区依赖时缺少 jsdom，已撤下该链接并独立安装，未修改 lockfile。
- `npm run check`：TypeScript 构建通过，**32 个测试文件 / 187 项测试通过**。既有 vendor sourcemap 缺失告警仍在，不影响通过。
- 文档 red → green：新增检查最初报告 86 个含退役术语的行（含名称歧义的普通英文）；清理后 2 项检查通过。新文档本身也被扫描。
- 练习生成器实际创建新临时目录：初态 1 项通过、2 项按设计失败；在临时目录施加已知价格修复后，价格 2 项通过。这里只验证题目与判分条件，不算真实模型行为结果。
- `git diff --check` 通过；本轮新增的相对文档链接无断链；未修改提示词正文、renderer 或两组现有提示词测试。
- 未调用真实 provider、未推送、未更新外部 Issue；新增文档与测试在本地 `codex/chat-work-design` 工作区，等待后续讨论与 owner 行为结果。
