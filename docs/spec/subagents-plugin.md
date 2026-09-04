# PI Coffee `pi-subagents` 插件

状态：已接入当前 `main` 的 Agent Host；真实模型/真实 User VM 的子 Agent
可靠性仍由后续工单验收。

## 集成目标

PI Coffee 复用上游 [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents)
的 delegation Module，而不是复制它的内部实现。当前锁定
`pi-subagents@0.63.0`；审计记录、上游 commit 和兼容性证据见
[`pi-subagents-audit-20260903.md`](../research/pi-subagents-audit-20260903.md)。

PI Coffee 的外部 Seam 是现有的 `RpcPiSessionFactoryOptions.extensions`：

```text
Agent Host
  └─ RpcPiSessionFactory
      ├─ PI Coffee Web adapter             (本地 Relay/search seam)
      ├─ PI Coffee Harness extension       (本地实现)
      ├─ pi-subagents/index.ts             (上游实现，由 Pi loader 加载)
      ├─ pi-web-access adapter             (上游内容工具，屏蔽同名 web_search)
      └─ subagents/extension.js            (本地资源 Adapter)
```

`src/pi-extensions.ts` 负责解析这些入口；`src/subagents/extension.ts`
只把上游包自带的 `skills/` 和 `prompts/` 目录接到 Pi 的
`resources_discover` seam。上游 child launch、workflow、background run、
result handoff 和 supervision 都留在上游 Module 内，因此调用方只需知道
一个扩展入口，模块仍保持较深的行为封装和较小的 PI Coffee 接口。

## Harness 计数不变

`pi-subagents` 注册的 `subagent` 与 `bg_wait` 是可发现的扩展工具，但不会
自动塞进冻结 V5 Harness 基础表：

| 模式 | V5 基础工具数 | `pi-subagents` 工具 | 运行时行为 |
|---|---:|---|---|
| `simple` | 8 | 已注册、默认未激活 | 用 `search_tools` 搜索并按需激活 |
| `full` | 10 | 已注册、默认未激活 | 基础表仍为 10；可额外激活扩展工具 |

这样 `/harness` 的 8/10 合约仍然可验证，同时允许后续逐个扩展工具做可靠性
验收。`/harness` 状态消息会区分 V5 base count 与 effective active count。

### 使用方式

在对话中让 Pi 使用子 Agent，或先让它调用：

```text
请使用 search_tools 查找 subagent，然后在确认任务适合并行后激活它。
```

上游命令（例如 `/subagents`、`/subagents-doctor`、`/subagents-fleet`、
`/subagents-stop`、`/subagents-models`、`/parallel-review` 和
`/review-loop`）会在 RPC command/resource 列表中出现。命令是否能完成具体
操作，仍取决于 User VM 的模型、目录和资源；没有凭据的离线 smoke 只验证
加载与注册，不声称子 Agent 已执行成功。

Web Shell 会把 Pi `display: true` 的 custom message（包括可见的
foreground 子 Agent 结果和 slash-command 报告）显示为通知；`display: false`
的 context-only 内容不会写入浏览器显示缓存。后台完成结果是否需要主动
推送到浏览器，列入 [`SUBAGENT-002`](http://testpc:3000/awangs/pi-coffee/issues/18)
的真实 User VM 观察性验收。

## 配置和回退

| 变量 | 默认 | 作用 |
|---|---|---|
| `PI_COFFEE_EXTENSIONS` | 内置 Web + Harness + `pi-subagents` + `pi-web-access` | 冒号分隔的显式替换列表；设为 `off` 关闭全部扩展 |
| `PI_COFFEE_SUBAGENTS` | 启用 | 设为 `off`、`0`、`false` 或 `no`，只关闭内置 `pi-subagents`，保留 Harness |
| `PI_COFFEE_AGENT_DIR` | Pi 默认 | 上游配置、session 和异步结果仍归 User VM 的 Pi 目录 |

### 全局模型

PI Coffee 提供 `/subagents-model` 命令管理用户级 Pi 配置中的
`subagents.defaultModel`：

```text
/subagents-model                 # 查看当前全局模型
/subagents-model provider/model  # 设置所有未显式指定模型的 subagent
/subagents-model off             # 清除设置，恢复继承当前父 agent 模型
```

配置写入 `PI_COFFEE_AGENT_DIR/settings.json`（未设置时使用 Pi 默认 agent
目录），保留文件中的其他字段，并使用 0700 目录/0600 文件权限和原子替换。
该设置对内置、包、用户和项目 agent 的默认模型均生效；单次调用、agent
frontmatter、`agentOverrides` 仍按上游 `pi-subagents` 优先级覆盖全局默认。
本阶段只提供一个全局模型；第二模型与父模型回退链保留为后续扩展。

显式 `PI_COFFEE_EXTENSIONS` 优先级最高：一旦设置，它不会隐式追加
`pi-subagents`。这给部署和故障诊断一个可预测的回退点。

## 安全和数据归属

- VM isolation 仍是 PI Coffee 的执行 Seam；本次集成没有恢复 V5 Guard、
  sandbox、permission tier 或 VM manager。
- 上游 worktree 选项只是它自己的任务组织能力，不等同于 PI Coffee 的
  Worktree 安全机制，也不改变 User VM 的所有权。
- 子 Agent 的 session、transcript、artifact 和上传文件继续写入 owning
  User VM；Web Server/Control Plane 不保存这些正文。
- 上游包是锁定依赖，升级必须重新做版本/commit 审计、lockfile 检查和
  Pi 兼容性 smoke，不使用 `^` 或 `latest`。

## 验证

```bash
npm ci
npm run check
npm run smoke:subagents
```

`smoke:subagents` 使用临时 Pi 配置目录和离线 RPC，只验证 extension 加载、
resource discovery 与命令注册，不访问上游模型，也不会写入 User VM 或
Control Plane。

加载级 smoke（无外部模型）应满足：

1. Pi CLI 使用三条 extension 路径退出码为 0；
2. RPC `get_commands` 包含 `subagents-*`、`parallel-review` 和
   `review-loop`；
3. Harness 测试仍断言 Simple=8、Full=10，且 `search_tools` 能发现/激活
   `subagent`；
4. `PI_COFFEE_SUBAGENTS=off` 只留下 Harness，`PI_COFFEE_EXTENSIONS=off`
   不加载任何扩展。

真实 User VM 的 foreground/background child、取消、浏览器断开后继续、Host
重启恢复和资源清理不在本次加载切片中；它们记录在
[`SUBAGENT-002`](http://testpc:3000/awangs/pi-coffee/issues/18)，完成前不能
把本插件称为生产可靠。
