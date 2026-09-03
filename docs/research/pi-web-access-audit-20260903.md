# `pi-web-access` 接入审计（2026-09-03）

## 来源和版本

- 官方仓库：[nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)
- 本地锁定版本：`0.27.0`
- 许可证：MIT
- Pi manifest entry：`./index.ts`
- 当前接入方式：PI Coffee native extension manager + 本地 Adapter

## 关键发现

官方扩展提供 `web_search`、`fetch_content`、`source_check` 和
`get_search_content`，并包含多个可选搜索 provider、内容提取、来源检查、
缓存和 summary workflow。其 Serper provider 默认读取 User VM 的
`~/.pi/web-search.json` 或 `SERPER_API_KEY`。

这与 PI Coffee 的凭据决策冲突：Serper key 必须只在 Control Plane Relay。
因此 PI Coffee 的本地 `web_search` 先注册，官方扩展由
`src/web/pi-web-access-adapter.ts` 加载，并忽略官方同名工具以及
`websearch`/`curator` 命令注册。官方内容工具仍保留，但必须经过 capability
conformance 后才进入 agent search。

## 运行边界

```text
Pi Host (User VM)
  ├─ PI Coffee web_search  ── Relay ── Serper
  ├─ research_seal         ── User VM Markdown
  └─ optional pi-web-access fetch/source tools
```

官方扩展没有被复制进 PI Coffee；Adapter 只负责加载边界和名称冲突隔离。
任何升级都必须重新审计版本、依赖、工具注册和 key 读取路径。

## 不在本次范围

- 不把官方所有 provider 的 credential 下发到 User VM；
- 不把官方 curator UI 或缓存目录迁移到 Control Plane；
- 不把官方 `web_search` 作为第二条搜索协议；
- 不以本地离线 smoke 宣称真实 Serper、网页抓取或子 Agent 已生产可靠。
