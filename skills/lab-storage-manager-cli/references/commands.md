# CLI Contract Reference

## 全局参数

| 参数 | 说明 |
| --- | --- |
| `--base-url <url>` | 临时覆盖 API 地址，默认 `http://127.0.0.1:8000/api`；`auth login` 成功后会写入本地配置 |
| `--token <token>` | 临时覆盖本地 bearer token；`auth login` 不接受 |
| `--timeout <seconds>` | HTTP 超时秒数，默认 `5.0` |
| `--param key=value` | query 参数，仅支持已暴露的 `list` 类命令，可重复 |
| `--data-json '<json>'` | 内联 JSON object 负载；`create` 命令使用，部分非 `create` 写命令仅作兼容兜底 |
| `--data-file <path>` | UTF-8 JSON object 文件路径，与 `--data-json` 互斥 |

## ID 参数约定

- `inventory_id` / `order_id` 必须是单个正整数。
- 不支持逗号列表、范围、名称、CAS、搜索词或其它非 ID 形式作为 ID 参数。
- CLI 没有批量借用或批量修改命令；多目标写操作必须拆成多条单目标命令，并在执行前逐个确认目标和参数。

## 输出约定

成功：

```json
{"ok": true, "data": {}}
```

失败：

```json
{"ok": false, "error": {"code": "HTTP_ERROR", "message": "...", "detail": {}}}
```

## 退出码

| 退出码 | 语义 |
| --- | --- |
| `0` | 成功 |
| `1` | 其他 HTTP 错误 |
| `2` | `401` 认证失败或未认证（含 token 失效、CLI 登录失败、CLI 角色不允许） |
| `3` | `403` 无权限 |
| `4` | `404` 资源不存在 |
| `5` | `429` 限流 |
| `6` | 本地文件不存在 |
| `7` | 本地输入非法 |
| `8` | 命令行参数错误 |
| `9` | 网络错误 |

## auth

| CLI | HTTP | 输入 | 输出 |
| --- | --- | --- | --- |
| `auth login --username <u> [--password-stdin]` | `POST /users/login/token` | `username`，密码来自 stdin 或隐藏输入；固定 `device_id=cli`、`device_name=LabStorageManager CLI`；可选 `--base-url`、`--timeout`；不接受 `--token` | `config_path`、`user` |
| `auth whoami` | `GET /users/me` | 无；允许 `--token` / `--base-url` 临时覆盖 | 当前用户对象；仅在未使用 override 时刷新本地缓存 |
| `auth logout` | `POST /users/logout` | 无；允许 `--token` / `--base-url` 临时覆盖 | 后端消息；仅在未使用 override 时清本地认证信息 |

## inventory

### list

HTTP: `GET /inventory/`

支持 query：`skip`、`limit`、`status_filter`、`cas_filter`、`hazardous_only`、`search`、`search_field`、`fuzzy`、`sort_by`、`sort_order`

### get

HTTP: `GET /inventory/{inventory_id}`

输入：单个正整数 `inventory_id`

### cas

HTTP: `GET /inventory/cas/{cas_number}`

输入：`cas_number`

### name

HTTP: `GET /inventory/?search=...&search_field=name`

输入：名称关键词 `keyword`。

参数模式：

- `--page <number>`
- `--page-size <number>`
- `--summary`
- `--exact`：使用精确文本匹配。

### code

HTTP: `GET /inventory/code/{internal_code}`

输入：`internal_code`

### my-borrows

HTTP: `GET /inventory/dashboard/my-borrows`

输出：当前用户借用列表，含 `borrower_name`、`borrow_days`、`is_overdue`

### pending-stockin

HTTP: `GET /inventory/dashboard/pending-stockin`

输出：当前用户待补全入库列表

### borrow

HTTP: `POST /inventory/{inventory_id}/borrow`

输入：仅单个正整数 `inventory_id`，CLI 不再暴露请求体，也不支持代借人参数。

每次只借用一个库存 ID，不会按名称、CAS、搜索结果、逗号列表或范围批量借用。

### return

HTTP: `POST /inventory/{inventory_id}/return`

输入：单个正整数 `inventory_id`

输入 body：

```json
{"remaining_quantity": 120}
```

参数模式：

- `--remaining-quantity <number>`
- `--used-quantity <number>`：CLI 会先读取当前库存剩余量，再本地换算成 `remaining_quantity`

单位规则：

