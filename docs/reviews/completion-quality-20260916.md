# 完成质量审核与修复（2026-09-16，Europe/Paris）

审查分支 `arena/01a0a607-pi-coffee`，原始 HEAD `1d33508`；比较基线为 handoff 指定的 `fd20b6c8f266bc9a1e27de51687d327a16a09394`。
范围命令：`git diff fd20b6c8f266bc9a1e27de51687d327a16a09394...HEAD`，原始提交只有 `1d33508 feat: capture Pi Coffee workbench implementation and review handoff`。

依据：根目录 `handoff.md`、`AGENTS.md`、`docs/development/workflow.md`、`docs/development/product-priorities-20260916.md`、`docs/spec/multi-user-vm.md`。Standards 与 Spec 独立并行审核，再针对确认的问题修复。内部 Gitea 本轮连接失败，未写入或关闭 Issue。

完成质量结论：P0–P4 已有可运行的主要流程，但原快照存在数据保护、身份失效和故障连续性缺陷，不能仅以原有 144 项测试认定可发布。本轮修复下列问题；P5 和已披露的跨 cwd 等边界仍未完成。

## Standards

1. **P1，规范问题，已修复：断线闲置回收可能停止后台工作流父进程。** `src/host/session.ts` 原先只看父对话是否 streaming；原生扩展 shutdown 会停止后续调度与结果监听。违反 `AGENTS.md` 的 “Preserve the Host session lifetime across browser disconnects”。现在只在后台状态已知且无作业时回收，未知/活跃/查询失败时保留，并在异步探测后重查重连与运行状态。新增两个 Host WebSocket 回归先失败后通过。
2. **P2，判断项，已修复：possible Duplicated Code 导致队列恢复策略漂移。** `src/host/workspaces.ts` 的 `save()` 已恢复 rejected tail，`mutate()` 却直接 `.then(run)`，导致一项失败取消已经排队的另一项有效操作。现在每个操作独立报告失败，后继仍正常执行；真实 Git 回归先失败后通过。此项同时影响 Spec，不重复计算为两次修复。

未发现 Host/Web 直接导入 Pi internals 的规范违规。新故障探测也保留在 Pi adapter 的公共 RPC 接口内。

## Spec

| 问题 | 合同与影响 | 修复和回归证据 |
| --- | --- | --- |
| P1：删除遗漏 detached HEAD 的提交 | §6：“未提交或未合并内容……未经明确授权不执行破坏性清理”；原先仅检查登记分支，可能丢失已脱离该分支的成果 | 删除前同时检查实际 HEAD 与登记分支均已合入；回归确认拒绝删除且文件仍在 |
| P2：手工发现的空仓库不能新建对话 | §4.2：“空仓库必须建立可创建 worktree 的初始提交流程” | 首次创建对话时初始化空提交，保留原 index/未跟踪文件；作者缺失时提示配置 |
| P2：失败操作连带取消排队操作 | P1-03：“同项目多个对话独立运行” | 同项目错误分支请求失败后，后续有效创建成功；与 Standards 第 2 项为同一问题 |
| P1：重叠上传静默覆盖同名文件 | P3-03 文件边界与 §4.3 附件隔离；准备上传时的文件名检查不能保护最终发布 | 用同目录原子 hard link 发布完整文件，存在同名文件则换名；覆盖并发批次与准备后用户新建文件两个失败用例 |
| P2：已完成上传凭证可以重用 | §5.1：“重复操作……避免重复”；批次还有待传文件时重传已完成项会覆盖内容 | 已完成文件拒绝再次上传；回归确认原文件保持不变。过期租约也在接收正文前拒绝 |
| P1：VM 无响应延迟退出/连接撤销 | §2.1：“退出……必须有明确连接失效行为”；原先等待最长 125 秒的远端文件撤销 | 先使 Web 登录失效、返回退出响应；连接撤销先关闭桥接，再异步联系 VM。堵住撤销端点的 HTTP 回归先失败后通过 |
| P1：Pi ack 后退出使 Host 永久 busy | §8：“未完成轮次明确标记中断；不自动重放副作用命令” | adapter 在活动轮次通过公共 RPC 探测明确进程退出，Host 标记中断并清运行状态；显式重新打开恢复，旧轮次不重放 |
| P2：390px 页面横向溢出 | §7：小屏支持折叠；附件按钮被模型选择器挤出屏幕 | 输入栏允许控件换行，保留发送按钮空间；原浏览器 smoke 复现失败，修复后通过 |

## 依赖安全

原 `npm audit` 报 1 critical、1 moderate，均为开发依赖。尝试 handoff 建议的 Vitest 3.2.7 后 critical 消失，但当前 advisory 仍报告 mocker 路径访问漏洞。最终锁定 **Vitest 4.1.11**，fresh `npm ci` 成功，审计 **0 漏洞**；未使用 `audit fix --force`，原生产依赖版本未变化。更新了一个测试 fixture 的 Node 可执行路径，使其不依赖 login shell 的 PATH；未更改原生 verify 的执行语义。

## 验证环境与范围

本轮使用 Linux、Node 24.19.0、Git 2.47.3、Python3、系统 Google Chrome。工具安装与运行日志置于仓库外，浏览器、凭据及 node_modules 不纳入修复。

实际执行：`npm ci`、`npm audit`、`npm run check`、`npm run smoke:subagents`、`npm run smoke:web`、`PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome npm run smoke:workspace-browser`。

最终结果：构建成功；**29 个测试文件、155 项通过**；两个原生扩展 smoke 均 `ok: true`；Chrome 工作台 smoke 通过；`npm audit` 为 0 漏洞；`git diff --check` 通过。

浏览器 smoke 使用真实 Chrome、本地 Host/Web/Transfer 和假 Pi，验证来源切换、消息、SVG/Markdown 预览、归档恢复与 390px 布局，pageerror 为 0。原生 Pi 专项使用本地模型 fixture，不是实际供应商证据。最终测试数量与结果见根目录 handoff 的本轮审核记录。

## 仍待验收

- **P5 未执行**：真实 Gitea OAuth/撤销、供应商认证刷新、两台目标 VM、2 用户 × 3 对话、完整网络和重启故障矩阵；不能把 AC-01～12 标为全部通过。
- 跨对话指定其他 cwd、用户手工后台 shell 与跨目录写入仍没有全局作业关联。worktree 和生命周期检查不是任意 VM 写入者的隔离内核。
- 单项目根单 Host、崩溃锁人工检查、物理 worktree 删除与元数据写入之间的恢复窗口、导入失败目录保留，继续按 handoff 边界处理。
- PDF、长上传撤销、目标设备/网络表现及历史部署文档一致性仍需发布前验收；本轮本地 smoke 不代替这些证据。

Standards 2 项（最严重：断线回收中断后台工作，已修复）；Spec 8 项（最严重：误删/覆盖成果及身份、连续性缺陷，已修复）；另修复依赖安全 1 项。两轴共享队列问题，合计 10 个不同修复项。
