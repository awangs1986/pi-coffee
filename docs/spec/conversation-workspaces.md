# Conversation 工作目录与本地数据边界

状态：owner 已确认（2026-09-22）；本文件定义目标合同。除 Work 的独立 Gitea Checkout 外，Chat 目录、按 Conversation 归档的 research/artifact 和相关协议尚待实现，不能把本 SPEC 当作部署证据。

本文件补足 [Pi Agent 主规格](./pi-agent.md)、[Gitea 工作区合同](./gitea-workspaces.md)和文件所有权 ADR。目标是让每个 Conversation 在所属 User VM 中都有唯一、稳定的本地目录，同时保持中央 Server 不拥有聊天正文或文件。

## 1. 术语与两个独立维度

- **Conversation** 是本地目录、Pi Session、上传 scope 和 artifact 归属的最小单位。当前网页里的一个“任务/聊天”对应一个 Conversation；若以后一个 Task 聚合多个 Conversation，每个 Conversation 仍使用独立目录，不能共享可写 cwd。
- **运行模式**只有 `chat` / `work`，决定系统提示词和工具集合。
- **Workspace 类型**只有 `chat` / `project`，决定 cwd 的来源和生命周期。它在 Conversation 创建时确定，不随运行模式切换而改变。
- **Chat Workspace** 是无 Repository 的普通目录；**Project Workspace** 是 [GW-06](./gitea-workspaces.md) 定义的独立 Gitea Checkout。

默认创建 Chat Conversation 时分配 Chat Workspace；创建 Work Conversation 时要求选择 Project 并分配 Project Workspace。运行模式切换只改变模型行为：Chat Workspace 切到 Work 后仍在原 Chat cwd 中工作，不获得 Git 同步语义；Project Workspace 切到 Chat 后仍保留原 Checkout。需要开发 Gitea 项目时必须显式新建/接续 Project Workspace，不能把 Chat 目录静默变成 Checkout，也不能覆盖其中的文件。

## 2. 目录合同

User VM 使用一个共同工作根，推荐布局如下：

```text
/home/USER/work/
├── projects/
│   └── checkouts/
│       └── <conversation-id>/       # Project Workspace；Pi cwd
│           └── .pi-coffee/
│               ├── inbox/           # 上传和粘贴的原始文件/图片
│               ├── artifacts/       # 大工具输出、子任务结果和其他证据
│               ├── research/        # Web 搜索与来源证据
│               └── images/          # 生成或转换出的图片
└── chats/
    └── <conversation-id>/           # Chat Workspace；Pi cwd
        ├── inbox/
        ├── artifacts/
        ├── research/
        └── images/
```

| ID | 正式合同 |
|---|---|
| **CW-01** | 每个新 Conversation 必须先创建唯一 Workspace，再允许启动 Pi 或接收上传。Conversation ID 必须是已验证的不透明 ID；现有目录、符号链接或不完整创建均不能被自动接管。目录创建完成并校验后才原子发布元数据。 |
| **CW-02** | `PI_COFFEE_WORK_ROOT` 推荐为 `/home/USER/work`；`PI_COFFEE_PROJECT_ROOT` 默认是其 `projects` 子目录，`PI_COFFEE_CHAT_ROOT` 默认是其 `chats` 子目录。显式路径必须绝对化、归 owner 所有且互不包含；服务启动时 fail closed。迁移期可以从既有 Project root 推导同级 `chats`，但最终状态必须写入部署配置。 |
| **CW-03** | Chat Workspace 的 cwd 是 `chats/<conversation-id>`。Project Workspace 的 cwd 继续是 `projects/checkouts/<conversation-id>`，其运行数据放在 `.pi-coffee/`，并写入该 Checkout 的 `.git/info/exclude`；平台 checkpoint 不得提交 `.pi-coffee/**`。若 reserved path 已被 Git 跟踪，自动 checkpoint 必须拒绝并明确报错。 |
| **CW-04** | `inbox/` 保存用户上传和粘贴内容的原始 bytes，包括图片；`images/` 只保存生成或转换出的新图片，不为原图额外制作缩略图副本；`research/` 保存搜索/抓取证据；`artifacts/` 保存大工具输出、subagent 结果及其他系统证据。Agent 按用户任务主动创建的普通文件可以直接放在 cwd 中。 |
| **CW-05** | Pi、read/edit/write/bash、Git、LSP、Web 搜索、subagent 和文件接口必须从 Host 的 Conversation 元数据解析同一个 cwd/data root。已登记 Conversation 不允许回退到全局 `PI_COFFEE_WORKDIR`、`getAgentDir()/pi-coffee/research` 或 `getAgentDir()/pi-coffee/subagent-results`。子任务继承父 Conversation 的 Workspace 归属，但保留自己的运行 ID。 |
| **CW-06** | 工具 schema、绝对路径或历史消息都不能改变文件归属。Host 只接受当前已授权 Conversation ID，并在服务端解析路径；浏览器不能提交任意 cwd、VM 地址或本地根目录。 |