- `--used-quantity` 不做单位换算，传入值必须已经是库存 `unit` 对应的数量。
- 用户给出的单位与库存 `unit` / `specification` 不一致时，先执行 `inventory get <inventory_id>` 核对 `remaining_quantity`、`unit`、`specification`。
- 只有换算关系明确时，才能提交换算后的 `--used-quantity` 或 `--remaining-quantity`。
- 如果换算需要密度、滴数、瓶容量、开瓶状态或其它上下文，必须先向用户确认，不得猜测。
- `return` 不接受 `--unit`，也不接受 JSON payload 里的 `unit` 字段；归还时强制沿用现有库存规格单位。

### manual-add

HTTP: `POST /inventory/manual-add`

输入 body 字段：

- `cas_number`
- `name`
- `english_name` 可选
- `alias` 可选
- `category` 可选
- `brand` 可选
- `purity` 可选
- `storage_location` 可选
- `specification`
- `quantity_bottles`
- `is_hazardous`
- `notes` 可选

### update

HTTP: `PUT /inventory/{inventory_id}`

输入：单个正整数 `inventory_id`

允许字段：

- `name`
- `cas_number`
- `storage_location`
- `remaining_quantity`
- `notes`
- `english_name`
- `alias`
- `category`
- `brand`
- `purity`
- `is_hazardous`
- `specification`

参数模式：以上字段都可直接用命令参数传入，CLI 只提交显式传入的字段。

每次只更新一个库存 ID；批量修改必须拆成多条单目标命令。

## reagent-orders

### list

HTTP: `GET /reagent-orders/`

支持 query：`skip`、`limit`、`status_filter`、`search`、`search_field`、`fuzzy`、`sort_by`、`sort_order`

### get

HTTP: `GET /reagent-orders/{order_id}`

输入：单个正整数 `order_id`

### cas

HTTP: `GET /reagent-orders/?search=...&search_field=cas_number`

输入：`cas_number`

参数模式：

- `--page <number>`
- `--page-size <number>`
- `--summary`

### name

HTTP: `GET /reagent-orders/?search=...&search_field=name`

输入：名称关键词 `keyword`。

参数模式：

- `--page <number>`
- `--page-size <number>`
- `--summary`
- `--exact`：使用精确文本匹配。

### my

HTTP: `GET /reagent-orders/dashboard/my-reagent-orders`

### create

HTTP: `POST /reagent-orders/`

body 字段：

- `cas_number`
- `name`
- `english_name` 可选
- `alias` 可选
- `category` 可选
- `brand` 可选
- `purity` 可选
- `specification`
- `quantity`
- `price`
- `order_reason`
- `is_hazardous`
- `notes` 可选

`order_reason` 可选值：`running_out`、`not_stocked`、`common_public`、`not_found`、`reorder`、`high_usage`、`degraded`、`not_enough`、`others`

### update

HTTP: `PUT /reagent-orders/{order_id}`

输入：单个正整数 `order_id`

允许字段：

- `cas_number`
- `name`
- `english_name`
- `alias`
- `category`
- `brand`
- `purity`
- `initial_quantity`
- `unit`
- `quantity`
- `price`
- `order_reason`
- `is_hazardous`
- `notes`

参数模式：以上字段都可直接用命令参数传入，CLI 只提交显式传入的字段。

### cas-overview

HTTP: `GET /reagent-orders/cas-overview/{cas_number}`

### confirm-arrival

HTTP: `POST /reagent-orders/{order_id}/confirm-arrival`

输入：单个正整数 `order_id`

body 字段：

```json
{"arrival_notes": "已签收", "storage_location": "A-01"}
```

参数模式：

- `--arrival-notes <text>`
- `--storage-location <text>`

### stock-in

HTTP: `POST /reagent-orders/{order_id}/stock-in`

输入：单个正整数 `order_id`

body 字段：

```json
{"storage_location": "A-01", "remaining_quantity": 500}
```

参数模式：

- `--storage-location <text>`：显式参数模式下必填
- `--remaining-quantity <number>` 可选

## consumable-orders

### list

HTTP: `GET /consumable-orders/`

支持 query：`skip`、`limit`、`status_filter`、`search`、`search_field`、`fuzzy`、`sort_by`、`sort_order`

### get

HTTP: `GET /consumable-orders/{order_id}`

输入：单个正整数 `order_id`

### name

HTTP: `GET /consumable-orders/?search=...&search_field=name`

输入：名称关键词 `keyword`。

参数模式：

- `--page <number>`
- `--page-size <number>`
- `--summary`
- `--exact`：使用精确文本匹配。

### my

HTTP: `GET /consumable-orders/dashboard/my-consumable-orders`

### create

HTTP: `POST /consumable-orders/`

body 字段：

- `name`
- `english_name` 可选
- `product_number` 可选
- `specification`
- `unit` 可选
- `quantity`
- `price` 可选
- `communication` 可选
- `notes` 可选

