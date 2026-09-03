# PI Coffee Web Search 插件

状态：已实现代码切片；真实 Control Plane、Serper 和 User VM 运行验收仍需按 Gitea 工单执行。

## 边界

Web 搜索是 Agent Host 中的 Pi-native extension。搜索请求经过 Control
Plane Relay 的 `/v1/search/serper`，Serper key 只存在 Relay 进程；User VM
只保存 Relay token、搜索结果 artifact 和 Pi session。

PI Coffee 的本地 `web_search` 是唯一搜索入口。官方
[`pi-web-access`](https://github.com/nicobailon/pi-web-access) 通过本地
Adapter 加载，保留其 `fetch_content`、`source_check` 和
`get_search_content` 工具，但屏蔽同名的 `web_search` 注册以及官方
`/websearch`、`/curator` 命令，避免绕过 Relay。PI Coffee 自己的
`/websearch` 命令仍然可用。

## 工具

| 工具 | 默认状态 | 作用 |
|---|---|---|
| `web_search` | Web capability 激活后可用 | 最多四个查询、Serper 结果、可选子 Agent research brief |
| `research_seal` | 随 Web capability 激活 | 将搜索来源和最终结论写入 User VM Markdown |
| `fetch_content` | `web-access` capability，默认未 conformed | 官方 pi-web-access 页面内容提取 |
| `source_check` | `web-access` capability，默认未 conformed | 官方来源核验和结构化证据 |
| `get_search_content` | `web-access` capability，默认未 conformed | 读取官方扩展保存的搜索内容 |

这些工具不改变 Harness 的 V5 基础表：Simple 仍为 8，Full 仍为 10。通过
`search_tools` 发现/激活 optional capability 后，schema 只在下一个 model
request 生效。

## 子 Agent 路径

Web extension 使用 `pi-subagents/delegation` 的
`prompt-template:subagent:*` event bus 调用一个 configured Agent，默认
`scout`。委托使用 `fresh` context 和 zero-tool budget，只分析已返回的
Serper snippets。子 Agent 未加载、超时、取消或失败时，`web_search` 仍返回
Serper 结果并显示有界降级信息。

## Markdown 封盘和上下文

每次搜索生成唯一 `responseId`。LLM 完成本轮后，Web extension 将当前
agent run 的未封盘搜索写入 User VM：

```text
<agent_end>
  research-<content-hash>.md  (目录 0700，文件 0600)
<next provider request>
  [Research sealed] pointer + conclusion
```

artifact 包含查询、provider、来源 URL、bounded snippets、结论、session ID
和 SHA-256。Relay、Serper 和上游 key 会在写入前脱敏；同一份脱敏后的结论
才会写入 Pi session 或发送到浏览器，避免凭据从模型回显路径泄露。完整搜索结果只在
当前工具返回中可见；`context` handler 在下一次 provider request 前替换
为 pointer + conclusion。关闭浏览器不会影响 User VM 文件或 Pi session。

`research_seal` 可在模型希望提前建立 checkpoint 时显式调用。重复封盘是
幂等的，未知 `responseId` 返回结构化错误。

## 配置

| 变量 | 所在进程 | 作用 |
|---|---|---|
| `PI_COFFEE_SERPER_KEY` | Control Plane Relay | 唯一 Serper credential |
| `PI_COFFEE_SERPER_ENDPOINT` | Control Plane Relay | 可选兼容/测试 endpoint |
| `PI_COFFEE_SEARCH_URL` | User VM Host | Web search Relay URL |
| `PI_COFFEE_RELAY_TOKEN` | User VM Host | Relay bearer token |
| `PI_COFFEE_RESEARCH_DIR` | User VM Host | Markdown artifact 根目录 |
| `PI_COFFEE_WEB` | User VM Host | `off` 禁用本地 Web adapter |
| `PI_COFFEE_WEB_ACCESS` | User VM Host | `off` 禁用官方 pi-web-access adapter |
| `PI_COFFEE_WEB_SUBAGENT` | User VM Host | `off` 禁用默认子 Agent brief |
| `PI_COFFEE_WEB_SUBAGENT_AGENT` | User VM Host | 选择 configured subagent 名称 |

User VM 不应设置 `SERPER_API_KEY`，也不应把 Serper key 写入
`~/.pi/web-search.json`。官方扩展的直接 Serper tool 已被 Adapter 屏蔽。

## 验证

```bash
npm run check
npm run smoke:subagents
```

搜索真实验收还需验证 Relay key 隔离、子 Agent 生命周期、浏览器断开后
继续和 Host 重启恢复；这些证据必须贴到 Web 工单，不能仅以离线 smoke
代替。
