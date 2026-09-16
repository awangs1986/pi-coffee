# pi-web 评估：与 PI Coffee Web Shell 的结合点（ARCH-001 / OPEN-009）

> 日期：2026-09-03\
> 对象：[agegr/pi-web](https://github.com/agegr/pi-web) `v0.8.11`（MIT，5.8k stars，活跃维护）\
> 基线：PI Coffee `main` 分支的 Web Shell（`public/`，零依赖三文件）与 Host/Web 窄协议\
> 结论性质：工程评估，供 owner 决策；不改变任何已定决策（`D-*`、ADR）

## 1. 一句话结论

**pi-web 不能作为 PI Coffee 的 Web Server 直接采用**——它的架构前提（浏览器、Web 服务、Pi 在同一台机器的同一文件系统，SDK 进程内驱动 Pi）与我们 owner 定义的 MVP 形态（Pi 在 User VM，Web 在服务器）正面冲突。
但它在四个方面是**极有价值的参考实现**，其中两个直接对应我们 0.1 最大的缺口，建议以"借设计、借协议用法、必要时移植组件"的方式结合，而不是 fork。

## 2. pi-web 事实清单

| 项 | 事实 | 来源 |
|---|---|---|
| 技术栈 | Next.js 16 / React 19 / Tailwind 4 / react-markdown + KaTeX + mermaid | `package.json` |
| 规模 | ~2 MB TS；`AppShell.tsx` 110 KB、`ChatInput.tsx` 105 KB、`useAgentSession.ts` 82 KB、`rpc-manager.ts` 75 KB | 仓库树 |
| 驱动 Pi 的方式 | **进程内 SDK**：`createAgentSessionServices()` → `createAgentSessionFromServices()`，一个 `AgentSessionWrapper` 常驻 `globalThis`，空闲 10 分钟销毁 | `lib/rpc-manager.ts` |
| SDK 依赖 | 锁定 `pi-agent-core / pi-ai / pi-coding-agent / pi-tui` 四包 `0.84.3`；使用 `bindExtensions`、`extensionRunner.setUIContext`、`Theme`、TUI keybindings 等**非公开协议面** | 同上 |
| 数据来源 | 直接读 `~/.pi/agent/sessions/**/*.jsonl`、`models.json`、`auth.json`、`settings.json`；会话列表/恢复/重命名/导出/删除全部基于文件 | `AGENTS.md` |
| 浏览器 ↔ 服务 | REST（`/api/agent/[id]` 命令）+ SSE（`/api/agent/[id]/events`）+ 2.5 s 轮询 `/api/agent/running` | `app/api/**` |
| 远程访问 | 单用户 HTTP Basic Auth（`PI_WEB_PASSWORD`，用户名固定 `pi`）；无身份系统 | README |
| 文件访问边界 | `/api/files` 只允许会话 cwd、项目根、`~/pi-cwd-*` 等 allow-list | `lib/path-security.ts` |
| Extension UI | 完整处理 `extension_ui_request`：`confirm / select / input / editor`（阻塞对话框）、`notify / setStatus / setWidget / setTitle / set_editor_text`（即发即忘）、`custom`（用 headless TUI 模拟） | `rpc-manager.ts` |
| 会话结构 | 两种分支：Fork（新 `.jsonl`）与 in-session branch（`navigate_tree`）；`entryIds[]` 与消息一一对应 | `AGENTS.md` |
| 重连/对齐 | 单调 run id 丢弃过期事件；`prompt_done` 后 SSE 保持 30 s 宽限；不在第一个 `agent_end` 关闭（重试/压缩/队列续跑）；`visibilitychange`/`online` 时对齐 `get_state` | `hooks/useAgentSession.ts` |
| 其他 | 工具预设（Chat only / read-only / full）作为**策略**而非安全；子代理开关；worktree 切换；模型/skills/plugins 管理；Web Push 完成通知；i18n（en / zh-CN / zh-TW） | README、ADR-0002/0003 |

## 3. 与 PI Coffee 决策逐条对照

| PI Coffee 约束 | pi-web 现状 | 判定 |
|---|---|---|
| owner 的 MVP 形态：**Pi 在 User VM，server + web 在服务器** | Web 服务与 Pi 必须同机同文件系统 | **冲突**。pi-web 只能整机放进 User VM |
| ADR-0001：Pi 知识只出现在 `pi-adapter.ts`，Web 不知道 Pi 怎么启动 | Pi 知识遍布 API 路由、hooks、组件（SDK 类型、`.jsonl` 格式、`models.json` 结构） | **冲突** |
| D-011：Web Server 在 Debian Control Plane | 若采用 pi-web，Web 服务落到每台 User VM | **冲突** |
| D-020 / ADR-0003：唯一上游 key 只在 Control Plane | Models 面板在本机 `auth.json` 管理各 provider 的 API key | **冲突**（须禁用该面板；模型改为指向 Relay + token） |
| D-007 / ID-001：Gitea 是唯一身份源，多用户 | 单用户 Basic Auth | **冲突**（必须置于我们的 OAuth 代理之后，pi-web 自身鉴权关闭或改造） |
| D-017 / D-018：内容留在 User VM，Control Plane 只存路由 | 内容读写全在本机 | 若 pi-web 在 User VM：**天然满足** |
| D-015 / ADR-0005：不在 VM 内造沙箱 | 工具预设是策略非安全，ADR-0002 讲得很清楚 | **一致** |
| D-025 / D-026 / SHELL-001：一个 tab 多 Task/Session，ID 与 cursor 可恢复 | 会话侧栏来自 Pi 原生会话文件，运行态、上下文用量、成本可见 | **这正是我们缺的**（我们现在是浏览器 `localStorage`） |
| D-027 / ADR-0006：浏览器寿命 ≠ 会话寿命 | SSE 断开不停 Agent；刷新后按 `isStreaming` 自动重连 | **一致**，且对齐规则更成熟 |
| D-030..035 / FILE-001：上传进 User VM inbox、限额、下载引用限定 | 文件浏览/上传/预览完整，但基于同机文件系统 | UI 可参考；服务端实现**不可复用**（须走 Host） |
| D-016 / WORK-001：worktree 是组织机制 | 有 worktree 切换与分组 | 后续参考，非 0.1 |
| D-037：Pi 原生扩展 seam 优先 | 把扩展 UI 完整映射到浏览器，这是 V5 插件在网页可用的前提 | **强参考** |
| D-040：先 TS，Rust 待证据 | TS | 一致 |
| 维护成本（OPEN-009） | 深入 SDK 非公开面，四包锁版本；Pi 每次发版都可能破坏 | 我们的 adapter 只用**文档化 RPC 协议**，风险面小得多 |

## 4. 三种结合路线

### 路线 A：每台 User VM 跑一个 pi-web，服务器只做 OAuth 反向代理 + Relay

- 优点：最快拿到成熟 UI；内容天然留在 VM；会话/分支/文件/worktree 一次到位。
- 代价：推翻 ADR-0001 与 D-011（Web 不再在服务器）、每台 Mint VM 跑一个 Next.js（内存/升级成本）、必须禁用 Models 面板并锁死 Basic Auth、多 Task 并发语义（D-028）交给 pi-web 决定、上游变化直接打到我们。
- 判定：**技术可行的兜底方案，不建议现在走**。它把"服务器上有 server + web"变成"服务器上只有代理"，与 owner 刚刚确认的 MVP 形态相反。

### 路线 B：保持我们的 seam，借 pi-web 的设计与协议用法，按需移植组件（**建议**）

我们的 Host 已经通过 RPC 拿到 pi-web 依赖的绝大部分能力（见第 5 节）；差距在**窄协议没有把它们暴露给浏览器**，以及 shell 没有对应 UI。pi-web 给出了每一项在浏览器上应该长什么样、边界条件是什么。

### 路线 C：fork pi-web，把 SDK 进程内驱动换成对接我们的 Host

- 75 KB 的 wrapper、82 KB 的 hook 与几十个 API 路由都假设 Next.js 服务端能直接 `import` SDK 和读本地文件；要拆掉 Models/Skills/Plugins/Files/Worktrees 五大块并重写数据层。
- 判定：**工作量接近重写，收益低于路线 B**。不建议。

## 5. 路线 B 的具体结合点（按对我们价值排序）

### 5.1 Extension UI 走通到浏览器（V5 插件移植的前提）

- pi-web 证明了在 RPC 语义下能完整支持 `confirm / select / input / editor` 对话框和 `notify / setStatus / setWidget / setTitle`；只有 `custom()` 需要模拟 TUI（我们可以明确**不支持** `custom`，返回降级通知）。
- Pi 0.84.4 的 `docs/rpc.md` "Extension UI Protocol" 与 pi-web 处理的方法集一致，我们的 Host 已在 RPC 进程上，**零 SDK 改动**即可拿到这些事件。
- 落地：窄协议增加 `ui_request`（Host → 浏览器，含 `id / method / payload`）与 `ui_response`（浏览器 → Host）两类帧；Host 侧保留 `pendingUiResponses`（参考 pi-web 的超时与会话替换保护）；shell 增加对话框、toast、状态条/widget 区。
- 归属：`SHELL-001`（#10）前置子任务；直接服务 `D-041` / `PLUGIN-001`。

### 5.2 会话列表与历史来自 Pi 原生会话，而不是浏览器 `localStorage`

- pi-web 的侧栏、恢复、运行态全部来自 `.jsonl` + SDK `SessionManager`。我们的 Host 与 Pi 在**同一台 User VM**，Host 使用 SDK 的只读 session helpers 不违反 ADR-0001（Pi 知识仍封在 `pi-adapter.ts`）。
- RPC 的 `get_session_entries(since)` 提供**跨进程重启的持久游标**（entry id），这正是 `REC-001`（Host 重启后恢复）与 `SHELL-001`（新浏览器看到完整历史）的实现路径；我们目前的内存 replay 缓冲（256 条）只是它的临时替代。
- 落地：Host 增加 `list_sessions / get_history(since)` 两条命令；`opened` 帧返回持久 entry 游标；shell 的会话侧栏改为从 Host 取列表，`localStorage` 只保留 UI 偏好。
- 归属：`SHELL-001`、`REC-001`。

### 5.3 重连与状态对齐规则

pi-web 在 `useAgentSession` 里踩过的坑值得直接照抄成我们的规则：

1. 每次 prompt 一个单调 run id，过期 SSE/对齐响应必须丢弃，防止"复活"旧气泡。
2. 不要在第一个 `agent_end` 认为结束；重试、压缩、扩展排队的消息会继续同一逻辑轮次，以 `agent_settled` 为准（我们已如此）。
3. `visibilitychange` / `online` 时主动 `get_state` 对齐；后台标签页降低轮询。
4. 刷新后若 `isStreaming`，立刻恢复订阅并显示运行态（我们已如此）。

归属：`SHELL-001`，改动小。

### 5.4 输入区控件与 RPC 命令的映射

pi-web 的 `ChatInput` 把 `set_model / set_thinking_level / compact / get_tools / get_commands` 做成了控件。RPC 文档确认这些命令都可用。我们可以只暴露最小子集：模型切换（受 Relay 上 `models.json` 约束）、thinking 级别、手动 compact、**斜杠命令面板**（`get_commands` 列出扩展命令——V5 的 `/harness`、`/verify`、`/handoff` 装上后自动出现）。

归属：`SHELL-001`；斜杠命令面板与 5.1 一起构成插件在网页可用的完整闭环。

### 5.5 消息渲染细节

- 工具调用字段归一化（`{id,name,arguments}` vs `{toolCallId,toolName,input}`）在文件加载与流式两处都要做——我们若引入历史加载（5.2）就会遇到同样问题。
- `edit` 工具的 diff 视图、图片消息、工具耗时；可作为我们 `MessageView` 的参考。我们的渲染器刻意极小，等 5.2 落地再决定是否引入 react-markdown 级别的渲染。

### 5.6 暂不结合的部分（及原因）

| 功能 | 原因 |
|---|---|
| Models / API key 面板 | 违反 D-020；模型来源是 Relay，改为只读的模型选择 |
| Skills / Plugins 管理面板 | 属 `ARCH-002` / `PLUGIN-001`，且要经 Host 执行；0.1 后评估 |
| 文件浏览 / 预览 / 上传 | 服务端逻辑基于同机文件系统；我们的 `FILE-001` 必须经 Host 与 inbox 契约实现，只借 UI |
| Worktree 切换 | `WORK-001`，等 `TASK-001` 语义稳定 |
| 子代理开关、Web Push、i18n | 有价值但非 0.1 范围 |

## 6. 技术栈选择的一个判断

pi-web 说明"一个像 Codex 的完整 Web IDE"最终会走到 React 级别的复杂度（单文件 100 KB 的组件不是偶然）。我们的三文件 shell 适合 MVP，但 5.1–5.4 全部落地后会超过 vanilla 的舒适区。建议的触发条件：**当 `app.js` 超过约 2000 行或需要第三个有状态面板（会话侧栏、对话、扩展 UI 之外）时**，切到轻量框架（Preact/lit 级别，保持无构建或单步构建），而不是直接上 Next.js——后者会改变服务器侧的部署形态（`deploy/` 的 systemd 单元与 `node dist/src/main.js web` 契约）。

## 7. 对 BACKLOG 的建议

- `ARCH-001`：从 `DISCOVERY` 更新为"评估完成，建议路线 B"；`OPEN-009` 记录本文件为答案。
- `SHELL-001`（#10）拆出两条前置子任务：`SHELL-001a` Extension UI 帧与对话框；`SHELL-001b` Host 侧会话列表 + `get_session_entries` 持久游标（与 `REC-001` 共享）。
- `D-038` 保持不变：pi-web 是参考与组件来源，不是运行时依赖。

## 8. 未验证的假设（需要在实现时核对）

1. Pi 0.84.4 RPC 下扩展的 `ui.custom()` 无法支持——按 `docs/rpc.md` 属 TUI-only；V5 插件是否用到 `custom()` 需审计（`V5-001` 的只读审计可顺带做）。
2. Host 使用 SDK `SessionManager` 只读 helper 列会话，需确认该 API 在 `pi-coding-agent` 0.84.4 的导出面上稳定（pi-web 依赖 0.84.3 的同名 API）。
3. `get_session_entries` 的 entry id 在 Host 重启、Pi 进程重建后是否保持一致——RPC 文档称"stable ids / durable cursor"，需用故障演练证实（`REC-001`）。