### update

HTTP: `PUT /consumable-orders/{order_id}`

输入：单个正整数 `order_id`

允许字段：

- `name`
- `english_name`
- `product_number`
- `specification`
- `unit`
- `quantity`
- `price`
- `communication`
- `notes`

参数模式：以上字段都可直接用命令参数传入，CLI 只提交显式传入的字段。

### complete

HTTP: `POST /consumable-orders/{order_id}/complete`

输入：单个正整数 `order_id`

body：CLI 不接受请求体，也不暴露 `--data-*`

## common-shelf

### list

HTTP: `GET /common-shelf/groups`

支持 query：`skip`、`limit`、`search`、`search_field`、`fuzzy`、`match_mode`、`sort_by`、`sort_order`

### cas

HTTP: `GET /common-shelf/groups?search=...&search_field=cas_number&match_mode=exact`

输入：`cas_number`

### alias

HTTP: `GET /common-shelf/groups?search=...&search_field=alias`

输入：名称、英文名或别名关键词

### locations

HTTP: `GET /common-shelf/groups/{group_key}/locations`

输入：`group_key`，来自 `common-shelf list` / `cas` / `alias` 返回的分组键

### manual-add

HTTP: `POST /common-shelf/manual-add`

输入：JSON object 负载。属于写操作，执行前必须确认。

### add-bottles

HTTP: `POST /common-shelf/groups/{group_key}/add-bottles`

参数模式：`--count` 必填，可选 `--storage-location`、`--purity`、`--notes`。
属于写操作，执行前必须确认目标分组、位置和数量。

### remove-one

HTTP: `POST /common-shelf/groups/{group_key}/remove-one`

参数模式：可选 `--storage-location`。
属于写操作，执行前必须确认目标分组和扣减位置。

## chemical-name-map

### list

HTTP: `GET /chemical-name-map`

支持 query：`skip`、`limit`、`search`、`search_field`、`fuzzy`、`match_mode`、`sort_by`、`sort_order`

### search

HTTP: `GET /chemical-name-map?search=...&search_field=all`

输入：名称、英文名、别名或 CAS 关键词。

### cas

HTTP: `GET /chemical-name-map?search=...&search_field=cas_number&match_mode=exact`

输入：`cas_number`。用于按 CAS 精确查询主数据分类。

## 明确禁止的能力

- 所有 `delete`
- 所有 `export`
- 所有文件上传和 `multipart/form-data`
- 所有用户管理和自助资料修改，除了 `whoami` 与 `logout`
- 订单审批、拒绝
- Announcements、Cart Sync、Events、Error Logs 等非 CLI 域

## Agent 使用提示词

```text
只允许使用 `lsm` 及 skill 明确列出的子命令。
禁止 curl、requests/httpx、直接导入后端模块、直接访问数据库、直接改本地 CLI 配置文件。
如果目标操作没有对应 CLI 子命令，必须明确回复“当前 CLI 不支持该操作”，不能绕过到原始 HTTP。
技能目录 `.env` 不是 `lsm` 内置配置；Agent 必须先读取 `.env`，再把 `LSM_BASE_URL`、`LSM_USERNAME`、`LSM_PASSWORD` 传给登录命令。
`lsm auth whoami` 成功时也要核对当前用户名是否等于 `.env` 的 `LSM_USERNAME`；不一致时不能默默沿用当前 token。
登录时优先使用 `--password-stdin`，不要把密码写进命令行参数。
对具体库存/试剂/订单执行写操作前，先通过 CLI 查询拿到准确 ID；禁止猜测 ID，禁止在目标不确定时直接修改。
`inventory_id` / `order_id` 必须是单个正整数；禁止把逗号列表、范围、名称、CAS 或搜索词当作 ID 参数。CLI 没有批量借用或批量修改命令，多目标写操作必须逐个确认后拆成单目标命令。
库存归还时禁止传单位，`--used-quantity` 不做单位换算；用户单位与库存 `unit` / `specification` 不一致时，必须先查库存并明确换算，不能猜测。
执行前再次确认目标 ID、操作类型、输入值、单位都与用户意图完全一致；有任何不确定先问用户，不能“先试一下”。
`create` 命令使用 JSON object 负载，`--data-json` 和 `--data-file` 二选一；非 `create` 写操作优先使用显式命令参数；`consumable-orders complete` 不传 `--data-*`。
优先按退出码处理失败：2 表示 `401` 认证失败或未认证；已登录命令可重新登录，`auth login` 则检查用户名/密码或账号角色；3 权限不足，4 资源不存在，5 限流，6 文件不存在，7 本地输入错误，8 参数错误，9 网络错误。
```

