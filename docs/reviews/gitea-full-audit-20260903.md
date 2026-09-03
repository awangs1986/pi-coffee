# PI Coffee Gitea 全量代码与合并申请审计报告

审计日期：2026-09-03（Asia/Hong_Kong）  
审计对象：`awangs/pi-coffee` 当前 `main`，以及 Gitea Issues/PRs 记录  
审计基线：`c014faf`（Web/Host Shell 设计审计之后）→ `0ca71e7`（当前 `main`）  
参考边界：Picode 的 V5 仓库是冻结参考，本次没有读取其工作树，也没有修改它。

## 结论摘要

当前 `main` 已经形成可交接的 PI Coffee MVP 代码骨架，并合并了 Harness、
`pi-subagents`、`context-fold`、可选扩展、Relay-backed Web Search 和浏览器
Shell。离线测试和无凭据扩展 smoke 全部通过，最近一次安全审计发现的两条
凭据边界问题也已在 PR #28 修复。

这不是“真实两台 VM 已上线”的证明。真实 Linux Mint User VM、Debian
Control Plane、上游 CPA、Gitea OAuth、上传/图片和故障恢复仍由未关闭的
Issue 验收；在这些证据产生前，不应把 0.1 或 Web Search 称为生产可靠。

## 审计范围与方法

- 读取当前 `main` 的源代码、测试、部署模板、规格、ADR、Backlog 和研究记录。
- 从 Gitea API 核对 Issues、PR 状态、合并提交、分支和保护状态。
- 执行依赖安装、TypeScript 构建、单元/集成测试、扩展 smoke、差异空白检查
  和生产依赖漏洞扫描。
- 没有读取、写入或在报告中记录任何密钥、Cookie、完整 transcript、用户文件
  或 VM 凭据。

## 当前代码交付

| 层 | 当前实现 | 证据 |
|---|---|---|
| Browser/Web | 静态 Codex 式 Shell、对话列表/历史、流式事件、断线重连、UI dialog、模型和用量操作 | `public/`、`src/web/server.ts`、`src/host/server.ts`、`test/web-server.test.ts`、`test/host-server.test.ts` |
| Host/Pi | 原版 `@earendil-works/pi-coding-agent@0.84.4` RPC adapter、Session registry、原生 transcript 恢复 | `src/host/pi-adapter.ts`、`src/host/session.ts` |
| Relay | Chat Completions/Responses 的 JSON/SSE 透传、models、compact、Serper route、限额和 token seam | `src/relay/server.ts`、`test/relay-server.test.ts` |
| Harness | V3-derived Lean/Full prompt；冻结 V5 Simple 8 / Full 10 工具表；native `git`/`verify` | `src/harness/`、`docs/spec/harness-*.md` |
| Native extensions | `context-fold@0.4.0`、可选 `pi-lens`/`rpiv-todo`/`pi-mcp-adapter`、`pi-subagents@0.63.0` | `src/pi-extensions.ts`、`package.json` |
| Web research | 本地 `web_search` → Control Plane Serper Relay；可选 native child brief；User VM Markdown 封盘；后续 context 使用 pointer + conclusion | `src/web/extension.ts`、`src/web/research-artifact.ts`、`src/web/search.ts` |
| pi-web-access | 通过 Pi 原生 extension manager + Jiti adapter 加载；冲突的 `web_search`、`/websearch`、`/curator` 注册被屏蔽，内容工具保留 | `src/web/pi-web-access-adapter.ts`、`docs/research/pi-web-access-audit-20260903.md` |
| Capability registry | manifest、trust/readiness、schema budget、执行 epoch 和持久设置 seam | `src/capabilities/` |
| Deployment | systemd/env 模板和 Podman 两机 smoke 材料；不管理 VM 生命周期 | `deploy/`、`scripts/smoke-podman.mjs` |

## 验证结果

| 检查 | 结果 | 备注 |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 通过 | 安装 532 packages；仅有上游弃用提示 |
| `npm run check` | 通过 | TypeScript build；15 个 test files、90 个 tests 全绿 |
| `npm run smoke:web` | 通过 | Web/Harness/pi-subagents/pi-web-access/context-fold 注册、工具和 `/websearch` 命令均符合预期 |
| `npm run smoke:subagents` | 通过 | `subagent`/`bg_wait` 可发现；Harness Simple=8、Full 基线不被改变 |
| `git diff --check` | 通过 | 当前工作树无空白错误 |
| `npm audit --omit=dev --audit-level=high` | 通过 | 生产依赖报告 0 vulnerabilities |
| `scripts/smoke-real-model.mjs` | 未在本次审计运行 | 需要真实 Relay/模型配置；凭据不进入仓库 |
| `scripts/smoke-podman.mjs` | 未运行 | 当前审计环境没有 `podman` 命令；不是通过/失败证据 |

