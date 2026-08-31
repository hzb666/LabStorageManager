---
name: lab-storage-manager-cli
description: "Use when the task must operate LabStorageManager through its local CLI (`lsm`) for login, inventory, borrow state, reagent orders, consumable orders, common shelf, or CAS master data, and the work must stay inside the CLI's allowed command surface instead of raw HTTP, direct backend imports, or database access."
---

# Lab Storage Manager CLI

通过仓库内置 CLI 操作 LabStorageManager。统一使用 `lsm ...`。
CLI 的能力边界以当前命令面为准，不以后端已有 API 为准。

## 硬限制

- 只允许调用 `lsm` 及其已暴露的子命令。
- 禁止使用 `curl`、`Invoke-WebRequest`、`Invoke-RestMethod`、`requests`、`httpx`、浏览器 `fetch`、直接导入后端模块、直接访问数据库、直接改本地配置文件伪造 token。
- 禁止访问 CLI 未暴露的接口，即使你知道后端存在该 API。
- 对某个具体库存/试剂/订单执行写操作前，必须先通过 CLI 查询拿到准确 ID；允许通过名称、CAS、内部编码等线索先查，再使用返回结果里的 `id` / `inventory_id` / `order_id` 执行修改。禁止猜测 ID，禁止跳过查询直接修改不确定目标。
- `inventory_id` / `order_id` 参数必须是单个正整数；禁止把逗号列表、范围、名称、CAS 或搜索词塞进 ID 参数。
- CLI 没有批量借用或批量修改命令；多目标写操作只能在用户明确列出并确认每个目标 ID、动作和值之后，按单条命令逐个执行。
- 对任何操作在真正执行前，都必须再次核对目标 ID、操作类型、输入值是否与用户意图完全一致；只有在目标、动作、参数三者都明确无误时才能实施。
- 如果目标匹配结果不唯一、字段含义不清楚、单位/数量存在歧义、操作后果不确定，或你对要执行的对象/值有任何疑问，必须先向用户确认，不能“先试一下”。
- 归还库存时禁止传单位；CLI 和后端会沿用现有库存 `unit` / `specification`。如果用户给出的单位不一致，必须先查询库存并明确换算成现有单位，再把换算后的数量作为 `--used-quantity` 或 `--remaining-quantity`。
- 任何大范围、高破坏性或批量数量较大的操作，必须先明确提醒用户影响范围与后果，并在获得用户确认后才能执行。未确认前禁止实施。
- 登录只允许普通用户账号；管理员和 `public` 账号不能作为 CLI 入口。
- 禁止使用明文密码参数。优先 `--password-stdin`，否则接受隐藏输入提示。
- `auth login` 不接受 `--token`；登录成功会写本地配置。
- `create` 命令继续使用 JSON object 负载；`--data-json` 与 `--data-file` 二选一。非 `create` 写操作优先使用显式命令参数；如果命令不接受 body，不要传 `--data-*`。
- 禁止文件上传、导出、删除、用户管理、会话管理、密码修改、头像修改。
- 如果目标操作没有对应 CLI 命令，立即停止并明确说明“当前 CLI 不支持该操作”。

## 先决条件

- 在仓库根目录执行命令。
- CLI 已安装，且 `lsm --help` 能运行。
- 后端 API 可达；默认地址是 `http://127.0.0.1:8000/api`。
- 技能目录下允许放置 `.env`，用于保存首次提供的登录信息；后续默认从这里复用，不再要求用户重复说明。
- 本地配置文件存在于：
  - Windows 优先：`%APPDATA%\\LabStorageManager\\cli.json`
  - 回退：`~/.labstoragemanager-cli.json`

## 技能目录环境变量

- 技能目录下的 `.env` 使用以下键：
  - `LSM_BASE_URL`
  - `LSM_USERNAME`
  - `LSM_PASSWORD`
- 推荐首次由用户提供一次 URL、用户名、密码后写入该文件。
- `lsm` 本身不会自动加载技能目录 `.env`；Agent 必须先在命令外读取该文件，再把值传给 `lsm auth login`。
- 后续如果认证失效、本地无 token，或用户明确要求使用 `.env` 账号，默认先从该 `.env` 读取并尝试重新登录，不再要求用户重复提供。
- 如果 `lsm auth whoami` 成功，也必须核对当前用户名是否等于 `LSM_USERNAME`；不一致时不能默默沿用当前 token。
- 如果 `.env` 缺失、字段为空、或使用 `.env` 登录失败，再向用户确认。

## 快速开始

