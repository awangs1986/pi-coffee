# Chat/Work 运行时迁移验收

日期：2026-09-22。基线为 Gitea Agent main `951b6355`，在独立 clone 的 `codex/chat-work-migration` 分支实施；没有修改旧 arena checkout 或冻结 V5。对应 HARNESS-001/002（#14/#15），[PR #37](http://gitea:3000/awangs/pi-coffee/pulls/37)。

## 交付行为

- 只保留 Chat/Work 类型、renderer、能力 manifest 模式、schema 预算与命令。新增 `/chat`、`/work`，保留 `/harness chat|work` 和状态查询；默认 Work。
- Chat：read、edit、write、bash、web_search；直接搜索，不委派；无系统提示词、自动项目指导或 Skill 元数据。上下文预算保护保留，自动折叠指导与 recall 不注入 Chat。
- Work：read、edit、write、bash、git、search_tools；恢复扩展已安装时增加 recall_folded。Web、网页内容与子 Agent 按需激活；LSP 通过原生 Skill 与 CLI。模型不再看到 ls/grep/find/verify；检索和验证走 Bash。
- Work 保留 Pi Base、项目指令和 Skills，追加通用正文一次。正文只修改已移除 Verify 工具的指导。
- v2 状态写入当前 Pi 会话分支；v1 开发会话追加 Work 状态并通知，保留原始历史，重新激活可选能力。未知版本不写覆盖状态，停止模型请求，用户可显式选择模式恢复。
- 切模式必须等当前 turn 空闲；切模式/模型撤销可选激活。Work 同模式恢复重新校验并恢复可用能力；修复原先激活成功却未持久化的遗漏。
- 历史验证配置与用户显式 `/verify` 命令保留；不再注册为模型工具。
- Server 代码、前端和协议扫描未发现退役模式依赖；命令菜单经 Host 动态发现，无须跨仓协议修改。

## 已执行验证

1. Red：先加入默认 Work 与 Chat 五工具的公共 extension 测试，在原实现上失败（旧活动工具表）。
2. Green：模式切换、v1 会话迁移、别名拒绝、v2 恢复、当前分支、缺失工具、未知版本、能力激活/撤销/恢复以及提示词去重通过。
3. 真实 Pi 0.84.4 CLI + 默认插件 + LSP Skill + 本地 HTTP provider：Chat 切换、切模型、进程停止后恢复均为精确五工具；无 system/developer 消息、项目标记和 Skill 元数据；切回 Work 恢复精确 6+1 工具及 Pi Base/项目/正文。Completions 路径以固定 SSE 成功结束。
4. Responses、Anthropic Messages、Google Generative AI：真实 Pi 序列化后捕获 HTTP 请求，验证空系统指令与五工具。fixture 故意返回 400 并禁止重试，只验证请求装配，不声称供应商模型调用成功。
5. `npm run smoke:toolchain`：pi-lens 关闭/显式加载两组均通过，各 12 步；检查 read/write/edit、Bash 检索/列目录/验证、Git、Web 发现/激活/直接搜索和子 Agent 激活。pi-lens 原生工具已注册但不进入 Work 活动集合；这是约定的暴露边界。LSP 中间层保留既有 CLI 测试。
6. `npm run check`：30 个测试文件、163 项测试全部通过。`git diff --check` 通过。从 Gitea 分支重新 clone 实现提交 `83f7e3d`，`npm ci --ignore-scripts && npm run check` 再次通过同样的 30 文件 / 163 项测试；`smoke:subagents` 与 `smoke:web-access` 加载探针均通过。

## 证据边界

本次固定响应只证明真实 Pi 接线、工具执行和模式隔离，不替代 Eidolon 的自主行为评测。既有真实模型/LSP 报告仍对应其各自版本。第三方自定义扩展列表可替换标准装配，需自行重跑请求边界测试。

此记录不宣称 linux001 已部署该分支；T4 双用户、第二 User VM 与快照恢复也不因模式迁移而自动通过。原始请求、模型配置、凭据和会话正文只在临时测试目录，结束后删除。

复现：`npm ci --ignore-scripts && npm run check`；工具探针：`npm run smoke:toolchain`、`npm run smoke:subagents`。