离线验证证明的是代码路径和边界，不替代真实 VM 验收。真实部署证据应追加到
Issue #5、#18、#24 和 #12，且不包含密钥或完整正文。

## 凭据与数据边界审计

### 已修复

1. **研究封盘脱敏（PR #28）**：`redactSecrets()` 现在覆盖
   `PI_COFFEE_UPSTREAM_KEY`、`PI_COFFEE_RELAY_TOKEN`、
   `PI_COFFEE_SERPER_KEY` 和 `SERPER_API_KEY`。`src/web/extension.ts` 在
   `pi.appendEntry` 或浏览器 custom message 之前也先脱敏结论，不再只有 Markdown
   文件被清洗。
2. **Host 子进程密钥继承（PR #28）**：`buildHostChildEnv()` 使用显式
   `undefined` overlay 覆盖 Pi RPC 客户端对 `process.env` 的合并，阻止
   upstream/Serper/Relay token 环境项进入子 Pi。这样 `npm start all` 的开发
   共进程模式也不会把 Relay credential 传给 Host child；生产仍推荐分离 VM/进程。
3. **搜索入口隔离（PR #27）**：官方 `pi-web-access` 的同名 tool 和搜索命令
   不会覆盖 PI Coffee 的 Relay-backed `web_search`；本地 `/websearch` 明确指向
   Control Plane Relay。

### 需要真实验收的边界

- 官方 `source_check` 仍由 `pi-web-access` 自己执行 provider search；它可能读取
  `~/.pi/web-search.json` 的 provider 配置。当前文档要求 User VM 不放 Serper
  key，但必须在 #24 用 capability trust/readiness 和真实环境证明该策略，不能把
  “屏蔽同名 web_search”误解为所有官方搜索 provider 都已代理化。
- `web-access` manifest 默认记录 `runnerConformance: not_run`，直到真实 User VM
  完成加载、凭据和内容工具验收。
- Web research child 使用 `fresh` context 和 zero-tool budget，只分析已由 Relay
  返回的 bounded snippets。若产品要求 child 自己再发起网络搜索，应另开设计/验收
  ticket，不应悄悄扩大当前能力的网络边界。

## Issues 全量状态（Gitea）

PR 记录在下一节单独列出；下面只列实际 Issue。

| Issue | 状态 | 审计结论 |
|---:|---|---|
| #1 | open | 产品地图；MVP 方向仍有效 |
| #2 | closed | 协议与 cursor replay 已实现 |
| #3 | closed | RPC adapter/session seam 已实现 |
| #4 | closed | Web Server 与最小 Shell 已实现 |
| #5 | open | MVP 端到端真实/运行手册验收仍需执行 |
| #6 | open | 交接入口；应在 MVP/0.1 验收完成后更新并关闭 |
| #7 | open | Relay 代码已在 main；需要部署/故障证据 |
| #8 | open | Gitea OAuth 与固定 User VM 路由尚未实现 |
| #9 | open | Deployment Skill/enrollment 尚未实现 |
| #10 | open | 多 Task/Session 的 0.1 语义和真实重连仍待验收 |
| #11 | open | 文件上传、图片消息、下载引用尚未实现 |
| #12 | open | 全栈故障、快照恢复和发布验收尚未完成 |
| #13 | open | 全量 Backlog；正文中的早期测试提交号已过时，应以本报告和当前 main 为准 |
| #14 | open | Lean/Full prompt 已在代码中；按工单留下最终验收证据后关闭 |
| #15 | open | V5 8/10 Harness 已在代码中；工具可靠性仍由 #16 验证 |
| #16 | open | 基础工具可靠性与扩展工具未来计划；尚未完成实 VM 矩阵 |
| #17 | open | `pi-subagents@0.63.0` 已接入；Issue 本身仍需验收关闭 |
| #18 | open | 真实 child lifecycle、断线、重启验收未完成 |
| #23 | open | WEB-001 代码切片已交付；建议补充本报告/测试证据后关闭 |
| #24 | open | WEB-002 真实 User VM/Control Plane Web Search 验收，当前是主要发布门槛 |

