> Repository placement: [ADR-0021](../adr/0021-pi-only-source-authority.md). This package owns Pi behavior; Host/Web integration belongs to the Server consumer. Historical branch evidence is not current-main acceptance.

# PI Coffee Harness Pi 插件

产品模式只由 [Pi Agent 主规格](./pi-agent.md) 定义为 Chat/Work。Work 保留 Pi 原生 Base 并追加通用正文；Chat 不发送系统指令。工具数量和按需分配见主规格 PA-003/011，不在此维护第二张模式表。

## 实现状态与接缝

**2026-09-22：迁移已实现。** 默认 Work；使用 `/chat`、`/work` 或 `/harness chat|work` 切换，退役别名不再接受。v1 会话追加 v2 Work 状态并通知，保留历史并撤销旧能力激活。未知版本保留历史并要求显式选择模式。缺失必需工具时拒绝切换，恢复失败时停止模型请求。

- 使用原版 Pi 的公开 `ExtensionAPI`；Host 只传扩展路径，不导入 Pi 内部实现。
- Work 正文由 `renderHarnessPrompt("work")` 读取，通过 `before_agent_start` 追加，并用既有块边界去重；动态事实与稳定正文分开。
- 模式、能力和验证状态只存于 User VM 原生会话。恢复读取当前 Pi 分支；切模型/模式时撤销能力激活，Work 恢复时重新校验。
- 注册工具不等于激活工具；每次请求的实际 schema 是模型可调用能力的依据。
- `PI_COFFEE_SUBAGENTS=off` 关闭子任务扩展；`PI_COFFEE_EXTENSIONS` 可替换扩展列表，设为 `off` 关闭全部扩展。工具与模型政策见[子 Agent 接缝](./subagents-plugin.md)。

## User VM 后端适配

PI Coffee 的执行安全边界是 owner-managed User VM。没有移植 V5 的 Guard、permission tier、审批、managed checkpoint、transfer/adopt、Devloop Gate 或 Completion Label。

### `git`

`src/harness/native-git.ts` 通过 Pi 的 `pi.exec` 调用 User VM 原生 Git：

- `status`：`git status --short --branch`；
- `diff`：合并 unstaged 和 staged diff；
- `worktree/list`、`worktree/register`：使用原生 `git worktree`；
- V5 的 `checkpoint`、`undo`、`register-workspace`、lease、`transfer`、`adopt` 返回 `not-supported`，并说明由用户手动快照/发布。

命令参数通过参数数组传给 Pi，不拼接 Git shell 字符串。工作目录由当前 Pi session 的 `ctx.cwd` 决定。

### 显式 `/verify` 命令（不作为模型工具）

`src/harness/native-verify.ts` 读取当前 User VM 工作区的 `.picode/verify.json`，按 `none|quick|tdd` profile 顺序调用 `bash -lc <command>`，只报告 `passed|failed|not_run`，并截断过大的输出。支持 V5 quick 数组和 tdd 的 `gate`/`smoke` 结构；TDD 状态机动作返回 `not-supported`。

这里没有额外的 config-trust gate：配置命令以 owning User VM 的普通权限运行，符合 PI Coffee 已确定的 VM 信任模型。不要把 `verify` 的结果误读为 V5 Gate Evidence 或完成标记。

## 验收

```bash
npm ci
npm run check
```

相关测试：

- `test/harness-extension.test.ts`：模式、退役别名拒绝、会话迁移/恢复、prompt 去重和工具驻留；
- `test/harness-tools.test.ts`：当前工具解析、缺失工具 fail-closed、原生 Git 适配和 TDD 明确降级；
- `test/pi-adapter.test.ts`：扩展参数传播。
- `test/chat-work-rpc.test.ts`：真实 Pi 加载默认插件与 LSP Skill，检查最终 HTTP 请求中的 Chat 空系统指令和精确工具表。

这张工具表和适配边界对应 Gitea `HARNESS-002` 工单。下一阶段的可靠性
矩阵和扩展工具接入计划记录在
[`HARNESS-003`](http://testpc:3000/awangs/pi-coffee/issues/16)。后续要恢复
V5 的快照/Worktree 编排或 Web capability，必须另立工单和 ADR，不能把本
适配器悄悄扩成第二套安全模型。
