# `linux002` 虚拟化宿主快照回滚任务书

任务编号：PI Coffee T4 / Gitea `awangs/pi-coffee#36`  
执行对象：`linux002` / `linux002.lan` / `192.168.100.218`  
执行人员：虚拟化或网络管理员；PI Coffee 应用负责人配合  
执行窗口：由执行人员填写  
任务性质：可恢复性演练，不是新建克隆、迁移或灾难切换

## 1. 目标

在虚拟化宿主上对已关机的 `linux002` 创建一次磁盘一致快照，制造明确的
快照后变化，再回滚到该快照。证明恢复后的 User VM 同时满足：

1. VM 身份未漂移：hostname、固定 IP、machine-id 和 SSH Host Key 与快照前一致；
2. PI Coffee Host 可启动，owner 环境、passwordless root 和 Gitea Checkout 能力正常；
3. Gitea 普通用户和 Web 固定路由仍指向 `linux002`，Host token 仍匹配；
4. 快照前 Conversation 历史和 Checkout 可恢复，快照后的测试变化消失；
5. 恢复后重新从 Gitea fetch 得到的远端分支 SHA 与预期一致；
6. `linux001` 及其 Conversation、Transfer scope 不受影响。

本任务只操作专用验收 VM `linux002`。成功并回填证据后，再单独决定是否对
`linux001` 重复。平台名称和操作入口由管理员按实际环境填写；不要把本文中的
“创建快照”“回滚”映射为未经确认的厂商按钮。

## 2. 严格边界

- **任何时刻只能有一个 `linux002` 实例运行。** 不得同时启动原 VM、快照副本或
  恢复克隆，否则会造成 hostname、IP、machine-id、SSH Host Key、Host token 和
  Gitea 身份碰撞。
- 本演练使用原 VM 的原位 rollback。不要选择“从快照克隆为新 VM”。
- 快照必须在 Guest 正常关机后创建；不要包含运行内存。若平台无法提供关机磁盘
  快照，暂停任务，由应用负责人重新评估，不能把 crash-consistent 在线快照记为通过。
- 不修改或轮换 Host token、Gitea token、Git credential、machine-id、SSH Host Key。
- 不 force-push、不删除远端分支、不合并 PR、不删除 Conversation 或 Checkout。
- 密码、token、Cookie、会话正文、完整环境文件和快照文件不得写入 Git、Gitea
  Issue、聊天或执行报告。证据只记录布尔结果、公开标识和允许的 hash/fingerprint。
- 快照保留到 T4 #36 的验收证据被确认；在此之前不删除。

## 3. 前置条件和职责

虚拟化管理员需要具备查看 VM、关机/开机、创建快照、原位回滚和查看任务日志的
权限。应用负责人需要具备 `linux002`、`webserver` 的终端权限，以及通过浏览器
登录 Gitea 普通用户 `pi-coffee-t4-user2`（用户 ID `6`）的能力。

开始前共同确认：

- 虚拟化平台、集群/宿主节点、VM 显示名和不可变 VM ID 已登记；
- 当前只有目标 VM 实例，平台清单中没有已运行的同源恢复副本；
- `linux002` 的固定地址仍为 `192.168.100.218`；
- `webserver` 的地址仍为 `192.168.100.101`；
- 选择一个已完成、无运行中 turn 的 `linux002` 测试 Conversation；
- 该 Conversation 的必要代码已 checkpoint/push，或 dirty/untracked 状态已明确登记；
- 维护窗口内不向 `linux002` 提交新任务。

建议用仓库内向导逐阶段执行并生成脱敏草稿：

```bash
./scripts/vm-snapshot-rollback-wizard.sh
```

向导只提示和记录，不访问虚拟化平台，也不会自动关机、创建快照或回滚。

## 4. 阶段 A：登记宿主与基线

### A1. 登记平台对象

执行人员在证据模板中填写：平台名称、集群/宿主节点、VM 名称、平台 VM ID、
存储/数据盘、执行人和维护窗口。先从平台清单确认目标处于运行状态且没有同身份
副本，再进入 Guest。

### A2. 记录 Guest 身份

在 `linux002` 执行：