## PR 全量状态（Gitea）

所有列出的 PR 均为 `closed` + `merged=true`，API 返回 `mergeable=true`；没有发现
未合并冲突。合并后的 `main` 为 `0ca71e7`。

| PR | 合并提交 | 内容与审计结论 |
|---:|---|---|
| #19 | `de07c98` | context-fold 默认 compaction；已合并 |
| #20 | `64d1ac6` | opt-in pi-lens；已合并，默认不加载 |
| #21 | `498f46c` | opt-in rpiv-todo；已合并，默认不加载 |
| #22 | `ed7f153` | opt-in pi-mcp-adapter；已合并，默认不加载 |
| #25 | `01c2911` | Relay-backed Serper search、native brief、Markdown closure；已合并 |
| #26 | `fa290e5` | extension source 结尾空白清理；已合并 |
| #27 | `b27e9af` | 屏蔽官方搜索 tool/commands 的覆盖与旁路；已合并 |
| #28 | `0ca71e7` | 研究结论/Serper 脱敏和 Host child env 凭据隔离；已合并 |

Shell 的若干提交（`66e37e1`、`0c2baca`、`8c51cab`、`362d252`）直接进入了
`main` 的后续合并链，而不是独立 PR。此行为与“Gitea 不设置 branch protection”
的 owner 决策一致，但审计上应明确它们没有单独的 PR review 记录。

## 分支与治理

当前远程有 `main` 及 5 条功能分支；所有分支 API 状态为 `protected=false`。
这符合已确认的账号权限治理方案，但意味着误推送、直接提交和未审查扩展都由账号
保护承担。合并分支是否删除由 owner 决定，本次没有删除任何分支或历史。

## 非阻塞代码质量观察

- `rawDataToBytes`、`isLoopback`、`isDisabled` 等小 helper 在 Host/Web/Relay
  间重复。它们当前行为一致，建议在下一次传输层变更时抽为共享模块，降低漂移风险。
- `src/capabilities/catalog.ts` 的 MCP/skill/builtin、proxy/resident/lease
  抽象超出当前 Web/Subagent manifest 的直接需要。它有利于后续 V5 能力迁移，
  但应继续保持未激活并为每种新 capability 单独加验收，不要让泛化层变成隐式产品
  范围。
- Relay 同时承担 LLM 透传和 Serper handler；若未来两者变化频繁，可拆成共享认证/
  记录层加两个 route handler。目前共用边界清楚，暂不构成发布阻塞。

这些是维护性建议，不是当前测试失败或安全漏洞。

## 429 运维结论

`exceeded retry limit, last status: 429 Too Many Requests` 是 CPA/上游（经反代返回）
的限流响应，不是 Web Search 插件自身的协议错误。Pi 默认将 429 视为可重试错误，
默认最多 3 次，退避约为 2 秒、4 秒、8 秒；上游持续 429 后才显示该消息。Relay
不会把 429 改成成功，也不会额外重试。处理顺序是检查上游配额/并发和 `Retry-After`，
等待或降低并发；排障时可临时关闭 Pi retry，避免重复请求，但不能把它当作容量修复。

## 发布建议与下一步

1. 在真实 Debian Control Plane + Linux Mint User VM 执行 #24（同时覆盖 #18/#12
   的相关条目），只上传不含密钥/正文的证据。
2. 对 `source_check` 的 provider/credential 行为作明确决定：保持“官方内容工具
   可用、搜索入口受 Relay 控制”的约束，或另开 adapter/wrapper ticket。
3. 用真实模型执行 `scripts/smoke-real-model.mjs`，记录首 token、SSE、断线重连、
   429/Retry-After 和 Host 重启语义。
4. 完成 #11 文件/图片能力后，再更新 #10/#12 的完整用户流程；目前 README 和 MVP
   规格已诚实标注这些为未交付项。
5. 根据上述证据关闭 #23（代码切片）和 #14/#15/#17（已交付扩展），保留 #24 等
   真实验收工单直到证据齐全。

本报告本身只记录代码、测试和 Gitea 元数据；不包含任何凭据或用户内容。
