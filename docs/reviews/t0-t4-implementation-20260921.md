# T0–T4 实现与验收证据（2026-09-21）

本记录区分“代码已实现”和“部署门槛已通过”。实现提交：Agent
`874d763`，Server `3c3d71e`。两者已推送到本地 Gitea `main`；GitHub
不在本轮范围。

## 已通过

| 层级 | 命令/场景 | 结果 |
|---|---|---|
| Agent 全套 | `npm run check` | 29 files，159 tests 通过 |
| Server 全套 | `npm run check` | 6 files，39 tests 通过；vendor source-map 缺失只产生既有 Vite warning |
| Gitea fresh clone | 两仓 `main` 分别执行 `npm ci --ignore-scripts && npm run check` | Agent 159/159；Server 39/39 |
| 真实 Gitea | `npm run smoke:gitea-workspaces`，一次性私有仓库 | 创建 Project/源 Conversation 分支；checkpoint SHA `4ed0e9cff1bf472ce275c47f29a13140240072b1` 经远端复核；创建真实 PR；第二 workspace root 从该 SHA 建立 `coffee/vm-b/conversation-b` |
| 清理 | smoke `finally` 与一次性凭据回收 | 临时 repository、API token 和本地 token 文件均删除 |
| 跨仓公共 seam | Agent Host + 内存 Fake Pi + Server Gateway + WebSocket browser | open、prompt、ack、event、settled 通过；Host session ID 由真实链路返回 |
| 旧路径退出 | 源码/浏览器合同检查 | 平台 `merge_preview`/`merge`、merge token/proposal、worktree 创建/移除已删除；原生 Git 工具的用户主动 `worktree` 命令保留 |

新增的失败路径测试覆盖远端 branch 碰撞、已有 Checkout 目录保护、push
返回失败但远端已接收时的精确 SHA 复核、迁移中断后重试、dirty/private
文件保留、远端不可用时禁止清理、Project Forge 入口和 Host 迁移 API。

## 2026-09-22 目标机部署验收

真实部署使用 `webserver`（`192.168.100.101`）运行 Web Gateway，
`linux001`（`192.168.100.217`）运行 Agent Host、Transfer 和 Pi。两仓分别
从 Gitea `main` 构建；Agent 为 `4c7235b`，Server 为 `3c3d71e`。目标机
重新执行检查为 Agent 159/159、Server 39/39。

| 范围 | 真实证据 |
|---|---|
| T0 owner 权限 | Host `/healthz` 报告 `giteaCheckouts=true`、`ownerEnvironment=true`、`passwordlessRoot=true`；systemd 以 owner `awang`、真实 HOME/PATH 运行。 |
| Gitea 身份 | 建立 confidential OAuth app，callback 为 `http://webserver:3000/auth/callback`，Gitea user ID 1 固定路由到 `ws://linux001:8788/host`；已移除 `PI_COFFEE_ALLOW_UNAUTHENTICATED=1`。浏览器烟测验证匿名 401、HttpOnly/SameSite=Lax Cookie、路由撤销立即 401、重新登录、logout 204 和 logout 后 401。 |
| T1 Checkout | 真实项目 `pi-coffee-host-e2e-20260921-7ce392` 的每个 Conversation 使用独立 clone 与独占 branch；浏览器显示 Checkout、branch 和同步状态。新会话默认路径不调用平台 `git worktree add`。 |
| T2 同步/PR/接续 | Conversation `07a792fe-8a9a-48a3-90f9-cfebba1c87bf` 完成工具/LSP 任务；checkpoint `8b8a0ce2b71f4a4b145975a17c77b3ece53ef902` 本地/远端一致，真实 PR 为 `awangs/pi-coffee-host-e2e-20260921-7ce392#1`；`continue-650d1d7d79dec870` 从已确认 SHA 建立另一独立 clone/branch。正式 runtime token 以 `write:repository + write:user` 再跑一次性仓库烟测，完成 checkpoint `e665fcab546e1393b26ee90cd37afe6fe7e984fe`、PR 和第二 VM-ID 接续，临时仓库随后返回 404。 |
| 工具与 LSP | `eidolon/gpt-5.6-terra` 主动发现并调用基础 Work 工具及按需 Web/subagent；`coffee-lsp` 的 TypeScript 跨文件诊断、references 影响分析和 Python 跨文件诊断均通过，覆盖 status/diagnostics/definition/hover/symbols/references。pi-lens 单独加载时索引、AST、诊断、导航正常；完整 Harness 默认不激活 pi-lens，按设计通过 CLI Skill 使用。 |
| 生命周期/故障 | 浏览器断开与 Web 重启不停止 Host 任务；刷新重新 OAuth 后恢复会话。Host 重启恢复已完成历史；执行中重启标记 `interrupted` 且不自动重放。缺凭据/Gitea 不可达显示 `unknown`，本地/远端分叉显示 `diverged`；未归档或确认 ID 不精确的删除返回 409。 |
| 旧目录迁移 | 真实旧 worktree 迁移保留 tracked dirty、untracked 与 `.env`，映射切换到独立 clone；旧目录保留，未发生静默删除。 |
| 文件传输 | Transfer 真实上传 25 bytes，SHA-256 `4ab340374b0a6878a1e89a3b7f75d617f23d169f01a99af0c9440f6e1d080c14`。 |
| 模型网络 | 临时代理与 SSH reverse tunnel 已退出；恢复 `models.direct.json` 后，Eidolon `/models` 返回 200 并包含 `gpt-5.6-terra`，真实 Pi 请求返回 `DIRECT-MODEL-OK`。 |
| 正式凭据 | Host 使用 Gitea token `pi-coffee-linux001-runtime`；两枚测试 token 已撤销。OAuth secret、Host token、模型 key 和 token 正文均只保存在目标机受限配置文件中。 |

仍未满足 T4 的双用户发布门槛：当前拓扑是一台 Web Server 加一台 User VM，
不是两个 Gitea 用户分别绑定两台 User VM。第二 User VM、2 × 3 活动
Conversation、跨用户隔离和 VM 快照恢复仍需另加机器执行。T0–T3 的单用户
目标机路径已有实证；T4 继续保持 open，不能用当前两台机器把“双 User VM”
改写成“Web + User VM”。

## Issue 状态原则

T0–T4 和 Server T3 均回填实现提交与以上证据，但保持 open。只有在目标
VM 上完成各 Issue 的真机/迁移条件后才能关闭；尤其不能用本地替身和
fresh-clone 检查替代 T4 的双 VM 门槛。