1. 确认命令面：`lsm --help`
2. 首次把 URL、用户名、密码写入技能目录下的 `.env`
3. 先读取技能目录 `.env`，拿到 `LSM_BASE_URL`、`LSM_USERNAME`、`LSM_PASSWORD`
4. 认证探测：执行 `lsm auth whoami`
5. 若 `whoami` 成功且用户名等于 `LSM_USERNAME`，继续执行目标命令
6. 若 `whoami` 成功但用户名不等于 `LSM_USERNAME`，先说明当前用户与 `.env` 用户不一致；用户要求使用 `.env` 账号时，使用 `.env` 重新登录
7. 若未登录，则使用 `.env` 和 `--password-stdin` 登录
8. 登录成功后再次执行 `lsm auth whoami`，确认用户名等于 `LSM_USERNAME`
9. 执行目标命令并解析 stdout JSON

## 允许的命令分组

### 顶层
- `update-check`
- `update`

### auth
- `auth login`
- `auth whoami`
- `auth logout`

### inventory
- `inventory list`
- `inventory get`
- `inventory cas`
- `inventory name`
- `inventory code`
- `inventory my-borrows`
- `inventory pending-stockin`
- `inventory borrow`
- `inventory return`
- `inventory manual-add`
- `inventory update`

### reagent-orders
- `reagent-orders list`
- `reagent-orders get`
- `reagent-orders cas`
- `reagent-orders name`
- `reagent-orders my`
- `reagent-orders create`
- `reagent-orders update`
- `reagent-orders cas-overview`
- `reagent-orders confirm-arrival`
- `reagent-orders stock-in`

### consumable-orders
- `consumable-orders list`
- `consumable-orders get`
- `consumable-orders name`
- `consumable-orders my`
- `consumable-orders create`
- `consumable-orders update`
- `consumable-orders complete`

### common-shelf
- `common-shelf list`
- `common-shelf cas`
- `common-shelf alias`
- `common-shelf locations`
- `common-shelf manual-add`
- `common-shelf add-bottles`
- `common-shelf remove-one`

### chemical-name-map
- `chemical-name-map list`
- `chemical-name-map search`
- `chemical-name-map cas`

## 试剂订购原因判定

执行 `reagent-orders create` 前，先调用 `lsm reagent-orders cas-overview <cas_number>` 读取 `data.is_common_cas`：

- 用户明确说明原因时，按完整语义选择本次订购的 `order_reason`。
- 用户没有特别要求且为公用 CAS 时，默认使用 `common_public`。
- 非公用 CAS 根据用户语义选择；确实无法判断时再询问用户。

CLI 不解析自然语言，也不补全或覆盖原因；Agent 必须在调用 CLI 前确定并写入 `order_reason`。

## CLI 与 Skill 更新

- `lsm update-check` 只检查最新正式 Release，不需要登录；输出中的 `update_command` 给出下一步命令。
- `lsm update` 校验 `SHA256SUMS.txt`，先暂存预编译 CLI 和同一 Release 标签的完整 Skill，再作为同一批次替换；任一目标失败都会回滚整批，并保留 Skill 目录已有的 `.env`。
- 默认 `--skill-host auto` 更新已检测到的 Codex 或 Claude Code Skill；无法自动检测时，根据当前宿主显式传 `codex` 或 `claude`。
- 更新 Skill 后提醒用户重启对应 Agent。旧 CLI 如果还没有 `update` 命令，需按 `INSTALL.md` 的自动安装协议过渡一次。

## 标准执行流程

1. 先判定任务是否存在对应 CLI 子命令。
2. 需要认证时，默认先读取技能目录 `.env`，再执行 `lsm auth whoami` 探测当前本地 token 是否可用。
   - 若 `whoami` 成功且当前用户名等于 `LSM_USERNAME`，则继续执行目标命令
   - 若 `whoami` 成功但当前用户名不等于 `LSM_USERNAME`，不能默默沿用当前 token；如果用户明确要求使用 `.env` 账号，则使用 `.env` 重新登录，否则先说明当前登录用户和 `.env` 用户不一致
   - 若 `whoami` 失败或本地无 token，则默认从技能目录 `.env` 读取 `LSM_BASE_URL`、`LSM_USERNAME`、`LSM_PASSWORD` 并执行登录
   - `.env` 是 Agent 配置，不是 CLI 内置配置；不能假设 `lsm` 会自动读取它
   - 登录时优先使用 `--password-stdin`
   - `--base-url` 通常只需在首次登录时显式设置一次；登录成功后会写入本地配置，后续一般无需重复设置
   - `--token` / `--base-url` 仅作临时覆盖；对 `auth whoami` / `auth logout` 不应污染本地配置
   - 若 `.env` 缺失、字段不完整、或使用 `.env` 登录失败，再向用户确认
