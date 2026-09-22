# linux002 快照回滚演练证据（交接）

关联任务书：`docs/deployment/vm-snapshot-rollback-task.md`  
关联门槛 Issue：`awangs/pi-coffee#36`  
执行日期：2026-09-22（UTC 窗口见正文）  
执行角色：虚拟化 / 网络管理员（网络管家）

本文件已从操作员本机交接至仓库，供他人验收。不含密码、token、Cookie、会话正文或快照文件。

---

## linux002 snapshot rollback evidence

- 执行人 / 复核人：网络管家（虚拟化执行） / 待应用负责人复核 Conversation UI
- 虚拟化平台 / 宿主节点：Proxmox VE 9.2.2 / 节点 `v`（192.168.100.200）
- VM 名称 / 不可变 VM ID：`linux-test2` / VMID `105`（Guest hostname `linux002`，smbios uuid `af6ff476-728e-4f80-8786-e62c394a5062`）
- 维护窗口（UTC）：2026-09-22T11:33:44Z — 2026-09-22T11:35:09Z
- 快照名称 / ID / 创建 UTC：`pi-coffee-t4-l002-20260922T113344Z` / 同名（local-lvm snap_vm-105-disk-0_…） / 2026-09-22T11:33:51Z
- 快照类型：powered-off disk snapshot；memory included=false
- rollback 开始 / 完成 UTC：2026-09-22T11:34:32Z / 2026-09-22T11:34:32Z（qm rollback 同步完成）
- 平台任务结果：SNAP_EXIT=0，ROLLBACK_EXIT=0；仅 VM 105 单实例运行

| 检查 | 基线 | 回滚后 | 结果 |
|---|---|---|---|
| hostname / FQDN / IP | linux002 / linux002 / 192.168.100.218 | 同左 | PASS |
| machine-id SHA-256 | c0a3d187b5189880dc93a8af3e5eb1cba36824290d0362ef83f046bdf5634cb1 | 同左 | PASS |
| SSH Host Key fingerprints | ECDSA SHA256:k+nV5… / ED25519 SHA256:f83G… / RSA SHA256:r4Cd… | 同左 | PASS |
| before marker exists | true | true | PASS |
| after marker exists | n/a | false | PASS |
| pi-coffee-host active | true | true | PASS |
| 3 Host capabilities | true | true | PASS |
| VM ID / Gitea owner | linux002 / pi-coffee-t4-user2 | 同左 | PASS |
| Host route/token match | true | true（hostUrl=ws://linux002:8788/host） | PASS |
| Git/API identity match | owner path pi-coffee-t4-user2；API login/id=6 | 同左；api_identity_match=true | PASS |
| Conversation/history restored | session `015745d9-…` 存在；未做可选快照后测试 turn | session_files=1 仍在 | PASS（UI 登录复核待应用负责人） |
| branch / local SHA / fetched remote SHA | coffee/linux002/015745d9-… / c906e721… / c906e721…；dirty=yes | 同 SHA；ahead=0 behind=0；dirty=yes | PASS |
| linux001 and Transfer isolation | linux001 active；prepare-upload 无有效 scope token 返回 401 | 同左 | PASS |

- 失败项与处置：无。说明：`hostname -f` 返回 `linux002`（非 `linux002.lan`），基线与回滚后一致。Checkout 本地 dirty=yes（仅记有/无）。Transfer 侧 `POST /api/localsend/v2/prepare-upload` 无 scope/token 时 HTTP 401。
- 快照保留位置和计划删除条件：PVE VM 105 快照 `pi-coffee-t4-l002-20260922T113344Z`；T4 #36 验收确认后再删
- 声明：本证据不含密码、token、Cookie、会话正文或快照文件。

