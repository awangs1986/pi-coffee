# 通用软件开发系统提示词

更新：2026-09-16。owner 已取消独立 Lean / Full 提示词设计。本文件替代旧的两套 profile 合同；历史出处留在 Git 历史中，不进入运行时提示词。

## 唯一来源

`src/harness/prompts/software-development.md` 是唯一正文，由 `renderHarnessPrompt` 读取并追加到 Pi 原生 Base Prompt。它面向任意软件项目，不将 Agent 定义为本仓库的开发者，不出现本产品名称或历史版本身份。

`simple`、`lean`、`full` 使用完全相同的正文，不按模式增加或减少软件开发纪律。`/harness lean` 是 `simple` 工具表的兼容入口；`full` 仍额外开放原有 Git/Verify 工具。这是工具选择，不是另一份提示词。`standard`/`tdd` 保留原有兼容命令，不新增强制状态机。

共同正文只包含：需求与范围、先读后改、最小完整修改、真实工具发现、上下文节制、验证证据、用户控制与简洁沟通。项目专属指令不写入通用正文。

## 不做

不实现命令沙箱、内核、安全审批层、自动 Gate 或第二套 OS 权限。VM 是执行隔离边界；外部 Gitea 保存已推送代码。远端仓库不是未提交工作、VM 凭据或文件的自动备份，Agent 仍应尊重删除/合并/发布的授权。

## 工具与恢复

- 基础工具表保持 simple=8 / full=10；若已注册，`recall_folded` 在各模式与切模型后常驻，因此实际默认总数为 9 / 11。
- 不默认激活持续扩大上下文的 `unfold`。
- `search_tools` 搜索 → 激活 → 下个模型请求获得 schema；未列出能力可能只是未配置/未就绪，不能宣称根本不存在。
- 状态、活动工具列表在固定正文之外动态注入，重复注入会去重。
- 子 Agent 已确认并实现为 Full-only：Simple/Lean 不委派；Full 采用独立模型、每根对话 3 / 每 VM 5 的原生启动准入和有界结果。详见 `subagents-plugin.md`。没有增加子任务自动 worktree 策略。

## 验证

`test/harness-prompt.test.ts` 检查三种入口正文相同、通用性和长度；`test/harness-extension.test.ts` 检查去重、模式切换与恢复工具；`npm run smoke:subagents` 检查真实 Pi 加载与活动工具。
