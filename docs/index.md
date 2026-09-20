# PI Coffee documentation map

> **Pi Agent 固定设计入口**：[主 SPEC](./spec/pi-agent.md) 维护插件扩展、Chat/Work、工具克制、上下文问题、未决项和验收状态；[Work 提示词 SPEC](./spec/harness-prompt.md) 维护正文规则与行为验收。旧模式描述属于历史/兼容实现，不能反推新设计；Chat 零系统提示词和模式迁移尚未在当前检出版本实现。

> **2026-09-19 架构更新**：[统一网关 ADR-0010](./adr/0010-unified-web-gateway-private-user-vms.md) 与 [工作台主 SPEC](./spec/multi-user-vm.md)：统一 HTTPS 入口，聊天/文件经轻量网关转发，用户 VM 仅私网开放，复用原生 Pi。文件网关仍待开发，不代表现有直连运行代码已经切换。

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
- [`web-search-plugin.md`](./spec/web-search-plugin.md): Relay-backed search, bounded history and evidence artifacts; legacy dispatch is labeled separately from target modes.
- [`subagents-plugin.md`](./spec/subagents-plugin.md): upstream executor adapter, admission/model/output contracts; does not decide the new mode mapping.
- [`harness-plugin.md`](./spec/harness-plugin.md): **compatibility implementation**, including old tool tables and native Git/Verify adapters; not the target Chat/Work design.

## Product, protocol and operations

- [`spec/multi-user-vm.md`](./spec/multi-user-vm.md): workbench product contract; [`spec/web-shell-roadmap.md`](./spec/web-shell-roadmap.md): shell delivery history/roadmap.
- [`spec/mvp.md`](./spec/mvp.md) and [`spec/0.1.md`](./spec/0.1.md): release slices and ticket ordering; their old Agent-mode descriptions do not override the current main SPEC.
- [`architecture/topology.md`](./architecture/topology.md), [`adr/`](./adr/), [`protocol.md`](./protocol.md): topology, architectural decisions and transport contract.
- [`deployment/runbook.md`](./deployment/runbook.md): deployment and probes; [`development/handoff-import.md`](./development/handoff-import.md): import recovery instructions; [`development/wiki-publish.md`](./development/wiki-publish.md): Wiki mirroring procedure.

## Dated research and evidence — not alternate current specifications

- [`work-prompt-20260920.md`](./reviews/work-prompt-20260920.md): pinned Codex and Claude Code references, Pi native prompt findings, adopted/rejected rules, subtraction of duplicated guidance, and explicit limitations.
- [`work-prompt-20260920-pi-claude-grok.md`](./reviews/work-prompt-20260920-pi-claude-grok.md): pinned Pi, Claude Code full and Grok Build cross-reference; adopted/rejected additions for the expanded generic Work prompt, current text-contract evidence and behavior gaps.
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
- Change the canonical requirement and linked implementation/evidence status together. Keep unresolved proposals explicit, mark superseded rules, and update links instead of duplicating full contracts.
- Wiki is a mirror, not a competing source. Frozen Picode V5 is not a work queue or implementation dependency.
