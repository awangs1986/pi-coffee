# ADR-0012: VM owner 权限与 Gitea 工作区（跨仓引用）

日期：2026-09-21。状态：accepted；Server 运行时代码已迁移，部署验收待 T4。

正式决策由 Agent 仓库单点维护：[ADR-0012](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/adr/0012-owner-privileges-and-gitea-checkouts.md)，完整合同见 [GW-01～12](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/gitea-workspaces.md)。

Server 保留 OAuth、固定 VM 路由、透明代理和网页状态展示；不执行 Git、不持有 VM Git 凭据、不复制 checkpoint/PR 状态机。UI 由本地 merge 控件迁移到真实同步状态与 Gitea PR 链接。权限与 Checkout 由 Agent Runtime 实施；浏览器/文件请求鉴权继续有效。交付跟踪见 [T0–T4](../development/t0-t4-gitea-workspaces.md)。
