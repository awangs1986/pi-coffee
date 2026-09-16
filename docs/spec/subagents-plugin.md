# 原生子 Agent：默认研究、独立模型、VM 并发准入

更新：2026-09-16。当前模式策略：Simple/Lean 完全不使用子 Agent；以下委派功能仅限 Full。

## 产品合同

- **Simple/Lean** 不可激活 `subagent`/`bg_wait`，搜索直接执行并保留短摘要与证据索引，即使传入 `delegate=true` 也不启动子任务。原生子任务命令亦要求切到 Full。
- **Full** 的 Web 搜索默认由 `coffee-research` 子 Pi 真正执行，必要时使用 `fetch_content`/`read` 核查来源。父 Agent 负责分解与综合，接收短结论、URL 和证据文件索引，不先搜索再委派摘要。
- 简单查询只启动一个子任务；独立问题可并行。每个主对话最多 **3** 个正在运行的子 Pi，每个 User VM 最多 **5** 个；主 Agent 不计数。多出的启动请求等待名额，不是直接报“并发超限”。
- 默认 fresh context，不复制父会话的完整历史。当前本地适配器禁止所有嵌套子 Agent（研究子任务当然不能递归委派）；复杂分解回到主 Agent。
- 保留 Pi 原生登录、provider/model registry、上游执行器、后台作业和取消协议。没有添加安全沙箱、权限内核或自动 worktree 策略。

## 实现边界

`src/pi-extensions.ts` 默认加载本地 `subagents/native-adapter.js`，它通过 jiti 加载锁定的 `pi-subagents@0.63.0`。只缩小模型可见 schema、接入原生二进制启动接口、归档输出和注册能力，不复制上游执行器。

`subagent` 支持：单个 `{agent,task,model?,cwd?,async?}`；最多 12 个 `tasks` 的批次（转换为原生 `runs.all` workflow）；`list/get/models/status/stop` 管理操作；`pending/reply` 转发原生 supervisor。`async` 默认 true；研究工具的事件委派使用前台等待。12 是单次批量输入上限，不是运行并发上限。默认不暴露任意 workflowScript、worktree 与并发覆盖参数。`bg_wait` 保留原生后台等待语义；普通异步子任务优先使用完成通知，不轮询。

父端 Simple/Lean 基础 8、Full 基础 10，另加常驻 `recall_folded`。子任务能力为 Full-only：`search_tools` 在 Simple/Lean 不允许激活，在 Full 可真实激活 `subagent` 与 `bg_wait`。模式切换即时生效；从 Full 切回 Simple 不强行终止已有后台作业，但不得启动新委派。原生 supervisor 不另加常驻工具，而通过 `subagent` 的 pending/reply 操作提供。公开事件总线负责跨扩展 API 实例共享能力注册。

## 硬并发与排队

`PI_SUBAGENT_PI_BINARY` 指向随构建复制的 `launch.py`。上游前台、后台 runner、事件委派最终启动子 Pi 都经过此接口。

Linux `flock` 同时取得一个主对话槽（共 3）和一个 VM 槽（共 5），持锁文件描述符随 `exec` 进入真实 Node/Pi。锁由实际子 Pi 生命周期持有：父端超时不提前释放；子进程退出或 SIGKILL 后内核释放。等待中的启动器不计运行子 Agent。等待超过 10 分钟以明确错误退出；研究调用总超时 15 分钟（包含等待）。取消等待中的启动器不会占用名额或后台偷偷继续启动。竞争采用随机退避，不保证 FIFO 或无饥饿。

Host 提供稳定 conversation ID，原生 CLI 使用 Pi session ID；后台作业继承根标识。默认命名空间 `/tmp/pi-coffee-subagents-<uid>`。所有同一 VM 的 Host/CLI 必须使用同一操作系统用户和同一准入目录。管理员可设 `PI_COFFEE_SCHEDULER_DIR`，但不能为每个会话设置不同值。运行中**不得删除锁目录/文件**，否则不同 inode 会破坏排他性。目录 0700，锁文件 0600。

这是产品启动路径的资源调度，不是安全边界：可信用户手工启动的其他 CLI、外部 runner、绕开适配器的显式扩展列表/直接命令不在计量范围。不能将 3/5 宣称为任意 VM 进程的强制沙箱限额。重启不自动重放任务；现有 Host 中断恢复策略不变。

## 独立模型

```
/subagents-model                  # 查看
/subagents-model provider/model   # 设置用户级子任务默认模型
/subagents-model off              # 清除默认，恢复上游继承行为
/subagents-policy                 # 查看并发和队列约束
```

保存到用户 Pi `settings.json` 的 `subagents.defaultModel`；父模型不变。原生文件 Agent 的显式模型/agentOverrides 保留上游优先级；每次调用明确的 `model` 优先。运行时 `coffee-research` 单次、批次与 Web 委派每次读取用户默认，命令修改后无需重启。无可用凭证/模型时报告错误，不自动换账号、供应商或父模型；Web 不静默退回父搜索。`delegate=false` 是调用者明确选择的直接搜索路径。

## 输出与证据

搜索子进程把完整有界搜索结果先存 VM 独立证据文件，只向模型提供精选摘要与索引。父对话只收到子结论和 artifact 索引；来源抓取结果也受本地上下文入口限量。

单次/批次/状态/bg_wait 输出及异步完成通知在父端入口限量，超长 content 或 details 先写 `getAgentDir()/pi-coffee/subagent-results/<sha256>.json`（0600），返回短预览、runId 和路径。写盘失败只返回短错误，不把原输出塞回历史。完整上游子会话/执行 artifact 仍在 VM，不能将 UI/history 中的短索引当作原始证据已删除。既有大历史只做上下文投影，不破坏性重写。

## 部署与验证

要求 Linux、Node >=22.19、Python3 标准库 `fcntl`。`npm run build` 复制可执行启动器；运行用户须有锁目录写权限。在 Full 关闭 subagents 或替换扩展列表时，默认 Web 委派会明确失败；可恢复配置，或显式 `delegate=false`。原生认证仍由用户在 VM 终端配置。

- `test/subagent-launcher.test.ts`：14 个独立进程/两个根对话，观测峰值 5、每根不超过 3；排队、等待中取消、SIGKILL 释放、禁止嵌套。
- `test/subagent-rpc.test.ts`：真实 Pi loader/CLI + 上游执行器 + 本地假 LLM/Relay，覆盖 Full 激活、Simple/Lean 拒绝激活且直接搜索、单次、双任务 workflow、后台完成通知、默认 Web 委派、独立模型和每次显式覆盖。子模型请求期间检测实际持有的内核锁；父请求不含完整搜索尾部。
- `test/subagent-result.test.ts`：Unicode/details 限量、0600 归档、写盘失败；其余测试覆盖事件注册、模型配置、失败无静默回退。
- `npm run check`、`npm run smoke:subagents`、`npm run smoke:web`。

这些是本地协议和执行路径验证，不替代真实 provider 登录/额度、真实 Serper 搜索质量、两台部署 VM、多窗口/浏览器通知和重启连续性验收。没有访问或更新未连通的外部需求单。
