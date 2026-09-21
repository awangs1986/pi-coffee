# ADR-0012: VM owner 完整权限与 Gitea 协作工作区

日期：2026-09-21。状态：**accepted；运行时迁移待 T0–T4 实施和验收**。

固定 User VM 已承担执行隔离，跨主机代码协作由 Gitea 统一承载。Host/Pi 以 VM owner 运行，owner 拥有不受命令限制的免密 sudo；平台不增加工具审批、权限等级或目录 sandbox。每个代码 Conversation 使用独立普通 clone 和独占分支，以 Gitea 的远端代码、PR 和 merge 替代平台管理的 Git worktree 与本地集成流程。

使用 owner + sudo 保留用户 HOME、原生 Pi/SSH/Git 配置和文件所有权；直接以 root 启动常驻 Host 没有额外能力收益。独立 clone 增加磁盘和下载成本，但消除共享 Git 元数据与项目级合并锁；当前两用户、每用户三个活跃对话可先接受该成本，缓存优化以后以测量为依据。

## 决策及替代范围

- 扩充 [ADR-0005](./0005-vm-isolation-replaces-in-process-sandbox.md)：明确 owner、sudo 与部署验收；保留用户/Host 身份、网络路由和文件接口边界。
- 扩充 [ADR-0004](./0004-gitea-is-identity-and-ticket-authority.md)：Gitea 同时是当前内部协作代码权威；GitHub 仍可作为后续发布/同步目的地。
- 保持 [ADR-0011](./0011-split-agent-runtime-and-server-repositories.md) 的拆仓边界：Agent 管理 checkout/Git/Gitea 代码操作；Server 管理网页、OAuth 与透明转发。
- 取代 BACKLOG D-016 的平台 worktree 目标、D-028 的工作区表述，以及 Server 工作台规格中的项目级本地 merge 锁/merge token。0.1 的旧 Worktree redesign 延后条款不再阻挡本次 T0–T4。
- 产品不再创建或管理 Git worktree；用户在 Bash 中自主使用原生 Git 不受禁止。

## 完整性边界

Gitea 只保存已推送的版本化代码，不保存未提交文件、Pi transcript、凭据、上传和产物缓存。跨主机接续从已验证的远端 checkpoint 创建新的 Conversation/分支，不自动迁移原生会话，不允许平台把同一分支分配给两个活跃写入者。已有本地工作区与旧协议按迁移计划保留和退出，不因文档决策直接删除。

行为合同见 [工作区 SPEC](../spec/gitea-workspaces.md)，交付和退出旧实现的证据见 [T0–T4](../development/t0-t4-gitea-workspaces.md)。本决策不宣称权限已部署或工作区已迁移。
