# PI Coffee Agent Runtime documentation map

- [VM 完整权限与 Gitea 工作区决策](./adr/0012-owner-privileges-and-gitea-checkouts.md)
- [工作区正式合同](./spec/gitea-workspaces.md) 与 [T0–T4 任务](./development/t0-t4-gitea-workspaces.md)：Agent/Server 实现、双 User VM、2 × 3 Conversation、VM 快照回滚与普通用户对称私库探针均已落地；[真实证据](./reviews/t0-t4-implementation-20260921.md)已记录，T0–T4 验收完成。

> **2026-09-21 仓库拆分**：本仓库只维护 User VM Agent Runtime。浏览器 UI、Web gateway、Gitea identity、固定路由和 Relay 已迁至 [`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server)。拆分决定见 [ADR-0011](./adr/0011-split-agent-runtime-and-server-repositories.md)。

> **Pi Agent 固定设计入口**：[主 SPEC](./spec/pi-agent.md) 维护插件扩展、Chat/Work、工具克制、上下文问题、未决项和验收状态；[Work 提示词 SPEC](./spec/harness-prompt.md) 维护正文规则与行为验收。退役模式说明已从当前文档撤下，历史由 Git 追溯；Chat/Work 运行时和 Chat 零系统提示词已完成，见[迁移验收](./reviews/chat-work-migration-20260922.md)。

> **Server 产品规格**：统一网关、工作台与 Web Shell 的正文已迁至 `pi-coffee-server`；本仓库的同名文档是迁移指针。Host Interface 仍以 [`protocol.md`](./protocol.md) 为准。

> **工作台产品排期**：[P0–P5](./development/product-priorities-20260916.md) 仅覆盖 Pi Agent 讨论之前的工作台产品 SPEC，与 Agent 改进分开维护。

This index links to maintained contracts and clearly dated evidence. It is not another copy of their requirements.

## Start here

1. [`AGENTS.md`](../AGENTS.md): repository guardrails, specification maintenance, and completion criterion.
2. **Agent changes:** [`spec/pi-agent.md`](./spec/pi-agent.md), then the relevant specialist SPEC below. Owner decisions, current implementation and acceptance are separate states.
3. [`BACKLOG.md`](../BACKLOG.md) and the corresponding [Gitea Issue](http://testpc:3000/awangs/pi-coffee/issues): scope, dependencies and external ticket status. Record pending synchronization if unavailable.
4. [`development/workflow.md`](./development/workflow.md): discussion → maintained SPEC → test/change → evidence/status loop.
5. [`product/decisions.md`](./product/decisions.md): product decisions and links to the current Agent contract.

## Maintained Agent specifications

- [`pi-agent.md`](./spec/pi-agent.md): PA decisions, rationale, open questions, implementation gaps, acceptance matrix and revision history.
- [`harness-prompt.md`](./spec/harness-prompt.md): WP rules, Work prompt source, engineering budget, public extension seam and model behavior evaluation cases.
- [`context-recovery.md`](./spec/context-recovery.md): context ingress limits, local compaction, conservative request budgeting and failure behavior; new-mode allocation follows the main SPEC.
- [`web-search-plugin.md`](./spec/web-search-plugin.md): Relay-backed search, bounded history and evidence artifacts; mode allocation follows the main SPEC.
- [`subagents-plugin.md`](./spec/subagents-plugin.md): upstream executor adapter, admission/model/output contracts; does not decide the new mode mapping.
- [`harness-plugin.md`](./spec/harness-plugin.md): native Git and explicit verification commands, with mode migration status; no separate product-mode table.

- [Work 工具设计](./spec/work-tools.md)：已确认的精简集合、现有实现与迁移差距。
- [LSP 中间层](./spec/lsp-middle-layer.md)：原生 Skill 发现、CLI 语义查询、按需语言服务器复用与项目验收；CLI/Skill 已实现；详见规格中的验收边界。
- [人工测试手册](./testing/work-prompt-manual.md)：owner 可执行的行为测试与结果模板。
- [本轮设计审核](./reviews/chat-work-design-review-20260920.md)：确定问题、风险判断和验证边界。
- [T0–T4 实现与验收证据](./reviews/t0-t4-implementation-20260921.md)：提交、全套/fresh-clone/真实 Gitea/跨仓结果及仍缺的双 VM 门槛。

## Product, protocol and operations

- [`spec/multi-user-vm.md`](./spec/multi-user-vm.md) and [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): migration pointers to `pi-coffee-server`.
- [`spec/mvp.md`](./spec/mvp.md) and [`spec/0.1.md`](./spec/0.1.md): release slices and ticket ordering; their old Agent-mode descriptions do not override the current main SPEC.
- [`architecture/topology.md`](./architecture/topology.md), [`adr/`](./adr/), [`protocol.md`](./protocol.md): Agent-side topology, architectural decisions and canonical Host Interface.
- [`deployment/runbook.md`](./deployment/runbook.md): deployment and probes; [`deployment/vm-snapshot-rollback-task.md`](./deployment/vm-snapshot-rollback-task.md): `linux002` 宿主快照回滚任务书与证据模板；[`development/handoff-import.md`](./development/handoff-import.md): import recovery instructions; [`development/wiki-publish.md`](./development/wiki-publish.md): Wiki mirroring procedure.

## Dated research and evidence — not alternate current specifications

- [工具链真实执行探针](./reviews/toolchain-smoke-20260921.md)：基础工具实调、pi-lens 注册/活动集合、环境缺项与可复跑命令。

- [`work-prompt-20260920.md`](./reviews/work-prompt-20260920.md): pinned Codex and Claude Code references, Pi native prompt findings, adopted/rejected rules, subtraction of duplicated guidance, and explicit limitations.
- [`work-prompt-20260920-pi-claude-grok.md`](./reviews/work-prompt-20260920-pi-claude-grok.md): pinned Pi, Claude Code 完整默认版 and Grok Build cross-reference; adopted/rejected additions for the expanded generic Work prompt, current text-contract evidence and behavior gaps.
- [`plan-20260916.md`](./development/plan-20260916.md): **historical** Pi/tool handoff; its old mode decisions have been superseded, not silently carried forward.
- [`harness-prompt-audit-20260902.md`](./research/harness-prompt-audit-20260902.md): historical prompt provenance; not a requirement to inspect V3 or revive its design.
- [`pi-subagents-audit-20260903.md`](./research/pi-subagents-audit-20260903.md) and [`pi-web-access-audit-20260903.md`](./research/pi-web-access-audit-20260903.md): pinned package integration evidence.
- [`pi-web-evaluation-20260903.md`](./research/pi-web-evaluation-20260903.md): Host/Web seam evaluation; [`handoff-completeness-audit-20260903.md`](./research/handoff-completeness-audit-20260903.md): historical gap audit.
- [`gitea-full-audit-20260903.md`](./reviews/gitea-full-audit-20260903.md) and [`vm-smoke-evidence-20260903.md`](./reviews/vm-smoke-evidence-20260903.md): results for those revisions/environments, not automatic acceptance of later changes.
- Web delivery tickets: [WEB-001 / #23](http://testpc:3000/awangs/pi-coffee/issues/23) and [WEB-002 / #24](http://testpc:3000/awangs/pi-coffee/issues/24).

## Authority and maintenance

- Gitea manages Issue status, dependencies and acceptance comments; ADRs record architectural choices.
- Maintained SPECs define confirmed/planned behavior. For Agent decisions start with `pi-agent.md`, not a dated report or an old entrypoint banner.
- Code/tests in the checkout define implemented behavior. Evidence states the revision, commands, environment and unverified boundaries; a requirement or document being written does not mean it has shipped.
- Change the canonical requirement and linked implementation/evidence status together. Keep unresolved proposals explicit, mark superseded rules, and update links instead of duplicating complete contracts.
- Wiki is a mirror, not a competing source. Frozen Picode V5 is not a work queue or implementation dependency.
