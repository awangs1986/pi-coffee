# LSP Skill 真实 Agent 验收 — 2026-09-21

模型：`eidolon/gpt-5.6-terra`。入口：`npm run smoke:lsp-agent`。测试只使用每次重新创建的一次性 TypeScript/Python 项目；报告保存工具名、LSP 操作、变更文件和检查状态，不保存认证信息、provider 请求正文或完整 transcript。

| 场景 | 通过 | 判定 |
|---|---:|---|
| TypeScript 跨文件类型错误 | 3/3 | 三次均发现 `skill:lsp`，调用真实语义操作，修复并通过 `tsc` |
| TypeScript 同名符号影响范围 | 2/3 | 两次使用 `references` 等语义查询并只修改真实调用方；一次正确修复且 `tsc` 通过，但没有调用 LSP，按失败保留 |
| Python 跨文件类型错误 | 3/3 | 三次均使用 `diagnostics` 和 `definition`，修复并通过 Pyright |

三个场景都达到预设的至少 2/3 工程门槛。9 次均能在 Pi 命令列表看到 `skill:lsp`，项目最终检查均通过，没有扩展错误。唯一失败样本说明 Skill 的主动使用率不是 100%；它没有显示 LSP 与 `read`、`edit`、`bash` 或项目检查发生冲突。

机器可读逐次证据见 [JSON 报告](./lsp-agent-evaluation-20260921.json)。真实服务器确定性测试另由 `test/lsp-real-servers.test.ts` 覆盖，不能用模型自述替代。
