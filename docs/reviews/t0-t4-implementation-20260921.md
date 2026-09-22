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

## 2026-09-22 双 User VM T4 验收

新增 `linux002` / `linux002.lan`（`192.168.100.218`）后完成第二轮真机验收。
`linux002` 从 `linux001` 克隆而来；测试前停止 Host，并替换 hostname、
machine-id、SSH Host Key、Host token、Gitea 用户/token、`PI_COFFEE_VM_ID`
和传输地址。复制来的 workspace、session、mission、research 与子 Agent
结果已清空，模型配置及运行依赖保留。两台 VM 的 machine-id、SSH Host
Key、Host token 与 Gitea token 哈希均不同。

| 范围 | 双 VM 证据 |
|---|---|
| 部署版本 | `linux001`、`linux002` 均升级到 Agent `073829c`；每台 `npm run check` 为 30 files / 163 tests。`webserver` 运行 Server `671c37e`。两仓 fresh clone 分别再次通过 Agent 163/163、Server 39/39。 |
| 身份与路由 | Gitea user ID 1 `awangs` 固定路由到 `ws://linux001:8788/host`；普通用户 ID 6 `pi-coffee-t4-user2` 固定路由到 `ws://linux002:8788/host`。两者真实 OAuth `/api/me` 分别返回自己的 ID/login；匿名 `/api/me` 返回 401。 |
| 2 × 3 Conversation | `awangs/pi-coffee-t4-linux001-151709` 与 `pi-coffee-t4-user2/pi-coffee-t4-linux002-151709` 各创建三个未归档 Conversation。六个目录都是独立 `.git` clone，分支分别使用 `coffee/linux001/<conversation>` 与 `coffee/linux002/<conversation>`；默认路径未使用平台 worktree。 |
| 真实模型与 owner 权限 | 两台 VM 均经 OAuth WebSocket → Web Server → 对应 Host 调用 `eidolon/gpt-5.6-terra`。模型主动使用 Read/Bash/Git/Write/Edit，执行 `sudo -n id -u` 得到 0，并完成最小 TypeScript 项目。 |
| LSP 中间层 | 两个真实 Conversation 均由模型调用 `coffee-lsp status`、修复前后 `diagnostics`、`symbols`、`definition` 与 `references`，同时运行 `npm test`（各 1/1）。未观察到 LSP 与基础工具冲突。重复诊断有一次诚实返回 `diagnostics_unconfirmed`；模型未将其误报为 clean，并以已确认的即时诊断及完整 build/test 补证。 |
| Checkpoint / PR | linux001 Conversation `9384bcf1-f116-4aeb-ba58-b8006736c0d6` 的本地、远端和 checkpoint SHA 均为 `88cab813174ce643aa50bdd5e561692466cfa1fc`，真实 PR `awangs/pi-coffee-t4-linux001-151709#1`。linux002 Conversation `015745d9-7857-4477-8c56-1dc1a6863a38` 的三者均为 `c906e721880c7ab0bdd12224da662c24cb0db7f5`，真实 PR `pi-coffee-t4-user2/pi-coffee-t4-linux002-151709#1`。 |
| VM 内容隔离 | 两个 OAuth 用户的 workspace 列表都只包含 owning Host 的 Conversation；另一用户 Conversation ID 不可见。各自 Transfer tree token 在 owning VM 返回 200，拿到另一 VM 使用返回 401。Host token、Gitea API token、Cookie 和 Transfer token 均不同且未写入本记录。普通用户读取 `awangs` 私有仓库返回 404。 |
| 管理员例外 | `awangs` 是 Gitea admin，因此读取普通用户私有仓库返回 200；这是 Gitea 管理员的预期全局权限。需要对称仓库不可见时，User VM owner 必须使用非管理员 Gitea 账号，管理员账号不能作为隔离验收用户。Web/Host Conversation 与 Transfer scope 未出现这一例外。 |
| 克隆凭据缺陷与修复 | 首次无效凭据演练发现 `linux002` 的 `~/.pi-coffee/git-credentials` 仍保存源 VM 的 `awangs` token；仅修改 `host.env` 不会替换 Git helper。已将 credential store 改成 user ID 6 的独立 token并确认哈希与 linux001 不同；运行手册增加克隆去重步骤。未撤销源 token，因为 linux001 仍在正式使用。 |
| 远端故障 | 将 Conversation remote 暂时改为不可达端点后，刷新状态为 `unknown`、保留 dirty 并报告 sync error；恢复 URL 后可继续。把 API token 与 Git credential store 同时替换为无效值后，checkpoint 返回 409；恢复凭据后普通 sync 成功，远端 SHA 精确一致。 |
| 分叉与 branch 删除 | 独立本地/远端提交得到 `diverged`；普通 fetch + merge + sync 后回到 `synced`，未 force-push。删除远端 Conversation branch 后状态为 `unpublished`；普通 sync 重建 branch 并回到 `synced`。 |
| 重启恢复 | 两个 Host 与 Web 均在验收数据存在时重启。Host 重启后两个真实会话分别恢复 26 与 31 条 history entry，均未截断。Web 重启不影响 Host 数据，但旧 Web Cookie 返回 401；两个用户重新 OAuth 后恢复各自 workspace/history。 |
| VM 快照回滚 | Proxmox VM 105 在关机状态创建磁盘快照 `pi-coffee-t4-l002-20260922T113344Z`，写入 after marker 后原位回滚。回滚后 before marker、VM/SSH 身份、Host 三项 capability、Gitea user ID 6、路由/token、Conversation checkout SHA `c906e721…` 均匹配，after marker 消失，linux001 与 Transfer scope 隔离保持正常。应用侧以 `pi-coffee-t4-user2` 打开 `015745d9-…`，页面渲染 31 个 history entry、无截断提示，项目和分支匹配。脱敏证据见 [`linux002-snapshot-rollback-2026-09-22.md`](../deployment/evidence/linux002-snapshot-rollback-2026-09-22.md)。 |
| 迁移与中断 | linux001 已有真实旧 worktree 保留 dirty/untracked/`.env` 的迁移证据；两台当前 Agent 全套均覆盖迁移中断重试、半成品保护与远端精确确认。 |

真实 VM snapshot rollback 已由虚拟化管理员执行，并由应用侧完成 Conversation
UI 复核。快照恢复门槛已通过。剩余发布约束是上表的 Gitea admin 例外；如果
发布标准要求双向仓库不可见，需要把 `linux001` 迁移到普通 Gitea 用户后重跑
仓库可见性探针。除该项外，双 VM 的执行、LSP、同步、PR、scope 隔离和故障
恢复路径均已实测。

## Issue 状态原则

T0–T3 已具备目标机证据；T4 的 VM snapshot rollback 门槛已完成。`#36` 在
普通用户对称仓库隔离完成或 owner 明确取消该门槛前保持 open。不能用管理员
特权或 fresh-clone 检查替代普通用户的双向仓库可见性探针。
