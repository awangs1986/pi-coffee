# PI Coffee 讨论交接完整性审计（2026-09-03）

## 结论

截至 `main` 的 `c014fafb660a8bbdca3465a52d6bbbe4fe9a61de`，今天讨论形成的**稳定设计结论**已经进入 PI Coffee 的 Git 主线，并有 Gitea Issue 入口。最重要的上下文归属也已经明确记录：持久上下文、Pi transcript、Task 文件和插件状态留在 owning User VM/Host；Control Plane 只保存最小路由索引和有界 usage metadata。

但这不是聊天记录的逐字备份。为了避免把隐私、凭据或失效的中间方案变成“规范”，仓库只保留整理后的决策、理由、验收条件和未决问题。今天的原始对话、每一轮 grill 的问答、被替换的临时方案没有完整导出到 Gitea。

## 已在 Git/Gitea 覆盖的主题

| 主题 | 位置 | 状态 |
|---|---|---|
| PI Coffee 独立产品线、V5 冻结、原版 Pi MVP | [`BACKLOG.md`](../../BACKLOG.md)、[ADR-0001](../adr/0001-original-pi-host-and-web-seam.md)、[ADR-0002](../adr/0002-v5-is-a-frozen-reference.md)、Issue [#1](http://testpc:3000/awangs/pi-coffee/issues/1) | 已记录 |
| Debian Control Plane/Web + Linux Mint User VM 拓扑；不管理 VM、快照由 owner 恢复 | [`BACKLOG.md`](../../BACKLOG.md)、[拓扑](../architecture/topology.md)、ADR-0003/0005、Issues [#5](http://testpc:3000/awangs/pi-coffee/issues/5)、[#9](http://testpc:3000/awangs/pi-coffee/issues/9)、[#12](http://testpc:3000/awangs/pi-coffee/issues/12) | 已记录 |
| 上下文/Transcript/Task/worktree/inbox 属于 User VM；Control Plane 不存正文 | `BACKLOG.md` 的 D-017/D-018、[ADR-0003](../adr/0003-control-plane-relay-and-user-vm-ownership.md)、[`CONTEXT.md`](../../CONTEXT.md)、Issue [#6](http://testpc:3000/awangs/pi-coffee/issues/6) | 已记录（实现仍按 0.1 ticket 推进） |
| CPA key 只在 Control Plane；Chat/Responses、JSON/SSE、models/compact | `BACKLOG.md` 的 D-020–D-024、[ADR-0003](../adr/0003-control-plane-relay-and-user-vm-ownership.md)、Issue [#7](http://testpc:3000/awangs/pi-coffee/issues/7) | 已记录/部分已实现 |
| 单 Browser Shell/tab、多 Task/Session、关闭浏览器后任务继续 | `BACKLOG.md` 的 D-025–D-029、[ADR-0006](../adr/0006-browser-lifetime-is-independent-of-session-lifetime.md)、Issue [#10](http://testpc:3000/awangs/pi-coffee/issues/10) | 已记录 |
| 文件/图片上传、User VM inbox、原图保存、限制和下载归属 | `BACKLOG.md` 的 D-030–D-035、[ADR-0007](../adr/0007-user-vm-owns-uploaded-files-and-images.md)、Issue [#11](http://testpc:3000/awangs/pi-coffee/issues/11) | 已记录 |
| Deployment Skill、原生插件优先、pi-web 评估、Rust 只在有性能证据时使用 | `BACKLOG.md` 的 D-036–D-040、[`docs/research/pi-web-evaluation-20260903.md`](./pi-web-evaluation-20260903.md)、Issues [#6](http://testpc:3000/awangs/pi-coffee/issues/6)、[#9](http://testpc:3000/awangs/pi-coffee/issues/9) | 已记录 |
| V3-derived Lean/Full prompt、V5 Simple/Full 8/10 工具契约 | [`docs/spec/harness-prompt.md`](../spec/harness-prompt.md)、[`docs/spec/harness-plugin.md`](../spec/harness-plugin.md)、Issues [#14](http://testpc:3000/awangs/pi-coffee/issues/14)、[#15](http://testpc:3000/awangs/pi-coffee/issues/15) | 已记录/已实现基础切片 |
| `pi-subagents` 锁版本、资源 Adapter、尚未完成的真实 VM/Web 验收 | [`docs/research/pi-subagents-audit-20260903.md`](./pi-subagents-audit-20260903.md)、[`docs/spec/subagents-plugin.md`](../spec/subagents-plugin.md)、Issues [#17](http://testpc:3000/awangs/pi-coffee/issues/17)、[#18](http://testpc:3000/awangs/pi-coffee/issues/18) | 加载已完成，运行验收未完成 |
| grill 后形成的执行顺序、非目标、开放问题和替换过的方案 | [`BACKLOG.md`](../../BACKLOG.md) 的 Decision Register、被替换方案、后续 Backlog、Open Questions | 已整理为摘要 |

## 尚未完整交接或不能宣称完成的内容

1. **原始对话和逐轮 grill**：未写入 Git、Issue 或 Wiki。仓库保存的是去敏后的结论和验收规则，不保证能复原每句问答。
2. **Gitea Wiki**：审计时 Wiki 仍是空白欢迎页；当前同事应从 Git `main` 和 Issues 阅读。`docs/development/wiki-publish.md` 只是发布约定，不代表页面已经同步。
3. **上下文功能本身**：归属和禁止复制的设计已确定，但原生会话历史、Host 重启恢复、Web 重连等实现仍由 `REC-001`/`SHELL-001` 等 0.1 工单验收，不能把设计文档当成运行完成。
4. **完整 V3/V5 Capability Catalog**：已在当前工作区加入可信摘要、runner readiness、schema 预算、原子激活/回滚和 lease；仍需在真实 User VM 做 conformance 证据。
5. **增强 Web Search**：代码切片已实现 Serper Relay、原生 `pi-subagents` delegation、Markdown 封盘和 pointer context；真实网络/浏览器/Host 重启验收仍由 Web 工单和 Issue #18 追踪。OAuth、上传图片端到端仍由 Issues #8、#11 追踪。

## 交接规则

- 同事应以 [Issue #13](http://testpc:3000/awangs/pi-coffee/issues/13) 和 `BACKLOG.md` 为讨论汇总入口，以 ADR 为不可逆决策，以代码/测试和各 Issue 验收评论为完成证据。
- Wiki 若要作为浏览镜像，需要另行执行 `DOC-001`；它不能取代 Git 版本化文档。
- 不将任何上游 key、Cookie、VM 凭据、完整 transcript、工具输出或文件/图片正文补录到交接材料。
