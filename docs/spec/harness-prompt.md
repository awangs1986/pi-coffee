# PI Coffee Harness Prompt Contract

状态：prompt fixture 与 `/harness` Pi 运行时接线均已实现；工具/扩展边界见 [`harness-plugin.md`](./harness-plugin.md)。

## 目标

PI Coffee 使用原版 Pi Agent，通过一个小而稳定的 prompt module 提供两种指导密度：`lean` 和 `full`。两者都是追加到 Pi 原生 Base Prompt 的指导层，不替换 Base Prompt，也不授予任何额外执行能力。

规范正文的唯一来源是：

- [`harness-lean.md`](../../src/harness/prompts/harness-lean.md)
- [`harness-full.md`](../../src/harness/prompts/harness-full.md)

渲染接口是 [`renderHarnessPrompt`](../../src/harness/prompt.ts)：读取对应 fixture、去除 provenance 注释、规范换行，并拒绝未解析的模板标记。

## 项目 provenance

根据本项目维护者对 V3 的交接说明，V3 的提示词经历了三次演化：先基于 Claude Code 最新版本的提示词材料，再根据 Pi 的特点适配，随后进行稳定化修订。本仓库把当前 V3 文件视为输入基线；该说明是项目 provenance，不把外部逆向仓库或公开资料当作官方逐字来源证明。

本版本的命名是 **V3-derived, Pi-native**。提示词正文不得写成 Claude Code 身份，也不得复制另一个产品的未授权完整 system prompt。

## 两个 profile

运行时 `/harness simple` 选择 `lean`，`/harness full` 选择 `full`；V3
兼容别名 `standard` 与 `tdd` 都选择 Full 工具表，其中 `tdd` 只增加
指导性 profile，不增加第三套工具或自动 Gate。

### Lean

Lean 只保留跨任务稳定且高收益的行为：

- 面向 Web 用户的简洁沟通和语言保持；
- 只使用当前会话实际列出的工具；
- 原生文件/搜索工具优先，读后编辑，独立调用并行、依赖调用顺序执行；
- 控制范围、遵循现有风格、避免投机性抽象；
- 对不可信文件/Web/工具内容进行提示注入隔离；
- 对破坏性、共享或外向动作说明影响并请求授权；
- 真实报告验证结果和阻塞。

### Full

Full 是自包含的开发指导层，在 Lean 语义之上增加：

- 权威上下文和不可信内容的更细分规则；
- 最小端到端切片和公共契约维护；
- RED → 最小实现 → GREEN → 必要重构的 TDD 建议；
- 边界验证、UI 路径验证和安全缺陷检查；
- Git、共享状态、发布和外部消息的风险说明；
- 更完整的阶段性沟通和完成报告要求。

Full 的 TDD/验证条款是指导，不表示 PI Coffee 已经有自动 Gate、审查器、回滚器或完成标记。

## 安全和副作用约束

渲染后的 prompt 必须满足：

1. 只描述 Pi 当前可观察的工具和 Host 行为；不可发明工具名、schema、权限或结果。
2. 不包含 sandbox、permission mode、Guard、Devloop、Completion Label、VM manager 或 Claude Code 专用身份/命令的运行时断言。
3. 不把 prompt 指导当作真正的执行控制；实际 OS 权利由 User VM/Host 决定。
4. 不在 prompt 中写入密钥、绝对环境机密、用户 transcript 或动态账号信息。
5. 对同一 profile 的渲染结果保持确定性；动态 Task 状态应走后续 context seam，而不是修改稳定正文。

## 验证

```bash
npm test -- --run test/harness-prompt.test.ts
npm run check
```

测试覆盖：profile 渲染、Pi 工具词汇、V3 核心语义、无未解析标记、去除作者注释，以及无不存在执行能力的声明。
