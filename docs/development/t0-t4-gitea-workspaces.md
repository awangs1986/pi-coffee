# T0–T4 跨仓交付

唯一五步计划位于 [Agent T0–T4](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/development/t0-t4-gitea-workspaces.md)。设计已接受，五步运行时任务尚未完成。

Server 主责 T3：展示 Checkout/branch、dirty/远端同步状态、checkpoint 重试、真实 PR URL/状态，替换本地合并控件；兼容旧 Host 能力，正确处理归档/清理、旧会话与断线。Server 参与 T4：两 VM/两用户验收、兼容发布、回滚、旧路径退出。T0 owner 权限、T1 Checkout、T2 同步/PR 由 Agent 主责。

公共 HTTP/WS 与浏览器测试验证跨用户访问拒绝、过期同步状态不误报、双窗口重复请求、Host 版本差异、Gateway 重启不停止 Pi。运行 `npm run check` 并从 Gitea fresh clone 复验。工单与证据同步到本仓库 map #1；不能以设计完成关闭实施 ticket。

工单：[T0 / pi-coffee #33](http://gitea:3000/awangs/pi-coffee/issues/33)；[T1 / pi-coffee #34](http://gitea:3000/awangs/pi-coffee/issues/34)；[T2 / pi-coffee #35](http://gitea:3000/awangs/pi-coffee/issues/35)；[T3 / pi-coffee-server #2](http://gitea:3000/awangs/pi-coffee-server/issues/2)；[T4 / pi-coffee #36](http://gitea:3000/awangs/pi-coffee/issues/36)。