```bash
date -u +'%Y-%m-%dT%H:%M:%SZ'
hostnamectl --static
hostname -f
ip -4 -brief address
sha256sum /etc/machine-id
for key in /etc/ssh/ssh_host_*_key.pub; do
  sudo ssh-keygen -lf "$key"
done
systemctl show pi-coffee-host -p User --value
git -C /opt/pi-coffee rev-parse HEAD
git -C /opt/pi-coffee status --short
```

验收预期：hostname 为 `linux002`，FQDN 为 `linux002.lan`，目标地址为
`192.168.100.218`，服务用户是 VM owner。记录 machine-id 的 SHA-256 和所有
SSH 公钥 fingerprint；不要复制私钥或 `/etc/pi-coffee/host.env` 全文。

### A3. 记录 Host 与配置的非秘密字段

```bash
systemctl is-active pi-coffee-host
curl -fsS http://127.0.0.1:8788/healthz | python3 -c '
import json, sys
d=json.load(sys.stdin); c=d.get("capabilities", {})
print("ok=", d.get("ok"), "role=", d.get("role"),
      "giteaCheckouts=", c.get("giteaCheckouts"),
      "ownerEnvironment=", c.get("ownerEnvironment"),
      "passwordlessRoot=", c.get("passwordlessRoot"))'
sudo awk -F= '$1=="PI_COFFEE_VM_ID" || $1=="PI_COFFEE_GITEA_OWNER" || $1=="PI_COFFEE_GITEA_URL" {print}' /etc/pi-coffee/host.env
sudo -n id -u
```

验收预期：服务为 `active`；health 的三个 capability 都是 `True`；
`PI_COFFEE_VM_ID=linux002`；`PI_COFFEE_GITEA_OWNER=pi-coffee-t4-user2`；
`sudo -n id -u` 返回 `0`。只确认 `PI_COFFEE_HOST_TOKEN` 和
`PI_COFFEE_GITEA_TOKEN` 已设置，不输出其值。

### A4. 记录应用恢复锚点

由应用负责人在浏览器中打开选定的 `linux002` Conversation，等待状态 settled，
记录以下非秘密信息：

- Conversation ID；
- Project/repository；
- Conversation branch；
- Checkout 路径；
- 本地 `HEAD`；
- `git ls-remote origin <branch>` 返回的远端 SHA；
- 当前 history entry 数量或最后一条记录的非正文标识。

在对应 Checkout 执行一次 `git fetch origin` 后再记录 SHA。若本地有 dirty、
untracked 或 ignored 文件，只记录“有/无”和处置决定，不复制内容。恢复验收不能
把 Host 缓存的旧 `synced` 状态当成远端事实。

### A5. 创建快照前 marker

```bash
BASELINE_UTC=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
sudo install -d -m 0755 /var/lib/pi-coffee-recovery-test
printf 'before_snapshot=%s\n' "$BASELINE_UTC" | \
  sudo tee /var/lib/pi-coffee-recovery-test/before-snapshot.marker >/dev/null
sudo test -s /var/lib/pi-coffee-recovery-test/before-snapshot.marker
```

marker 不含凭据或用户数据。

## 5. 阶段 B：一致性停机和创建快照

1. 应用负责人确认没有 running/queued turn，也没有 checkpoint、迁移、上传或清理操作。
2. 停止 Host，确认停止后正常关机：

   ```bash
   sudo systemctl stop pi-coffee-host
   systemctl is-active pi-coffee-host
   sudo systemctl poweroff
   ```

   `systemctl is-active` 预期返回 `inactive`，其退出码可能非零。SSH 断开后，管理员
   从虚拟化平台确认 Guest 已完全关机。

3. 在平台上对**原 VM**创建磁盘快照，建议名称：
   `pi-coffee-t4-linux002-<UTC>`。
4. 记录快照 ID、名称、创建 UTC、目标 VM ID、所含磁盘、内存未包含，以及平台任务
   成功状态。不要上传快照文件。
5. 启动同一个原 VM，等待 SSH 恢复。确认平台中没有第二个同身份实例运行。

## 6. 阶段 C：制造快照后差异

Guest 启动后执行：