Chat 根目录是集中管理入口，不是所有 Chat 共用的 cwd。两个 Chat Conversation 永远不能共享同一个可写子目录。

## 3. 文件进入、使用和展示

1. 上传、粘贴图片或导入文件前，Server 和 Host 都校验登录用户 → 固定 User VM → Conversation → Workspace 的归属。路径名只作显示信息，不能作为授权依据。
2. 文件字节可以按 [ADR-0010](../adr/0010-unified-web-gateway-private-user-vms.md) 经统一网关有界流式转发，但 Server/反向代理不得落盘、整文件缓存或记录正文。文件名、SHA-256、大小、MIME、进度可在当前请求中短暂传递；中央持久日志不得记录文件名、Workspace 路径或正文。
3. 原始文件只在所属 User VM Workspace 持久化。小图片即使以内联 image block 送给模型，也必须先保存原始 bytes；模型请求只包含用户在本轮明确选择的文件/图片，不能自动扫描并附带整个 inbox 或 Workspace。
4. 搜索 query 和模型请求会离开 User VM 到配置的 Relay/provider，这是功能所需的数据外发边界；本地文件不会因为启用 Web 搜索而自动发送给搜索服务。只有用户任务或 Agent 的显式工具调用可以读取并使用文件内容。
5. Preview、tree、artifact index、download 和 import 都使用同一 Conversation scope。返回路径必须相对 Workspace；UI 可以显示 owner 可理解的本地路径，但不能把路径本身当成下载凭据。
6. research、subagent 和大工具结果采用临时文件 + 原子 rename；文件默认 `0600`，目录默认 `0700`。写盘失败、磁盘满或配额失败必须明确报错，不能把完整结果退回模型历史或声称已归档。

## 4. 泄露边界与防护

| 风险 | 必须保证 | 明确边界 |
|---|---|---|
| Conversation 串读 | Host/API 以认证后的 Conversation 元数据解析 cwd；realpath containment；拒绝 `..`、绝对路径注入、符号链接逃逸和跨 Workspace 下载；token 绑定 user/VM/Conversation/用途并可过期撤销 | 同一 User VM 内的 Pi/Bash 以可信 VM owner 运行，没有 OS 级目录隔离。owner 或 Agent 主动使用绝对路径时可访问 owner 能读的其他目录；这是 [GW-01](./gitea-workspaces.md) 的执行模型，不宣称为安全 sandbox |
| Server 留存 | 聊天、附件、搜索正文、图片和 tool output 只在 User VM；网关只做有背压的流式传输；错误与 access log 脱敏 | VM snapshot、备份和虚拟化存储可能继续含已删除数据，由 VM owner 的保留策略管理 |
| Gitea 意外提交 | Project Workspace 的 `.pi-coffee/**` 仅本地、自动 exclude；平台 checkpoint 拒绝已跟踪的 reserved data，不使用无范围 `git add -A` | 可信 owner 可用原生 Git 强制发布任何可读文件；平台不冒充 DLP 系统，用户显式发布后的远端副本由 Gitea 管理 |
| 模型/搜索外发 | 每轮只发送明确引用的附件和完成任务所需内容；不自动枚举其他 Conversation；搜索工具不隐式附带本地文件 | 用户要求分析文件或 Agent 为完成任务显式读取后，相关内容可能进入模型上下文；UI 必须让附件选择可见 |
| 旧全局目录 | 迁移只按已验证 Session/Conversation ID 关联；复制/校验/切换成功后才改变元数据；无法证明归属的文件留在只读 legacy/quarantine 区 | 不能根据文件名、时间或内容猜测归属，也不能把全局 research/subagent 目录批量塞给最近一个 Chat |

