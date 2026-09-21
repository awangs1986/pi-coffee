# Web 搜索：短摘要、来源索引与 VM 证据文件

实现合同更新：2026-09-16；规格归属更新：2026-09-20。本版替代“工具先返回全量结果、agent_end 再封盘”的旧设计。上位要求见 [Pi Agent 主 SPEC](./pi-agent.md) PA-003/006/007；产品只使用 Chat/Work；工具和委派分配待 PA-Q01/04，当前兼容分派不构成新设计。

## 边界

搜索仍走 Relay `/v1/search/serper`，Serper Key 只在 Relay；VM 持客户端 Token。原生模型认证与搜索认证是不同路径。本地 `web_search` 和 `/websearch` 保留唯一搜索入口；官方 `pi-web-access` 的同名搜索与 curator 命令继续过滤。

## 新的历史合同

1. 搜索完成后，先将完整的有界来源、URL、snippets 存成独立的 User VM Markdown 证据文件（目录 0700、文件 0600）。这不是聊天历史，也不自动加载进模型上下文。
2. 工具返回和会话 custom entry 只保存短摘要、精选来源索引、artifact 路径与元数据；工具文本最多 4096 字符。**完整结果不先进入当前轮历史。**
3. 默认选择供应商排序中前三个不同 URL，保留短 snippets。这里“最优”是排序启发式，不是已核实事实；重要结论仍应打开原始来源验证。超长 URL 不截成错误引用，改指向证据文件。
4. 不等待 `agent_end`，因此后续 turn、取消、没有最终回答也不会留下本次完整搜索结果在历史中。
5. `research_seal` 变为可选的结论精炼：输入已有 responseId 和至多 2400 字符的已核实结论，生成新证据文件并更新该结果的上下文投影。精炼时应引用精选来源，勿重复来源全表。
6. 写盘失败就明确失败，不用“把原始结果塞回历史”作降级。
7. 已有旧会话只做兼容的 context projection，不破坏性清洗或重写旧 JSONL。已有原始历史不会因升级自动消失。

用户若主动读取完整 artifact，仍可能再次引入数据；通用提示词要求按范围检索，大工具结果由上下文入口策略限量。

## Chat/Work 搜索边界

Chat 按 PA-003 的基础工具与 Web 搜索范围设计，不因搜索而附加 Work 系统指令或自行扩展子任务工具。Work 的默认直接搜索还是研究委派仍待 PA-Q04，不能从兼容运行时继承默认政策。

现有直接搜索、研究子 Pi、来源读取和短结论回传能力可复用。委派失败须明确报告，不能静默在父 Agent 重做；子进程不能递归委派。当前分派细节以 `src/extensions/web-access/extension.ts`、`src/harness/runtime-mode.ts` 和对应测试为准，旧产品分派文本已撤回 Git 历史（提交 `b027838`）。

`fetch_content`、`source_check`、`get_search_content` 继续属于可选 web-access 能力。后者的上游缓存不等同于本地 Serper artifact，不能假定互通；获取已知 URL 正文与读取本地 evidence 文件应使用各自工具。搜索故障明确报告，不自动换供应商或帐号。

## 配置

保留 `PI_COFFEE_SERPER_KEY`（仅 Relay）、`PI_COFFEE_SEARCH_URL`、`PI_COFFEE_RELAY_TOKEN`、`PI_COFFEE_RESEARCH_DIR`、`PI_COFFEE_WEB`、`PI_COFFEE_WEB_ACCESS`、`PI_COFFEE_WEB_SUBAGENT_AGENT`。

## 验证

`test/web-extension.test.ts` 覆盖默认先委派且父不搜索、失败不静默回退、显式直接搜索与有界 brief、立即持久化短结果、多 turn/恢复、写盘失败和精炼脱敏。`test/research-artifact.test.ts` 覆盖 artifact 权限和路径边界。真实 Serper 质量、原生帐号和两台部署 VM 尚需实际验收，不以本地 stub 代替。