```bash
sudo systemctl start pi-coffee-host
systemctl is-active pi-coffee-host
curl -fsS http://127.0.0.1:8788/healthz >/dev/null
AFTER_UTC=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
printf 'after_snapshot=%s\n' "$AFTER_UTC" | \
  sudo tee /var/lib/pi-coffee-recovery-test/after-snapshot.marker >/dev/null
sudo test -s /var/lib/pi-coffee-recovery-test/after-snapshot.marker
```

应用负责人可在选定的**可丢弃测试 Conversation** 中新增一个明确的无秘密测试 turn，
等待 settled，并记录“快照后 history entry 数量”。不要修改正式远端 branch，也不要
把未推送业务代码当作回滚 marker。

在继续前同时确认两个 marker 都存在：

```bash
sudo ls -l /var/lib/pi-coffee-recovery-test/before-snapshot.marker \
  /var/lib/pi-coffee-recovery-test/after-snapshot.marker
```

## 7. 阶段 D：执行原位 rollback

1. 再次禁止新任务，确认没有运行中的 turn 或文件传输。
2. 正常停止并关闭 Guest：

   ```bash
   sudo systemctl stop pi-coffee-host
   sudo systemctl poweroff
   ```

3. 在平台确认 VM 已关机、VM ID 与阶段 A 相同。
4. 选择阶段 B 记录的精确快照 ID，执行**原 VM 原位回滚**。
5. 平台任务成功后再次核查没有同身份实例运行，然后只启动恢复后的原 VM。
6. 记录回滚开始/完成 UTC 和平台任务结果。

如果平台显示目标 VM ID、磁盘集合或快照 ID 不匹配，立即停止，不执行回滚。

## 8. 阶段 E：回滚后验收

### E1. 证明磁盘确实回到快照点

```bash
sudo test -s /var/lib/pi-coffee-recovery-test/before-snapshot.marker
if sudo test -e /var/lib/pi-coffee-recovery-test/after-snapshot.marker; then
  echo 'FAIL: after-snapshot marker still exists'
  exit 1
else
  echo 'PASS: after-snapshot marker is absent'
fi
```

前 marker 必须存在，后 marker 必须消失。否则不能把本次操作记为 rollback 成功。

### E2. 复核身份和 Host

重跑阶段 A2、A3 的命令。hostname、IP、machine-id hash、SSH Host Key
fingerprint、服务用户、VM ID 和 Gitea owner 必须与基线完全一致。然后执行：

```bash
sudo systemctl start pi-coffee-host
systemctl is-active pi-coffee-host
curl -fsS http://127.0.0.1:8788/healthz | python3 -c '
import json, sys
d=json.load(sys.stdin); c=d.get("capabilities", {})
assert d.get("ok") is True and d.get("role") == "host"
assert all(c.get(k) is True for k in ("giteaCheckouts", "ownerEnvironment", "passwordlessRoot"))
print("PASS: host health and capabilities")'
cd /opt/pi-coffee && npm run probe:owner-access
```

### E3. 复核 Web 路由与凭据身份

在 `webserver` 上执行以下只输出非秘密字段的检查：

```bash
sudo python3 - <<'PY'
import json
with open('/etc/pi-coffee/routes.json', encoding='utf-8') as f:
    route=json.load(f)['6']
print('hostUrl=', route.get('hostUrl'))
print('hostToken_present=', bool(route.get('hostToken')))
PY
systemctl is-active pi-coffee-web
```

`hostUrl` 必须指向 `linux002:8788`，用户 ID `6` 的 route 必须存在且 token 非空。
应用负责人在本地终端比较恢复后的 Host token 与 route token，只在证据中记录
`host_token_match=true`，不得记录 token 或 token hash。

在 `linux002` 以服务 owner 的身份验证 Git credential 返回的 username 是
`pi-coffee-t4-user2`，并对已登记仓库执行一次只读 `git ls-remote`。验证 Gitea API
凭据也属于同一普通用户。只记录 `git_identity_match=true`、
`api_identity_match=true` 和只读探针结果；不得用 `set -x`，不得打印 credential
password 或 API token。若部署约定 Git 与 API 共用同一 token，可在内存中比较后只
记录布尔结果。

