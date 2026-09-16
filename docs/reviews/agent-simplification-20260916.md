# Agent 精简改动验证记录 — 2026-09-16

基线：origin/main `6b0fb498e4d8fe2cf0d1303069dbbd8e2d6fcf47`。工作位于固定会话分支，未推送或修改远端 Issue。本次只实施 owner 已确认的提示词、搜索和上下文恢复改动，不实施之前双用户 VM spec 的其他切片。

## 已运行

- 基线 `npm ci && npm run check`：17 个测试文件，104 个测试通过。
- 新需求先运行失败测试：三入口统一提示词/recall 驻留、即时有界搜索历史、本地上下文策略。
- 最终 `npm run check`：20 个测试文件，112 个测试通过，包含 TypeScript 构建。
- `npm run smoke:subagents`：真实 Pi 默认扩展加载通过；实际 simple 活动工具包括 8 个基础工具及 recall_folded。
- `npm run smoke:web`：Web/内容工具及相关命令真实加载通过。
- `test/context-rpc.test.ts` 启动真实锁定 Pi RPC 与本地哨兵 HTTP 服务：已有大历史生成 deterministic seed index，不访问模型；新超大输入在 provider 请求前被 abort，同样不访问模型；原历史保留。
- 浏览器脚本 `node --check` 与纯状态反馈单测通过。

## 未宣称完成

- 没有真实供应商/Serper key、两台用户 VM 的部署验收。
- 没有运行浏览器视觉/点击端到端测试；Web 恢复按钮仅做语法、纯反馈函数和 Host/RPC seam 验证。
- 没有修改通用 SUBAGENTS 模型策略、委派执行器或并发/worktree/结果合同；这部分待单独讨论。搜索默认不委派是本次已确认范围。
- 没有重写或清洗旧 JSONL 搜索历史；新搜索不再写入完整结果，旧记录仅兼容投影。
- 最终 payload 预算是保守估算，不是所有模型的精确 tokenizer。
- `npm ci` 报告现有开发测试依赖漏洞：vitest（critical）及 @vitest/mocker（moderate）。未执行有副作用的 audit fix 或在本切片顺带升级依赖；未启动对外的 Vitest UI/API。应另做依赖升级验证。

详见 `docs/spec/harness-prompt.md`、`docs/spec/web-search-plugin.md`、`docs/spec/context-recovery.md`。
