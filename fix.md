# PI Coffee 审核修复说明

日期：2026-09-17。目标分支：`arena/01a0a607-pi-coffee`。
修复基于 `1d33508` 的工作台快照，依据根目录 `handoff.md` 与版本化产品 SPEC；完整分析见 [质量审核报告](docs/reviews/completion-quality-20260916.md) 和 [Windows 真机验收记录](docs/reviews/windows-real-machine-acceptance-20260917.md)。

## 改动

1. **保护后台任务**：浏览器断开后，只有确认后台无活动任务才回收 Pi；状态未知或检查失败时保留进程。
2. **恢复操作队列**：一个工作区操作失败不再使后续已排队的有效操作一起失败。
3. **防止误删成果**：永久删除前同时核对实际 HEAD 和登记分支，拒绝删除 detached HEAD 上未合并的提交。
4. **支持手工导入空仓库**：首次创建对话时建立初始空提交，保留用户暂存和未跟踪文件；缺少 Git 作者配置时明确提示。
5. **防止上传覆盖**：完整文件以原子且不覆盖的方式发布，遇到同名文件自动换名，保留并发上传和用户已有内容。
6. **限制上传凭证重用**：已完成文件拒绝再次上传；接收正文前检查文件租约有效性。
7. **及时退出和撤销连接**：先失效网页登录或关闭连接，再联系 VM 撤销文件授权，避免 VM 卡住使旧登录继续可用。
8. **恢复 Pi 崩溃状态**：活动轮次通过公共 RPC 检测明确的进程退出，记录中断、解除 busy、清除旧轮次重放；重新打开后由用户显式重试，多窗口共享恢复过程。
9. **修复移动端布局**：390px 窄屏输入栏允许控件换行，避免附件按钮溢出并保留发送按钮空间。
10. **修复依赖漏洞**：Vitest 从 3.2.4 升至 4.1.11 并更新 lockfile。3.2.7 仍受当前 mocker advisory 影响；最终依赖审计为 0 漏洞，生产依赖版本未改变。
11. **修复 Windows 路径处理**：Git 项目发现统一规范化路径并按 Windows 规则忽略盘符大小写；扩展、worktree 和替换列表测试不再假设 POSIX 分隔符或根路径格式。
12. **支持 Windows ZIP 导入**：User VM 仍以 Linux 为发布目标；代码在 Windows 真机上选择可用的 `python` 启动器，ZIP 安全导入和 traversal 拒绝均实际通过。
13. **修复跨平台浏览器 smoke**：静态资源目录改用 `fileURLToPath`，避免 Windows URL pathname 被当成错误的本地路径。
14. **保留 Linux 安全语义**：权限位断言只在支持 POSIX mode 的平台执行；依赖 `/proc`、`fcntl`、SIGKILL 的进程/admission 验收明确限定 Linux，Linux 上仍完整执行而非放宽断言。
15. **使用可移植失败夹具**：磁盘写入失败和符号链接逃逸测试使用临时文件/目录制造真实错误，不再依赖 `/dev/null` 或 `/etc`。
16. **兼容 Windows 路由文件**：`routes.json` 解析接受 Windows PowerShell 5 写出的 UTF-8 BOM，并增加回归测试；真实 Gitea OAuth 回调不再因 BOM 拒绝固定 VM 路由。
17. **明确跨平台 smoke 结果**：Windows 上继续实际验证 Web Search、context-fold 和 Harness；Linux native subagent smoke 返回带原因的结构化跳过，Linux 上仍执行完整 admission/extension 验收。
18. **增加真实 Gitea OAuth smoke**：自动验证匿名拒绝、PKCE 登录、HttpOnly/SameSite cookie、固定 VM 路由撤销、重新登录和 logout；凭据只通过环境变量传入。

新增公共接口回归和 RPC 进程 SIGKILL 故障测试；另让 verify 测试使用当前 Node 的绝对路径，消除 login shell PATH 差异。同步更新 `handoff.md` 和审核报告。

## 验证

本轮修复验证结果（2026-09-16，Europe/Paris）：

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 成功 |
| `npm run check` | 构建成功，29 个测试文件、156 项通过 |
| `npm audit` | 0 漏洞 |
| `npm run smoke:subagents` | `ok: true` |
| `npm run smoke:web` | `ok: true` |
| `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome npm run smoke:workspace-browser` | 通过，SVG/Markdown、来源切换、归档恢复、390px 布局均验证，pageerror 为 0 |
| `git diff --check` | 通过 |

Windows 11 真机补充验证（Node 24.18.0、npm 11.16.0、Git 2.55.0.windows.3、Python 3.12.10、Chrome 153）：

| 检查 | 结果 |
| --- | --- |
| fresh `npm ci` | 成功，0 个依赖漏洞 |
| `npm run check` | 构建成功；27 个测试文件通过、2 个 Linux 专属文件跳过；143 项通过、13 项 Linux 专属跳过 |
| `npm run smoke:subagents` | `ok: true, skipped: true`；明确记录 Linux native admission 平台边界 |
| `npm run smoke:web` | `ok: true`；Web Search、context-fold、Harness 通过，Linux subagent 部分结构化跳过 |
| `npm run smoke:workspace-browser` | 通过；SVG、Markdown、归档恢复、390px 布局，pageerror 为 0 |
| `npm run smoke:gitea-oauth` | 真实 Gitea 通过；匿名 401、登录、cookie、路由撤销 401、重新登录、logout 204、登出后 401 |
| 真实原生 Pi 模型 smoke | 通过；`open`、流式回复、断线重连、历史恢复、同会话第二轮均成功 |

Windows 真机上的真实模型 smoke 设置 `PI_COFFEE_SUBAGENTS=off`，因为原生子 Agent admission 明确依赖 Linux 的 `/proc`、`fcntl` 和 POSIX 信号。完整子 Agent/Web 扩展 smoke 已在 Linux 通过。未保存模型回复、认证材料或测试会话正文。

环境：Linux、Node 24.19.0、Git 2.47.3、Python3、系统 Google Chrome。浏览器使用假 Pi，原生扩展测试使用本地模型 fixture，均不冒充真实供应商或双 VM 验收。

## 剩余边界

- P5 双用户、双真实 Linux VM、原生认证刷新及完整故障矩阵尚未执行，不能据此宣告发布验收完成；单用户真实 Gitea OAuth/固定路由撤销已在 Windows 真机通过。
- 跨 cwd 子任务、手工后台 shell 和跨目录写入仍没有全局作业关联。
- 崩溃锁清理、删除与元数据保存之间的恢复窗口，以及 PDF、长上传撤销和目标网络设备仍需验收。
- 本次只把修复交付到指定工作分支，不更新 `main`；Gitea #1 记录验收证据，但 P5 未完成前不关闭 Issue。