该模型防止产品和服务的意外跨 Conversation 泄露，不改变“每个用户一台可信 VM、VM owner 拥有最高权限”的既定安全边界。

## 5. 生命周期

- **创建**：先保留 Conversation ID，再创建目录、分类子目录和 `0700/0600` 权限；Project Workspace 完成 clone、branch 和远端 SHA 校验后才可运行。失败保留可诊断状态，不把半成品作为有效 Conversation。
- **运行与重连**：浏览器断开不改变 cwd；Host/Pi 重启从持久元数据恢复同一路径。LSP 实例以 Workspace 为 key，模式切换不重建或改绑目录。
- **归档**：只改变可见性，不强停已经运行的工作，也不删除 Workspace、Pi transcript、附件、research、artifact、图片、branch 或 PR。恢复后继续使用原 cwd；永久清理前另行 quiesce 并核对实际写入状态。
- **永久清理**：必须先停止 Conversation 写入，并显示将删除的 Workspace、原生 transcript、附件/产物和远端对象范围。每类数据独立授权和报告；Chat 目录没有 Git“已同步”保护，不能把归档或历史存在当作备份。部分失败保留可重试状态，不复用该 Conversation ID。
- **迁移**：既有 Project Checkout 保持路径。旧 `.pi-coffee/inbox/<session-id>`、全局 research 和 subagent artifacts 只有在归属可证实时迁入相应分类目录；校验成功前保留原件。旧无 Workspace Session 保持可读，用户选择 Chat 或 Project 归属后再启用写入。

## 6. 最小实现与验收

首轮只验证流程闭环，不扩展成文件治理平台：

1. 创建两个 Chat Conversation，得到两个不同 cwd 和完整分类子目录；各自在一个目录写入文件，另一 Conversation 的 tree/download/import 接口不可见。
2. 创建一个 Work Conversation，Gitea clone、Conversation branch、Git/LSP 行为不回归；`.pi-coffee/**` 不出现在平台 checkpoint 中。
3. 上传文件、粘贴原图、执行 Web research 和产生一个超长 subagent/tool 结果，分别落到该 Conversation 的 `inbox`、`research`、`artifacts`；生成图片落到 `images`。Server 侧没有正文临时文件或 durable body。
4. 模式切换后 cwd 不变；Chat Workspace 不会静默变成 Repository，Project Workspace 不会移动到 Chat 根。
5. 归档后目录仍在，运行中的写入不被隐式中断；恢复后路径不变。永久清理前必须先 quiesce，并需要精确确认和按范围报告。
6. 路径逃逸、过期/错 Conversation token、符号链接和未登记 Session 均 fail closed；旧目录迁移不会猜测归属。

实现完成前必须更新公开 Host Interface、Server 创建流程、部署 env 示例和对应 Gitea Issue，并从两仓 fresh clone 运行各自检查。真实双 VM 验收只需覆盖一个 Chat、一个 Work、一次文件流和一次重连，不重复 T4 已完成的 Gitea 故障矩阵。