3. 对写操作目标不确定时，先用 `list`、`get`、`cas`、`code`、`my-*` 等读命令定位目标，并从返回 JSON 中读取准确 ID。
   - 查 CAS 时，优先使用专门接口 `lsm inventory cas <cas_number>`
   - 查名称时，优先使用 `lsm inventory name <keyword>`
   - 查试剂订单 CAS 时，优先使用 `lsm reagent-orders cas <cas_number>`
   - 查试剂/耗材订单名称时，优先使用 `lsm reagent-orders name <keyword>` 或 `lsm consumable-orders name <keyword>`
   - 库存查不到且需要判断常用货架时，先查 `lsm chemical-name-map search <keyword>` 或 `lsm chemical-name-map cas <cas_number>`；分类为 `acid`、`base`、`salt`、`solvent` 时，再查 `lsm common-shelf alias <keyword>` 或 `lsm common-shelf cas <cas_number>`
   - `inventory list` 不支持按 `inventory_id` 过滤；已知 ID 时直接使用 `inventory get <inventory_id>`
   - 查询库存时，默认应整理并返回这些关键信息：名称（`name`）、CAS（`cas_number`）、品牌（`brand`）、剩余量或规格（`remaining_quantity` / `specification`）、借用状态（`status`）以及借用人（优先 `borrower_name`）
   - 查询库存时，若给出名称但精确查询查不到，可以用别名、关键词做模糊搜索，但只能列出候选和匹配依据；不得用化学知识自行认定目标。只有 CAS、内部编码、精确别名或用户确认能唯一定位时，才可继续读取 ID 或执行写操作。
4. 对需要资源 ID 的写操作，如果用户只给了名称、CAS、内部编码等线索，先查 ID，再执行写操作；如果仍然不能唯一定位，立即停止并说明 CLI 当前无法安全执行。
   - `inventory borrow <inventory_id>` 每次只借用一个库存 ID。
   - `inventory return <inventory_id>` 可用 `--used-quantity`，但输入值必须已经是库存 `unit` 对应的数量；若用户单位不同，先用 `inventory get <inventory_id>` 核对 `remaining_quantity`、`unit`、`specification`，只在换算明确后提交换算后的数量；禁止传 `--unit` 或 JSON `unit` 字段。
   - 如果单位换算需要密度、滴数、瓶容量、开瓶状态或其它上下文，必须先向用户确认，不得猜测。
   - `inventory update <inventory_id>` 每次只更新一个库存 ID，且只提交显式传入的字段。
   - 所有 `<inventory_id>` / `<order_id>` 都必须是单个正整数，不支持 `1,2`、`1-3` 这类批量写入形式。
5. 在真正执行写操作前，再次复核：目标 ID 是否正确、动作是否正确、输入值与单位是否正确、命令是否会命中用户想要的对象；任何一项不能完全确认时，先询问用户。
6. 读操作优先 `list`、`get`、`my-*` 这类命令，不要臆造 query/path。
7. `reagent-orders create` 先按“试剂订购原因判定”确定 `order_reason`；其他 `create` 命令直接使用用户已确认的字段。所有 `create` 命令均使用 JSON object 负载：
   - 小 payload 用 `--data-json`
   - 已有文件时用 `--data-file`
8. 非 `create` 写操作优先使用显式命令参数；若命令保留 JSON 兼容模式，只在用户明确提供 object 负载时使用 `--data-json` / `--data-file`。
9. `consumable-orders complete` 不传 `--data-*`。
10. 优先按退出码分支；再结合 `error.code` 和 `error.detail` 处理。
11. 失败后不要切换到原始 HTTP 或数据库旁路。

## 失败分支

- `2`：`401` 认证失败或未认证；已登录命令可重新登录或更换 token，`auth login` 则检查用户名/密码或账号角色
- `3`：权限不足，停止，不重试
- `4`：目标不存在，检查 id/CAS/code
- `5`：限流，等待或按用户要求重试
- `6`：本地文件路径错误，修正后再试
- `7`：本地输入错误，修正参数或 JSON object 负载
- `8`：命令行参数错误，回到允许命令表重组命令
- `9`：网络错误，检查后端服务和 `--base-url`

## 详细参考

完整命令、参数、请求体、输出预期、退出码、限制能力见 [references/commands.md](references/commands.md)。
