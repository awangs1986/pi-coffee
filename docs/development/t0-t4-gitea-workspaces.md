# T0–T4：完整 VM 权限与 Gitea 工作区迁移

日期：2026-09-21。五项任务均为 **READY / 未实施**；设计文档已确认，不据此关闭实施工单。前置拆仓已完成；GitHub 同步不在本轮范围。

权威：[ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md)、[GW-01～12](../spec/gitea-workspaces.md)。本计划替代旧 P0–P5/MV-02/MV-03 中 worktree/本地合并相关排期，不替代其余文件网关、Chat/Work、上下文恢复等待办。

| 顺序 | 工作 | 主责 | 依赖 | 工单 |
|---|---|---|---|---|
| T0 | VM owner 权限与 Work 授权边界 | Agent | 已拆仓 | [pi-coffee #33](http://gitea:3000/awangs/pi-coffee/issues/33) |
| T1 | Gitea Project 与独立 Checkout | Agent | T0 | [pi-coffee #34](http://gitea:3000/awangs/pi-coffee/issues/34) |
| T2 | Checkpoint、PR 与跨主机接续 | Agent | T1 | [pi-coffee #35](http://gitea:3000/awangs/pi-coffee/issues/35) |
| T3 | Server 工作台与旧工作区迁移 | Server；Agent 配套 | T2 | [pi-coffee-server #2](http://gitea:3000/awangs/pi-coffee-server/issues/2) |
| T4 | 双 VM 验收、删除旧实现与发布 | Agent；Server 联验 | T3 | [pi-coffee #36](http://gitea:3000/awangs/pi-coffee/issues/36) |

## T0 — 固定完整执行权限和授权语义

范围 GW-01～03。维护安装/升级脚本、systemd 与运行手册：owner 身份、真实 HOME/PATH、经校验的 sudoers 配置；不将 Host 直接改为 root。配置只作用于目标 User VM owner。通过原生扩展/项目上下文暴露实际能力及 Conversation 分支预授权，不在通用 Work 正文写产品身份，不引入工具审批内核。

先红后绿：在公开启动/扩展接缝验证身份/能力缺失错误、已授权操作不重复请求、共享分支等动作仍按范围处理；在可恢复测试 VM 中从真实 Host 子进程执行 `id`、`sudo -n id -u` 和 owner HOME/Git/Pi 配置探针。覆盖服务重启和重复安装。真实模型验证一次 sudo 操作与正常分支 push 的发现/执行，并验证未授权共享动作不被自动执行。

退出条件：非 root Host 的子进程可按需获得 UID 0；Bash/Edit/Git/LSP 使用同一 owner 环境；网络鉴权/用户路由/文件 scope 回归通过。记录证据，不通过日志输出凭据。该阶段不顺带完成 Chat/Work 整体迁移。

## T1 — 替换 Project 和 Checkout 公共接口

范围 GW-04～06、GW-12 的加法协议。登记 Gitea repo ID、URL/默认分支、VM 身份及独占 branch。实现独立 clone、精确起点 SHA、幂等创建/失败状态、按 Conversation 串行；补充 Host capability 和元数据版本。四个项目入口先导入 Gitea，空仓库初始化明确作者，不覆盖非空远端。旧状态保留可读兼容。

先红后绿：公共 workspace/Host API 测试新项目、同仓两个并行 Conversation、指定分支、空仓库、URL/ZIP 导入、重名/分支碰撞、网络/认证失败及创建中重启。证明 `.git` 为独立仓库、工作目录正确，删除一个测试 checkout 不损坏另一个，LSP 不串项目。

退出条件：新会话不再调用 `git worktree add`；六个 Conversation 可独立构建/编辑；无项目级 Git 操作锁；创建失败不出现可运行的半成品。旧 Server 仍可使用旧工作区接口，新能力不会暗改 v1 行为。

## T2 — 形成代码同步和 PR 闭环

范围 GW-07～10。实现明确文件范围的 checkpoint/正常 push、远端 SHA 核查、dirty/ahead/behind/diverged/unknown 状态、本地 diff 远端基线、Gitea PR 薄适配；阶段交付/准备接续时触发同步，归档仅在可安全执行时尝试。跨主机接续创建新 Conversation/分支，源代码 SHA 可追溯；不迁移 Pi 会话。

先红后绿：真实 Git + Gitea API 替身测试，再在一次性 Gitea 仓库验证 push 成功/拒绝/超时但已成功、远端前移、重复创建 PR、PR 关闭/冲突/无权限、网络断开恢复；证明不会 force push 或把未知文件、transcript、凭据纳入 checkpoint。另一主机从确认 SHA 接续，原会话继续工作不会抢新分支。

退出条件：状态不误报同步；PR 指向真实 repo/head/base，重试不产生重复 PR；Gitea 合并后 Host 能刷新目标基线；本地代码与测试可继续离线运行。现有原生 Bash/Git 能力仍保留。

## T3 — 更新工作台并迁移存量工作区

范围 GW-11～12，Server UI 与 Agent 迁移器配套。将本地合并按钮替换为同步状态、checkpoint 重试及真实 PR 链接/状态；比较视图显示基线 SHA/陈旧状态。浏览器/Gateway 不实现 Git 引擎。由 Host 能力协商兼容旧版本；公开原生错误，不把网络失败画成已保存。

迁移器先盘点/预演，再按会话停写、保留本地数据、构建 clone、校验、原子切换映射，之后重启对应 LSP；中断时能恢复或回滚。归档与清理分别展示未同步代码、未版本化文件、历史/上传/产物/branch/PR 的去留。

先红后绿：公共 HTTP/WS + 浏览器覆盖旧/新 Host 混用、刷新/断线、双窗口重复操作、运行中归档、清理中断、不同步/远端不可达时不自动清理；存量迁移覆盖 dirty、untracked、ignored、未推送 commit、已归档和无 cwd 会话，文件与历史引用不得丢失。

退出条件：所有核心操作在 UI 可见且与 Host/Gitea 一致；跨用户拒绝；浏览器/Gateway 重启不停止 Agent；旧会话可读/可迁移/可回滚。清理不会连带删除共享项目或远端成果。

## T4 — 实测、移除旧路径并完成发布

范围全部 GW 条款。以两个真实用户、两台 User VM、每用户三个活跃 Conversation 验证执行、LSP、同步、PR、接续和归档。覆盖 Gitea 离线、Git 凭据失效、分叉 push、Host/Pi/Server 重启、VM 快照恢复、远端 branch 被删除和迁移中断。

先保留旧路径做升级/回滚演练；确认部署的 Server 都兼容、存量迁移验收后，移除平台 worktree 生命周期、本地 merge proposal/token、项目 merge 锁和旧 UI/测试假设。原生 Git worktree 命令不是禁用对象。按实际协议变化发布版本，旧客户端收到明确不兼容错误。

退出条件：两仓各从 Gitea fresh clone 运行 `npm ci && npm run check`；公共 seam 跨仓 smoke、真实模型工具/LSP 探针、两 VM 故障矩阵和迁移回滚均有版本化证据；Issue 写入具体 commit、命令、结果及尚未满足项。依次发布兼容 Host → Server → 旧路径退出版本；部署不清理用户数据。未通过真机门槛不得以本地替身测试关闭 T4。

## 本轮交付边界

本轮只修改正式决策、术语、跨仓职责与任务排期，建立 Gitea 跟踪；不修改 sudoers、不切换线上 Host、不搬移任何现有 checkout、不自动合并 PR。实施进展与验收以五个工单为准。
