# PI Coffee Harness Pi 插件

状态：已实现（PI Coffee `main`）。这是对冻结 V5 Harness 工具表的 Pi-native 适配，不是对 V5 运行时的复制。

## 基线和计数

本插件以 Gitea `awangs/picode` 的最新 V5 `origin/main` 提交
`778a3d534ba41f331210037a8c791bdfc0dabe7f` 为基线。V5 的 `/harness` 只有两张基础工具表：

| 模式 | 基础工具 | 数量 |
|---|---|---:|
| `simple` | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `search_tools` | **8** |
| `full` | Simple 的 8 个 + `git`, `verify` | **10** |

`src/harness/mode.ts` 是 PI Coffee 内部唯一的工具表来源。插件在启动时会把期望表过滤到 Pi 实际注册的工具；缺少必需工具时不会声称模式已就绪。启用后续可选插件可能使“有效激活工具数”高于基础数，但不会改变这两张 V5 基础表。

V5 的 `capabilities`、`context`、`handoff`、`kernel` 及 Web 能力不是这两张 Harness 基础表的一部分，后续逐项另立工单。

## Pi 接缝

`src/harness/extension.ts` 是原版 Pi 的 `ExtensionAPI` factory：

- 注册 `search_tools`、`git`、`verify` 三个自定义工具；Simple 启动时只激活 `search_tools`，Full 再激活 `git` 和 `verify`。
- 注册 `/harness` 和 `/verify` 命令。
- 从会话的 custom entries 恢复模式和验证 profile；状态只在 User VM 的 Pi session 中持久化。
- 在 `before_agent_start` 把现有的 V3-derived `lean`/`full` fixture 追加到 Pi Base Prompt，并用 `<pi_coffee_harness>` 边界去重。动态工具列表只作为运行时事实追加，不改写稳定 prompt 正文。
- `standard` 映射为 Full + quick profile，`tdd` 映射为 Full + advisory tdd profile；没有第三套工具表。

Host 的 `RpcPiSessionFactory` 支持 `extensions`，`main` 默认加载编译后的 Harness extension。可用 `PI_COFFEE_EXTENSIONS`（Linux 使用冒号分隔）替换扩展列表，设为 `off` 可关闭自动加载。

## User VM 后端适配

PI Coffee 的执行安全边界是 owner-managed User VM。没有移植 V5 的 Guard、permission tier、审批、managed checkpoint、transfer/adopt、Devloop Gate 或 Completion Label。

### `git`

`src/harness/native-git.ts` 通过 Pi 的 `pi.exec` 调用 User VM 原生 Git：

- `status`：`git status --short --branch`；
- `diff`：合并 unstaged 和 staged diff；
- `worktree/list`、`worktree/register`：使用原生 `git worktree`；
- V5 的 `checkpoint`、`undo`、`register-workspace`、lease、`transfer`、`adopt` 返回 `not-supported`，并说明由用户手动快照/发布。

命令参数通过参数数组传给 Pi，不拼接 Git shell 字符串。工作目录由当前 Pi session 的 `ctx.cwd` 决定。

### `verify`

`src/harness/native-verify.ts` 读取当前 User VM 工作区的 `.picode/verify.json`，按 `none|quick|tdd` profile 顺序调用 `bash -lc <command>`，只报告 `passed|failed|not_run`，并截断过大的输出。支持 V5 quick 数组和 tdd 的 `gate`/`smoke` 结构；TDD 状态机动作返回 `not-supported`。

这里没有额外的 config-trust gate：配置命令以 owning User VM 的普通权限运行，符合 PI Coffee 已确定的 VM 信任模型。不要把 `verify` 的结果误读为 V5 Gate Evidence 或完成标记。

## 验收

```bash
npm ci
npm run check
```

相关测试：

- `test/harness-extension.test.ts`：模式、别名、会话恢复、prompt 去重、工具驻留和实际 quick 命令；
- `test/harness-tools.test.ts`：8/10 计数、缺失工具 fail-closed、原生 Git 适配和 TDD 明确降级；
- `test/pi-adapter.test.ts`：扩展参数传播。

这张工具表和适配边界对应 Gitea `HARNESS-002` 工单。下一阶段的可靠性
矩阵和扩展工具接入计划记录在
[`HARNESS-003`](http://testpc:3000/awangs/pi-coffee/issues/16)。后续要恢复
V5 的快照/Worktree 编排或 Web capability，必须另立工单和 ADR，不能把本
适配器悄悄扩成第二套安全模型。
