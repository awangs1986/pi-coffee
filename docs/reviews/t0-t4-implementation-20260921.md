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

## 当前环境明确未通过

本机不是目标 User VM。`npm run probe:owner-access` 返回 owner/service UID
1000、HOME `/home/awang`、`ownerEnvironment: true`，但
`passwordlessRoot: false`。因此这里只证明缺失能力会被准确报告，不能作为
T0 真机成功证据。

本机也没有 `/etc/pi-coffee/routes.json`、`/etc/pi-coffee/web.env`，Host/Web
systemd 服务均未运行。当前无法执行 2 用户 × 2 User VM × 每用户 3 个活动
Conversation、VM 快照恢复、真实旧目录/LSP 重启回滚和完整故障矩阵。

## Issue 状态原则

T0–T4 和 Server T3 均回填实现提交与以上证据，但保持 open。只有在目标
VM 上完成各 Issue 的真机/迁移条件后才能关闭；尤其不能用本地替身和
fresh-clone 检查替代 T4 的双 VM 门槛。
