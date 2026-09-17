# PI Coffee Windows 真机验收记录

日期：2026-09-17（Europe/Paris）  
分支：`arena/01a0a607-pi-coffee`

## 目的与边界

本次在独立 Windows 11 真机 fresh checkout 上复核仓库能否安装、构建、运行跨平台测试、启动 Chrome 工作台，并通过原生 Pi 的真实模型链路。产品发布目标仍是 Debian Control Plane + Linux Mint User VM；Windows 结果用于发现可移植性缺陷，不替代 P5 的双 Linux VM、Gitea OAuth/撤销和完整故障矩阵。

测试中没有把密码、API key、cookie、认证文件、模型回复或用户 transcript 写入仓库和本记录。

## 环境

| 项目 | 版本 |
| --- | --- |
| Windows | Windows 11 Pro，build 26200 |
| Node.js | 24.18.0 |
| npm | 11.16.0 |
| Git | 2.55.0.windows.3 |
| Python | 3.12.10（命令为 `python`） |
| Chrome | 153 |

fresh checkout 的 `npm ci` 在约 17 秒内成功，`npm audit` 报告 0 漏洞。

## 初始失败与修复

初始 `npm run check` 构建成功，29 个测试文件中 131 项通过、24 项失败。失败被复现并归到以下边界：

1. Windows/NTFS 不提供可等价断言的 POSIX 0600/0700 mode。
2. 测试假定 `/` 根路径、`:` path delimiter、`/etc` symlink 和 `/dev/null` 失败路径。
3. 子 Agent RPC 测试用字符串替换把 `src` 映射到 `dist/src`，Windows 路径分隔符使映射失效。
4. Git 返回的顶层目录与 Node 的 native path 在盘符大小写和分隔符上可能不同，导致手工项目发现失败。
5. ZIP 导入写死 `python3`，而 Windows 只有有效的 `python` 命令。
6. 浏览器 smoke 把 URL pathname 直接当文件系统路径，Windows 上静态资源返回失败。
7. 原生 admission/process 测试依赖 Linux `/proc`、Python `fcntl` 和 POSIX 信号；这属于 Linux User VM 的实现边界。

修复后，路径比较先规范化并在 Windows 上忽略大小写；Python 启动器按平台选择；测试用平台原生 path API 和临时文件系统夹具；浏览器静态目录用 `fileURLToPath`。Linux 专属进程测试显式标注平台，并继续在 Linux 全量运行。

## 最终证据

| 环境/命令 | 结果 |
| --- | --- |
| Windows `npm run check` | 构建成功；27 个文件通过、2 个 Linux 专属文件跳过；142 项通过、13 项 Linux 专属跳过 |
| Windows `npm audit --audit-level=low` | 0 漏洞 |
| Windows `npm run smoke:workspace-browser` | 通过；无 pageerror；SVG 与 Markdown 渲染、归档恢复、390px 布局均通过 |
| Windows 真实模型 smoke | 退出 0；`open`、流式回复、断线重连、历史恢复、无旧事件重放、同会话第二轮均通过 |
| Linux `npm run check` | 29 个文件、155 项全部通过 |
| Linux `npm run smoke:subagents` | `ok: true` |
| Linux `npm run smoke:web` | `ok: true` |
| Linux Chrome 工作台 smoke | 通过；无 pageerror |
| `git diff --check` | 通过 |

Windows 的真实模型运行设置 `PI_COFFEE_SUBAGENTS=off`；默认子 Agent extension 会明确拒绝非 Linux admission。Linux smoke 已验证 `pi-subagents`、Web 工具、context-fold、Harness tool table 和命令注册。

## 未满足的发布门槛

- 尚未在两台真实 Linux User VM 上执行 2 用户 × 3 活跃对话、重启、断网和进程故障矩阵。
- 尚未用真实 Gitea OAuth app 执行登录、cookie 生命周期、logout 和身份撤销测试。
- Windows 上不支持 Linux native child admission；这不是发布目标，也没有用弱化实现模拟通过。

因此本记录支持“本轮质量问题已修复并有跨平台真机证据”，不支持关闭 P5 或宣告完整生产发布验收完成。