### E4. 复核 Conversation、Git 和隔离

1. 通过 Gitea OAuth 重新登录普通用户 `pi-coffee-t4-user2`。
2. 打开阶段 A 记录的 Conversation，确认快照前 history 存在且可继续；若阶段 C
   创建了测试 turn，它应随回滚消失。不要把会话正文复制到证据。
3. 在 Checkout 执行：

   ```bash
   git status --short
   git fetch origin
   git rev-parse HEAD
   git rev-parse --verify '@{upstream}'
   git ls-remote origin '<记录的 Conversation branch>'
   ```

   记录本地 SHA 和重新 fetch 后的远端 SHA。远端可能在快照后合法前移，因此不要求
   远端回退；若本地与远端不同，应报告真实 `ahead/behind/diverged` 状态，不 reset、
   rebase 或 force-push。只有远端 SHA 与预期 checkpoint 一致时才能记为 synced。
4. 确认 `linux001` 仍健康，其三个 Conversation 未进入 `linux002` 的 workspace
   列表；使用另一 VM 的 Transfer token 访问仍返回 `401`。

## 9. 失败处置

发生任一情况时判定失败并停止 `pi-coffee-host`，不要让 Web 继续路由到该 Host：

- 出现两个同身份运行实例；
- 回滚的 VM ID、磁盘或快照 ID 不一致；
- 快照前 marker 缺失或快照后 marker 仍存在；
- hostname、IP、machine-id、SSH Host Key、VM ID、Gitea owner 任一漂移；
- Host token 与固定路由不匹配；
- Host health 或三项 capability 未通过；
- Conversation、Checkout 或必要历史无法恢复；
- 恢复后未 fetch 就被报告为 synced；
- `linux001` 的会话或 Transfer scope 出现在 `linux002`。

失败时保留目标快照和平台任务日志，记录失败点、时间、当前电源状态和已执行动作。
不要连续尝试其他快照，不要用新 token 或重新生成 machine-id 掩盖恢复失败。由应用
负责人决定是修复恢复实例、再次回滚，还是从当前 VM 正常启动服务。

## 10. 完成条件与证据回填

全部验收通过后，可删除两个 marker；快照仍保留到 T4 #36 确认：

```bash
sudo rm -f /var/lib/pi-coffee-recovery-test/before-snapshot.marker \
  /var/lib/pi-coffee-recovery-test/after-snapshot.marker
```

把下列脱敏结果回填到 Gitea Issue `awangs/pi-coffee#36`。实际执行前只可评论
“任务书已准备”，不能关闭 Issue；只有管理员执行、证据复核通过后才可把 snapshot
rollback 门槛标为完成。

```markdown
## linux002 snapshot rollback evidence

- 执行人 / 复核人：
- 虚拟化平台 / 宿主节点：
- VM 名称 / 不可变 VM ID：
- 维护窗口（UTC）：
- 快照名称 / ID / 创建 UTC：
- 快照类型：powered-off disk snapshot；memory included=false
- rollback 开始 / 完成 UTC：
- 平台任务结果：

| 检查 | 基线 | 回滚后 | 结果 |
|---|---|---|---|
| hostname / FQDN / IP | | | PASS/FAIL |
| machine-id SHA-256 | | | PASS/FAIL |
| SSH Host Key fingerprints | | | PASS/FAIL |
| before marker exists | true | true | PASS/FAIL |
| after marker exists | n/a | false | PASS/FAIL |
| pi-coffee-host active | true | true | PASS/FAIL |
| 3 Host capabilities | true | true | PASS/FAIL |
| VM ID / Gitea owner | linux002 / pi-coffee-t4-user2 | | PASS/FAIL |
| Host route/token match | true | true | PASS/FAIL |
| Git/API identity match | true | true | PASS/FAIL |
| Conversation/history restored | | | PASS/FAIL |
| branch / local SHA / fetched remote SHA | | | PASS/FAIL |
| linux001 and Transfer isolation | true | true | PASS/FAIL |

- 失败项与处置：无 / ...
- 快照保留位置和计划删除条件：T4 #36 验收确认后
- 声明：本证据不含密码、token、Cookie、会话正文或快照文件。
```

