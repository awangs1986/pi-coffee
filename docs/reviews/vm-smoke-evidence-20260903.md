# PI Coffee 实机 VM 模拟证据

执行日期：2026-09-03（Asia/Hong_Kong）

代码：`main` `280939e`

测试方式：临时用户目录和临时 Node 进程；没有安装 systemd unit，也没有修改 V5。

## 拓扑

| VM | 角色 | 系统 | 地址 |
|---|---|---|---|
| `server-test` | Control Plane：Relay + Web Server | Debian GNU/Linux 13 | `192.168.122.61` |
| `client-test` | User VM：Agent Host + 原版 Pi | Linux Mint 22.3 Xfce | `192.168.122.60` |

两台 VM 均以用户 `awang` 登录。测试临时安装 Node `v22.23.2`，项目目录为
`/home/awang/pi-coffee-smoke`，运行数据位于临时 runtime 目录。上游 key 只注入
`server-test` 的 Relay 进程环境，没有写入仓库、models 文件、日志或本报告。

## 通过项目

1. `server-test` Relay `/healthz` 返回 `role=relay`；无 bearer token 的
   `/v1/models` 返回 `401`，带 Relay token 返回 `200` 并取得模型列表。
2. `client-test` Host `/healthz` 返回 `role=host`；无 Host token 的 WebSocket
   upgrade 返回 `401`。
3. `server-test` Web `/healthz` 返回 `role=web`，静态首页返回 `200`。
4. `scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws` 通过真实链路：
   Browser → Web → Host → 原版 Pi → Relay → CPA。结果为 2 个 `text_delta`、
   17 个事件、约 9.7 秒完成，cursor 连续 `1..17`。
5. 关闭第一个浏览器连接后，第二个连接从 Host 的 durable session store 得到
   2 条历史记录、没有重复 replay；带最新 cursor 重连得到 0 个事件；同一
   Session 的第二轮使 cursor 从 `17` 前进到 `35`。
6. 另一个中途断开测试在 prompt ack 后立即关闭浏览器，等待任务完成，再次打开
   Session；历史中包含 `detached continuation`，证明浏览器断开没有杀掉 Host/Pi
   任务。
7. 环境边界检查显示：上游 credential 环境项只出现在 Relay；Web 没有上游/Serper
   环境项；Host 只持有它自己的 Relay token。测试输出没有打印任何 key 值。

## 未覆盖项目

- 本次没有配置 Serper key，因此没有执行真实 `/v1/search/serper` 查询；Web Search
  的离线/Relay stub 测试仍由 `npm run smoke:web` 和单元测试覆盖。
- 没有执行 systemd 安装、Gitea OAuth、文件/图片上传、Host 崩溃恢复或 Podman
  smoke；这些仍属于 #9、#11、#12、#24 的后续验收。
- 这是一次真实 VM 上的用户态模拟，不等同于生产发布；临时进程和目录在证据收集
  后停止并清理。
