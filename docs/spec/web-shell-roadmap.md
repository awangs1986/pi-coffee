# Web Shell 路线图：像一个简化版 Codex

> 目标（owner，2026-09-03）：Web 端做成一个简化版 Codex——美观、好用。  
> 约束：所有计算在 Host（User VM）；聊天记录永久存 VM；每次打开 Web 都能看到历史（ADR-0008）；Web Server 零状态；一个标签页一个 Shell（D-025）。  
> 本文是差距清单与排期。状态以 Gitea Issue 为准；本文件只做索引。

## 0. 已交付（A / B / C，`SHELL-001c`）

| 组 | 项 | 实现要点 |
|---|---|---|
| A 消息呈现 | 完整 GFM Markdown（标题/列表/表格/链接/引用/分隔线） | `marked` + `DOMPurify`（构建时从 `node_modules` 拷入 `public/vendor-*.js`）；链接强制 `target=_blank rel=noopener`，只允许 `http(s)/mailto` |
| | 代码高亮 + 语言标签 + 复制 | 自写 tokenizer（`public/highlight.js`），无第三方 |
| | 工具卡按类型呈现 | `edit` 用 **Pi 在 Host 上算好的 patch**（`details.patch`，历史里也保留），无 patch 时浏览器按 `edits[]` 算行 diff；`write` 全绿；`read` 代码视图；`bash` 命令 + 输出 |
| | 一轮的"工作过程"折叠 | 同一轮的工具卡收进 `工作过程 · N 步`，运行中展开、结束后收起 |
| | 图片缩略图、复制回复、重新生成 | 用户气泡内缩略图；助手消息悬停出"复制/重新生成" |
| B 对话管理 | 重命名 / 删除（二次确认，真删 VM 上的会话文件） | 协议 `rename_session` / `delete_session`；Host 经 RPC `set_session_name` / 删文件 |
| | 搜索、时间分组、时间与消息数 | 浏览器侧过滤与分组（数据来自 Host） |
| | 列表推送 | Host 在新建/结束/改名/删除/空闲停止时向**所有**连接广播 `sessions` |
| C 输入与控制 | 运行中排队 / 插话 | `prompt.mode = follow_up \| steer` → RPC `follow_up` / `steer`；`queue_update` 显示待发列表 |
| | 模型 / thinking 选择 | `get_models` / `set_model` / `set_thinking`（模型来自 Relay 后的 `models.json`，只读选择，无 key） |
| | 斜杠命令面板 | `get_commands`；输入 `/` 弹出；V5 的 `/harness`、`/verify` 装上即见 |
| | 图片粘贴 / 拖拽 / 选择 | 浏览器缩放到 ≤1600px、JPEG，最多 8 张，随 `prompt.images` 发送 |
| | 上下文用量 / 成本 / 压缩 | `get_stats` → 顶栏 chip；点击 → `compact` |
| | 快捷键 | `Ctrl/⌘+K` 新对话、`Esc` 停止/关闭弹层、空输入 `↑` 召回上一条 |

## 1. 还缺什么

### D. Extension UI（`SHELL-001a`，V5 插件在网页可用的前提）

| 项 | 内容 | 改哪里 |
|---|---|---|
| D1 | `confirm / select / input / editor` 对话框：插件问用户时浏览器能答 | 协议 `ui_request`（Host→浏览器，含 `id/method/payload`）与 `ui_response`；Host 侧挂起表 + 超时/会话替换保护（参考 pi-web `pendingUiResponses`）；浏览器模态框 |
| D2 | `setStatus / setWidget / setTitle` | `setStatus` → 顶栏状态；`setWidget` → 消息流上方的 widget 区；`setTitle` → 会话名同步 |
| D3 | `custom()`（TUI 专用）明确不支持 | Host 返回取消 + 通知，不模拟终端 |

### E. 状态与连续性

| 项 | 内容 | 改哪里 |
|---|---|---|
| E1 | 完成通知：后台标签页标题闪烁 / 角标 / `Notification` | 浏览器 |
| E2 | 对齐规则：单调 run id 丢弃过期事件；`visibilitychange/online` 主动 `get_state` 对齐；重连时校验 `isStreaming` | 协议加 `get_state` 帧；浏览器 |
| E3 | Host 重启瞬间进行中的那一轮恢复 | `REC-001`（Host） |
| E4 | 错误可读化：401/429/超时/断流各自文案 + 一键重试 | 浏览器（Relay 已给结构化 outcome；Pi 的 `message_end.errorMessage`） |
| E5 | 长对话性能：虚拟滚动或分页加载历史（现在 `history` 帧上限 1 MiB，超出截断） | 协议 `history` 分页（`before` 游标）；浏览器 |

### F. 视觉与可达性

| 项 | 内容 |
|---|---|
| F1 | 深色主题跟随系统（CSS token 已集中，改 `:root` 变量即可） |
| F2 | 空态：最近对话 / 建议任务动态化（现在是固定 3 个 chip） |
| F3 | 骨架屏、消息淡入、加载态；滚动到底按钮已有 |
| F4 | 键盘可达：侧栏项/菜单/弹层的焦点管理与 ARIA；对比度检查 |
| F5 | 界面语言：中/英（字符串集中管理后再做） |
| F6 | 移动端：输入区与虚拟键盘、长按菜单 |

### G. 明确不做（与 Codex 不同，源于约束）

- 文件浏览器 / 文件预览：内容在 VM，须经 Host；归 `FILE-001`（上传/inbox/下载引用）
- 模型 key 管理面板：D-020，key 只在 Control Plane
- 多标签页模型：D-025
- 浏览器缓存历史：ADR-0008
- 会话 fork / 分支导航：Pi RPC 支持，但先等 `TASK-001` 定义 Task 语义，避免和 Task/worktree 概念打架

## 2. 排期建议

1. **D（Extension UI）**：下一步；没有它 V5 插件只能"跑"不能"问"。
2. **E1 / E2 / E4**：小改动、体验收益大，可与 D 并行。
3. **F1 / F2 / F3**：视觉层，等 D 落地后一起做，避免两次重画。
4. **E5**：等真实用户出现 1 MiB 以上的会话再做。
5. **E3**：`REC-001`，归 0.1 `OPS-001`。

## 3. 技术栈判断

三文件 shell 已拆成 ES modules（`app.js` 控制器、`render.js` 渲染、`highlight.js`、`diff.js`），加两份 vendored 库，无构建步骤。`app.js` 约 600 行、`render.js` 约 300 行——仍在原生 JS 的舒适区。**切轻框架的触发条件**保持不变：D 落地后若模态框/widget/对话的状态机让 `app.js` 超过约 1500 行，再切 Preact（vendored，无构建）；不上 Next.js。
