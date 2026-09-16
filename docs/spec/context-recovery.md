# 精简上下文与本地恢复

日期：2026-09-16。目标是阻止重复原始材料占满请求，并使超限可恢复；不是新增沙箱、内核、记忆框架或第二套压缩算法。

## 实现合同

1. **入口限量**：read/bash/grep/find/ls/git/verify 和内容获取工具返回的 content + details 超过 12000 UTF-8 字节时，先保存 VM 独立 artifact，历史接收至多 4000 字符预览和恢复路径。写盘失败只返回短错误，并警告原操作可能已执行，禁止声称已保存。subagent/bg_wait 和异步子任务通知另在原生适配器入口先归档大正文/details，只返回短摘要与索引。
2. **搜索**：见 `web-search-plugin.md`，完整结果从不作为新搜索的默认工具历史返回。
3. **折叠**：复用锁定的 context-fold@0.4.0，不改上游源码；压缩恢复工具 recall_folded 必须常驻，unfold 不默认开放。
4. **硬压缩**：通过本地 adapter 调用原 context-fold 的确定性索引算法。未返回有效结果或报错时取消压缩，不能静默 fallback 到模型摘要。CONTEXTFOLD_COMPACT=native 或包级禁用在该 adapter 下会取消硬压缩；不要把它当作成功。
5. **最终请求检查**：在 `before_provider_request` 对实际 payload 的系统信息、schema、消息和编码媒体进行保守估算：UTF-8 字节数 / 2；预算为 `(当前模型窗口 - min(maxTokens, 窗口/4)) × 0.85`。缺窗口配置或估算超预算则 abort 当前请求，显示恢复提示，不自动重放。这是估算和防护余量，不是跨供应商精确 token 计数；编码媒体可能被高估。模型配置虚报窗口仍需用户纠正。
6. **手动恢复**：Web 通过既有 compact 控制帧直接请求 Pi RPC，不需要先向模型发送一句“请压缩”。Host 先检查已加载的 `context-recovery` 命令标记；扩展关闭/加载失败时拒绝，不走原生模型摘要。仅在任务停止后执行；完成 ACK 在操作成功之后发出，UI 分别显示成功、取消和失败。原历史保留，不自动续跑副作用任务。

## 默认加载与限制

`src/context/extension.ts` 在默认扩展列表末尾加载原 context-fold 并安装入口限量/请求检查。使用 lockfile 的包版本，不自动改用用户安装的其他版本。

不要再自动发现或显式重复加载另一份 context-fold，否则第三方 hooks 可能重复运行。用户自行替换扩展列表、关闭 `PI_COFFEE_CONTEXT_FOLD` 或安装修改同一 hook 的扩展，会离开本规格的默认保证；排查时查看实际已加载列表。

Pi 0.84.4 在 compaction hook 之前仍会解析所选模型及认证。这里证明不调用模型生成摘要，不承诺认证完全缺失时也能经过上游准备阶段。没有可压缩的旧消息、当前单条输入/图片过大、保留尾部过大、磁盘故障时，恢复可能失败；应保留历史、缩短输入或修正模型配置，不能无限自动重试。

默认不强制语义摘要。索引不是完整语义记忆，通用提示词建议长任务维护简短目标/决策/验证/待办记录。不导出私有思维链。

## 验收证据

- `test/context-policy.test.ts`：本地失败取消、工具结果先落盘、磁盘失败、usage 无关的最终请求预算、切模型。
- `test/context-rpc.test.ts`：运行真实锁定 Pi RPC，读取已有大历史，本地硬压缩成功；哨兵 HTTP 模型服务收到 **0 次请求**。之后超大新输入被预算检查 abort，同样 0 次请求。原始历史保留。
- `test/context-status.test.ts`：失败或取消不能显示压缩成功。
- `test/host-server.test.ts`：压缩失败返回错误而不是提前成功 ACK。
- `npm run smoke:subagents`：实际默认加载包含 recall_folded，子 Agent 的真实执行测试另见 subagent-rpc.test.ts。

以上不等于真实供应商、真实双 VM、所有图片格式或任意 VM 进程的沙箱并发限制；产品子 Pi 启动路径的 3/5 锁准入另有跨进程与真实 Pi 协议测试。
