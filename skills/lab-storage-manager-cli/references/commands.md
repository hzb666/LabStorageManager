# CLI Contract Reference

## 全局参数

| 参数 | 说明 |
| --- | --- |
| `--base-url <url>` | 临时覆盖 API 地址，默认 `http://127.0.0.1:8000/api`；`auth login` 成功后会写入本地配置 |
| `--token <token>` | 临时覆盖本地 bearer token；`auth login` 不接受 |
| `--timeout <seconds>` | HTTP 超时秒数，默认 `30.0` |
| `--param key=value` | query 参数，仅支持已暴露的 `list` 类命令，可重复 |
| `--data-json '<json>'` | 内联 JSON object 负载；`create` 命令使用，部分非 `create` 写命令仅作兼容兜底 |
| `--data-file <path>` | UTF-8 JSON object 文件路径，与 `--data-json` 互斥 |

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

输入：`inventory_id`

### cas

HTTP: `GET /inventory/cas/{cas_number}`

输入：`cas_number`

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

输入：仅 `inventory_id`，CLI 不再暴露请求体，也不支持代借人参数。

### return

HTTP: `POST /inventory/{inventory_id}/return`

输入 body：

```json
{"remaining_quantity": 120, "unit": "mL"}
```

参数模式：

- `--remaining-quantity <number>`
- `--used-quantity <number>`：CLI 会先读取当前库存剩余量，再本地换算成 `remaining_quantity`
- `--unit <text>` 可选

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

## reagent-orders

### list

HTTP: `GET /reagent-orders/`

支持 query：`skip`、`limit`、`status_filter`、`search`、`search_field`、`fuzzy`、`sort_by`、`sort_order`

### get

HTTP: `GET /reagent-orders/{order_id}`

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

`order_reason` 可选值：`running_out`、`not_stocked`、`common_public`、`not_found`、`reorder`、`high_usage`、`degraded`、`others`

### update

HTTP: `PUT /reagent-orders/{order_id}`

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

body 字段：

```json
{"arrival_notes": "已签收", "storage_location": "A-01"}
```

参数模式：

- `--arrival-notes <text>`
- `--storage-location <text>`

### stock-in

HTTP: `POST /reagent-orders/{order_id}/stock-in`

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

body：CLI 不接受请求体，也不暴露 `--data-*`

## 明确禁止的能力

- 所有 `delete`
- 所有 `export`
- 所有文件上传和 `multipart/form-data`
- 所有用户管理和自助资料修改，除了 `whoami` 与 `logout`
- 订单审批、拒绝
- Common Shelf、Announcements、Chemical Name Map、Cart Sync、Events、Error Logs 等非 CLI 域

## Agent 使用提示词

```text
只允许使用 `python -m lsm_cli` 及 skill 明确列出的子命令。
禁止 curl、requests/httpx、直接导入后端模块、直接访问数据库、直接改本地 CLI 配置文件。
如果目标操作没有对应 CLI 子命令，必须明确回复“当前 CLI 不支持该操作”，不能绕过到原始 HTTP。
登录时优先使用 `--password-stdin`，不要把密码写进命令行参数。
对具体库存/试剂/订单执行写操作前，先通过 CLI 查询拿到准确 ID；禁止猜测 ID，禁止在目标不确定时直接修改。
执行前再次确认目标 ID、操作类型、输入值、单位都与用户意图完全一致；有任何不确定先问用户，不能“先试一下”。
`create` 命令使用 JSON object 负载，`--data-json` 和 `--data-file` 二选一；非 `create` 写操作优先使用显式命令参数；`consumable-orders complete` 不传 `--data-*`。
优先按退出码处理失败：2 表示 `401` 认证失败或未认证；已登录命令可重新登录，`auth login` 则检查用户名/密码或账号角色；3 权限不足，4 资源不存在，5 限流，6 文件不存在，7 本地输入错误，8 参数错误，9 网络错误。
```

