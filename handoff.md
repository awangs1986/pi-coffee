# Handoff — Chat/Work 设计与人工验证

基线：`arena/01a0bb30-pi-coffee` 的 `b027838`。09-20 统一设计文档、审核并准备人工测试；09-21 owner 批准后已应用六项提示词修改，见 docs/reviews/work-prompt-revision-20260921.md。模式运行时、工具 schema 和 renderer 未修改。

- 固定入口：[Pi Agent 主规格](docs/spec/pi-agent.md)。只有 Chat/Work；Chat 不发送系统指令，Work 保留 Pi Base 并追加开发正文。PA-Q02 二选一已由 PA-009 关闭。
- 评审：[设计审核](docs/reviews/chat-work-design-review-20260920.md)。区分静态发现与尚待真人验证的风险。
- 测试：[人工测试手册](docs/testing/work-prompt-manual.md)，使用可生成的独立实验目录；结果由 owner 填写。自动化通过不代表模型遵守。
- 工具：[Work 现有设计](docs/spec/work-tools.md)。owner 已确认继承现有工具集合；基线 10 个，加恢复工具通常 11 个，扩展按需激活；接口精简待讨论。
- 文档不再提供退役模式的名字、命令或工具分派表；旧证据可从 Git 提交 `b027838` 的同路径读取，不把历史行为改名成新模式。
- 当前兼容代码仍在，迁移、Chat provider payload 验收、默认值/切换/恢复政策待落实。工具名称、研究委派和上下文计量等未决项按 PA-Q01/03/04/05/06 继续讨论。
- Gitea `http://testpc:3000` 当前连接失败，Issue #1/#13/#14/#15 的决定及证据同步待办；未更新或关闭远端 Issue。
