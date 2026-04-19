# LabStorageManager CLI

面向 agent 和开发者的本地命令行入口。CLI 通过 `python -m lsm_cli` 调用后端 API，不直接访问数据库或导入服务层。

## 适用范围

- 普通用户认证
- 库存查询与普通用户可执行的库存操作
- 常用货架查询、手动添加、加瓶与扣减 1 瓶
- 试剂订单查询与普通用户可执行的订单操作
- 耗材订单查询与普通用户可执行的订单操作

CLI 自身有额外限制：

- 不开放 `delete`
- 不开放 `export`
- 不开放常用货架分组编辑、条目编辑、删除、导出或 CAS 主数据接口
- 不开放文件上传
- 不开放用户自助和管理接口，除了 `login/token`、`logout`、`me`
- 不开放任何 CLI 未显式暴露的 API

## 运行方式

在仓库根目录执行：

```bash
python -m lsm_cli --help
```

## Linux / venv 独立安装

`lsm_cli` 可以作为独立 Python 包安装。安装后会生成 `lsm` 命令。

使用 Python 自带虚拟环境：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install ./lsm_cli
lsm --help
```

`pip install ./lsm_cli` 会读取 `pyproject.toml`，构建包并安装依赖。

如果使用 `pipx`：

```bash
pipx install ./lsm_cli
lsm --help
```

## 目录版 EXE 分发

如果要发给普通 Windows 用户，推荐做目录版 exe，而不是单文件 exe。

目录版的特点：

- 启动更稳，不需要每次运行都临时解压
- 最终是一个目录，不只是一个 `lsm.exe`
- 长期占用主要是程序目录本身和本地配置文件，不会额外生成大量日志/缓存

### 构建

先准备带 `PyInstaller` 的 Python 环境，然后在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\lsm_cli\windows\build.ps1 -Clean
```

默认输出目录：

```text
dist\lsm\
  lsm.exe
  _internal\
  ...
```

### 安装到固定目录

把目录版产物安装到当前用户目录，并自动加入用户级 `PATH`：

```powershell
powershell -ExecutionPolicy Bypass -File .\lsm_cli\windows\install.ps1
```

默认安装位置：

```text
C:\Users\<user>\AppData\Local\LabStorageManager\bin\lsm
```

安装脚本会：

- 复制整个 `dist\lsm` 目录
- 把安装目录加入当前用户的 `PATH`
- 保留目录版结构，不改成单文件模式

安装完成后，重新打开终端即可直接运行：

```powershell
lsm auth login --username alice --password-stdin
lsm inventory list
```

如果只想复制文件但不修改 `PATH`：

```powershell
powershell -ExecutionPolicy Bypass -File .\lsm_cli\windows\install.ps1 -SkipPathUpdate
```

## macOS 目录版分发

macOS 也建议用目录版，而不是单文件打包。

### 构建

```bash
bash ./lsm_cli/macos/build.sh --clean
```

默认输出目录：

```text
dist/lsm/
```

### 安装到固定目录

```bash
bash ./lsm_cli/macos/install.sh
```

默认安装位置：

```text
~/Library/Application Support/LabStorageManager/bin/lsm
```

脚本会：

- 把目录版产物复制到固定位置
- 自动把 `~/Library/Application Support/LabStorageManager/bin/lsm` 加入 `PATH`
- 默认写入：
  - `~/.zshrc`
  - 如果当前 shell 是 bash，则写入 `~/.bash_profile`

如果之前安装过旧版脚本，重新运行安装命令会移除旧的父目录
`PATH` 条目，并追加正确的目录版 `PATH` 条目。

安装完成后，重新打开终端即可直接运行：

```bash
lsm auth login --username alice --password-stdin
lsm inventory list
```

## 认证与本地配置

### 登录

推荐使用标准输入传递密码，避免出现在 shell history 和进程参数里：

```bash
Get-Content .\password.txt | python -m lsm_cli auth login --username alice --password-stdin
```

如果不提供 `--password-stdin`，CLI 会使用隐藏输入提示：

```bash
python -m lsm_cli auth login --username alice
```

说明：

- `auth login` 支持 `--base-url` 和 `--timeout`
- `auth login` 不接受 `--token`
- 登录成功后会把本次使用的 `base_url`、返回的 token 和用户信息写入本地配置

### 配置文件位置

- Windows 优先：`%APPDATA%\LabStorageManager\cli.json`
- 回退路径：`~/.labstoragemanager-cli.json`

示例：

```json
{
  "base_url": "http://127.0.0.1:8000/api",
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": 12,
    "username": "alice",
    "full_name": "张三",
    "role": "user"
  }
}
```

`auth logout` 只清理 `access_token`、`token_type`、`user`，会保留 `base_url`。

## 输出契约

所有命令都向 `stdout` 输出 JSON。

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_ERROR",
    "message": "Invalid credentials",
    "detail": {
      "detail": "Invalid credentials"
    }
  }
}
```

约束：

- 优先按退出码分支处理
- `error.code` 用于区分本地输入、网络、HTTP 等错误类别
- 不要依赖英文 `message` 做自动化逻辑判断

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 其他 HTTP 错误 |
| `2` | `401`，认证失败或未认证（含 token 失效、CLI 登录失败、CLI 角色不允许） |
| `3` | `403`，权限不足 |
| `4` | `404`，资源不存在 |
| `5` | `429`，触发限流 |
| `6` | 本地文件不存在 |
| `7` | 本地输入非法 |
| `8` | 命令行参数错误 |
| `9` | 网络错误 |

## 全局参数

这些参数可以写在顶层命令后，也可以写在叶子命令后。

| 参数 | 说明 |
| --- | --- |
| `--base-url <url>` | 临时覆盖 API 地址，默认 `http://127.0.0.1:8000/api`；`auth login` 成功后会把该地址写入本地配置 |
| `--token <token>` | 临时覆盖本地保存的 Bearer token；不适用于 `auth login` |
| `--timeout <seconds>` | HTTP 超时，默认 `5.0` |

## 通用输入参数

### Query 参数

`list` 类命令支持重复使用 `--param key=value`：

```bash
python -m lsm_cli inventory list --param search=乙醇 --param status_filter=in_stock
```

也支持更友好的分页封装：

```bash
python -m lsm_cli inventory list --page 2 --page-size 20 --param search=苯胺
python -m lsm_cli inventory list --summary --param search=苯胺
```

注意：

- 必须是 `key=value`
- 同一个 key 重复出现时，后者覆盖前者
- 未知的 `--param` key 不会再静默忽略，CLI 会直接返回本地输入错误
- `--page-size` 映射到 `limit`
- `--page` 是从 `1` 开始的页码，会根据当前页大小换算 `skip`
- `--summary` 只输出 `total/skip/limit`，不会返回明细列表
- `--summary` 不能和 `skip/limit`、`--page`、`--page-size` 混用

### JSON 负载

需要请求体的写操作只支持两种 JSON 输入方式，且负载必须是 JSON object：

- `--data-json '{"key":"value"}'`
- `--data-file payload.json`

同时传两者会返回退出码 `7`，传数组/字符串/`null` 等非 object JSON 也会返回退出码 `7`。

### 参数模式

除 `create` 命令外，其它写操作优先支持显式参数模式。

例如：

```bash
python -m lsm_cli inventory borrow 12
python -m lsm_cli inventory return 12 --used-quantity 20
python -m lsm_cli inventory update 12 --storage-location A-02 --notes "转移货架"
python -m lsm_cli inventory name 乙醇
python -m lsm_cli reagent-orders cas 64-17-5
python -m lsm_cli reagent-orders name 乙醇
python -m lsm_cli consumable-orders name 手套
python -m lsm_cli common-shelf cas 64-17-5
python -m lsm_cli common-shelf alias 酒精
python -m lsm_cli common-shelf add-bottles <group_key> --count 2 --storage-location A-02
python -m lsm_cli common-shelf remove-one <group_key> --storage-location A-02
python -m lsm_cli reagent-orders update 18 --price 199 --brand 国药
python -m lsm_cli reagent-orders confirm-arrival 18 --storage-location B-01
python -m lsm_cli reagent-orders stock-in 18 --storage-location B-01 --remaining-quantity 450
python -m lsm_cli consumable-orders update 9 --quantity 3 --notes "改成三盒"
```

规则：

- 非 `create` 写操作可直接用命令参数，不必手写 JSON
- 旧的 `--data-json` / `--data-file` 仍保留，作为兼容兜底
- 参数模式与 `--data-json` / `--data-file` 互斥
- `update` 命令只会提交你显式传入的字段
- `inventory_id` / `order_id` 必须是单个正整数，不支持逗号列表、范围或批量写操作

## 命令总览

### auth

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `auth login --username <u> [--password-stdin]` | 登录并写本地配置 | `POST /users/login/token` |
| `auth whoami` | 获取当前用户资料；仅在未使用 override 时刷新本地缓存 | `GET /users/me` |
| `auth logout` | 退出登录；仅在未使用 override 时清本地认证信息 | `POST /users/logout` |

### inventory

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `inventory list` | 列出库存 | `GET /inventory/` |
| `inventory get <inventory_id>` | 查看单条库存 | `GET /inventory/{inventory_id}` |
| `inventory cas <cas_number>` | 按 CAS 查询库存概览 | `GET /inventory/cas/{cas_number}` |
| `inventory name <keyword>` | 按名称搜索库存列表 | `GET /inventory/?search=...&search_field=name` |
| `inventory code <internal_code>` | 按内部编码查询库存 | `GET /inventory/code/{internal_code}` |
| `inventory my-borrows` | 查看当前用户借用中的库存 | `GET /inventory/dashboard/my-borrows` |
| `inventory pending-stockin` | 查看当前用户待补全入库项 | `GET /inventory/dashboard/pending-stockin` |
| `inventory borrow <inventory_id>` | 借用库存 | `POST /inventory/{inventory_id}/borrow` |
| `inventory return <inventory_id>` | 归还库存 | `POST /inventory/{inventory_id}/return` |
| `inventory manual-add` | 手工新增库存 | `POST /inventory/manual-add` |
| `inventory update <inventory_id>` | 更新库存 | `PUT /inventory/{inventory_id}` |

### reagent-orders

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `reagent-orders list` | 列出试剂订单 | `GET /reagent-orders/` |
| `reagent-orders get <order_id>` | 查看单条试剂订单 | `GET /reagent-orders/{order_id}` |
| `reagent-orders cas <cas_number>` | 按 CAS 搜索试剂订单列表 | `GET /reagent-orders/?search=...&search_field=cas_number` |
| `reagent-orders name <keyword>` | 按名称搜索试剂订单列表 | `GET /reagent-orders/?search=...&search_field=name` |
| `reagent-orders my` | 查看当前用户试剂订单 | `GET /reagent-orders/dashboard/my-reagent-orders` |
| `reagent-orders create` | 新建试剂订单 | `POST /reagent-orders/` |
| `reagent-orders update <order_id>` | 更新试剂订单 | `PUT /reagent-orders/{order_id}` |
| `reagent-orders cas-overview <cas_number>` | 查看试剂 CAS 概览 | `GET /reagent-orders/cas-overview/{cas_number}` |
| `reagent-orders confirm-arrival <order_id>` | 确认到货 | `POST /reagent-orders/{order_id}/confirm-arrival` |
| `reagent-orders stock-in <order_id>` | 订单入库 | `POST /reagent-orders/{order_id}/stock-in` |

### common-shelf

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `common-shelf list` | 列出常用货架分组 | `GET /common-shelf/groups` |
| `common-shelf cas <cas_number>` | 按 CAS 查询常用货架分组 | `GET /common-shelf/groups?search=...&search_field=cas_number` |
| `common-shelf alias <keyword>` | 按别名查询常用货架分组 | `GET /common-shelf/groups?search=...&search_field=alias` |
| `common-shelf locations <group_key>` | 查看分组位置统计 | `GET /common-shelf/groups/{group_key}/locations` |
| `common-shelf manual-add` | 手工添加常用货架瓶 | `POST /common-shelf/manual-add` |
| `common-shelf add-bottles <group_key>` | 给分组加瓶 | `POST /common-shelf/groups/{group_key}/add-bottles` |
| `common-shelf remove-one <group_key>` | 从指定位置扣减 1 瓶 | `POST /common-shelf/groups/{group_key}/remove-one` |

### chemical-name-map

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `chemical-name-map list` | 列出 CAS 主数据 | `GET /chemical-name-map` |
| `chemical-name-map search <keyword>` | 按名称、英文名、别名或 CAS 查询 CAS 主数据 | `GET /chemical-name-map?search=...&search_field=all` |
| `chemical-name-map cas <cas_number>` | 按 CAS 精确查询 CAS 主数据 | `GET /chemical-name-map?search=...&search_field=cas_number&match_mode=exact` |

### consumable-orders

| 命令 | 说明 | 对应 API |
| --- | --- | --- |
| `consumable-orders list` | 列出耗材订单 | `GET /consumable-orders/` |
| `consumable-orders get <order_id>` | 查看单条耗材订单 | `GET /consumable-orders/{order_id}` |
| `consumable-orders name <keyword>` | 按名称搜索耗材订单列表 | `GET /consumable-orders/?search=...&search_field=name` |
| `consumable-orders my` | 查看当前用户耗材订单 | `GET /consumable-orders/dashboard/my-consumable-orders` |
| `consumable-orders create` | 新建耗材订单 | `POST /consumable-orders/` |
| `consumable-orders update <order_id>` | 更新耗材订单 | `PUT /consumable-orders/{order_id}` |
| `consumable-orders complete <order_id>` | 完成耗材订单 | `POST /consumable-orders/{order_id}/complete` |

## Query 参数细节

### inventory list

支持：

| 参数 | 说明 |
| --- | --- |
| `skip` | 跳过条数，默认 `0` |
| `limit` | 返回条数，默认 `50`，最大 `100`；传 `0` 时仅返回 `total/skip/limit`，不返回明细 |
| `status_filter` | `not_in_stock` / `in_stock` / `run_short` / `borrowed` / `consumed` |
| `cas_filter` | 按 CAS 精确过滤 |
| `hazardous_only` | `true` / `false` |
| `search` | 搜索词 |
| `search_field` | 指定搜索字段 |
| `fuzzy` | `true` / `false` |
| `sort_by` | 排序字段 |
| `sort_order` | `asc` / `desc` |

说明：

- `inventory list` 不支持按 `inventory_id` 过滤；已知 ID 时请直接使用 `inventory get <inventory_id>`

示例：

```bash
python -m lsm_cli inventory list \
  --param search=乙醇 \
  --param search_field=name \
  --page-size 20 \
  --param sort_by=created_at \
  --param sort_order=desc
```

只看命中总数：

```bash
python -m lsm_cli inventory list --summary --param search=苯胺
```

### reagent-orders list

支持：

| 参数 | 说明 |
| --- | --- |
| `skip` | 跳过条数 |
| `limit` | 返回条数，默认 `50`，最大 `100`；传 `0` 时仅返回 `total/skip/limit`，不返回明细 |
| `status_filter` | `pending` / `approved` / `arrived` / `stocked` / `rejected` |
| `search` | 搜索词 |
| `search_field` | 搜索字段 |
| `fuzzy` | `true` / `false` |
| `sort_by` | 排序字段 |
| `sort_order` | `asc` / `desc` |

### consumable-orders list

支持：

| 参数 | 说明 |
| --- | --- |
| `skip` | 跳过条数 |
| `limit` | 返回条数，默认 `50`，最大 `100`；传 `0` 时仅返回 `total/skip/limit`，不返回明细 |
| `status_filter` | `pending` / `approved` / `rejected` / `completed` |
| `search` | 搜索词 |
| `search_field` | 搜索字段 |
| `fuzzy` | `true` / `false` |
| `sort_by` | 排序字段 |
| `sort_order` | `asc` / `desc` |

### common-shelf list

支持：

| 参数 | 说明 |
| --- | --- |
| `skip` | 跳过条数 |
| `limit` | 返回条数，默认 `50`，最大 `100`；传 `0` 时仅返回 `total/skip/limit` |
| `search` | 搜索词 |
| `search_field` | `name` / `alias` / `cas_number` / `brand` / `all` |
| `fuzzy` | `true` / `false` |
| `match_mode` | 文本匹配模式 |
| `sort_by` | `cas_number` / `name` / `category` / `brand` / `specification` / `bottle_count` / `location_count` / `created_at` / `updated_at` |
| `sort_order` | `asc` / `desc` |

说明：

- `common-shelf list` 返回的 `group.group_key` 是 `add-bottles`、`remove-one` 和 `locations` 的目标参数。
- `common-shelf locations <group_key>` 可在扣减前确认该分组下有哪些位置和各位置瓶数。
- 常用 CAS 或别名查询可直接用 `common-shelf cas <cas_number>` 和 `common-shelf alias <keyword>`，它们仍然只调用分组查询接口。

## 请求体参数

### inventory borrow

对应模型：`InventoryBorrowRequest`

参数模式：

```bash
python -m lsm_cli inventory borrow 123
```

`borrow` 每次只借用一个 `inventory_id`，不会按名称、CAS、
搜索结果或逗号列表批量借用。

### inventory return

对应模型：`InventoryBorrowReturn`

```json
{
  "remaining_quantity": 320
}
```

CLI 也支持快捷参数：

```bash
python -m lsm_cli inventory return 123 --used-quantity 20
```

该模式会先读取当前库存的剩余量，在本地换算成
`remaining_quantity` 后再调用原接口。

`return` 不接受单位参数，也不接受 JSON payload 里的
`unit` 字段；归还时强制沿用现有库存规格单位。

`--used-quantity` 与 `--data-json` / `--data-file`
互斥。

也可以直接传最终剩余量：

```bash
python -m lsm_cli inventory return 123 --remaining-quantity 320
```

### inventory manual-add

对应模型：`ManualInventoryCreate`

```json
{
  "cas_number": "64-17-5",
  "name": "乙醇",
  "english_name": "Ethanol",
  "alias": null,
  "category": "醇",
  "brand": "国药",
  "purity": "AR",
  "storage_location": "A-01",
  "specification": "500ml",
  "quantity_bottles": 2,
  "is_hazardous": true,
  "notes": "新购入"
}
```

### inventory update

对应模型：`InventoryUpdate`

```json
{
  "name": "无水乙醇",
  "cas_number": "64-17-5",
  "storage_location": "A-02",
  "remaining_quantity": 280,
  "notes": "转移货架",
  "english_name": "Ethanol",
  "alias": null,
  "category": "醇",
  "brand": "国药",
  "purity": "AR",
  "is_hazardous": true,
  "specification": "500ml"
}
```

参数模式示例：

```bash
python -m lsm_cli inventory update 123 \
  --storage-location A-02 \
  --remaining-quantity 280 \
  --notes "转移货架"
```

`update` 每次只更新一个 `inventory_id`，且只提交显式传入的字段。

### common-shelf manual-add

对应模型：`CommonShelfManualCreate`

```json
{
  "cas_number": "64-17-5",
  "name_snapshot": "乙醇",
  "brand": "国药",
  "purity": "AR",
  "specification": "500ml",
  "count": 2,
  "storage_location": "A-01",
  "notes": "常用货架补充"
}
```

示例：

```bash
python -m lsm_cli common-shelf manual-add --data-file common-shelf.json
```

### common-shelf add-bottles

对应模型：`CommonShelfAddBottlesRequest`

参数模式：

```bash
python -m lsm_cli common-shelf add-bottles <group_key> \
  --count 2 \
  --storage-location A-02 \
  --purity AR \
  --notes "补充常用瓶"
```

也支持 JSON object 负载：

```json
{
  "count": 2,
  "storage_location": "A-02",
  "purity": "AR",
  "notes": "补充常用瓶"
}
```

`group_key` 来自 `common-shelf list` 返回的 `group.group_key`。

### common-shelf remove-one

对应模型：`CommonShelfRemoveOneRequest`

参数模式：

```bash
python -m lsm_cli common-shelf remove-one <group_key> \
  --storage-location A-02
```

省略 `--storage-location` 时，扣减该分组中未填写位置的最早一瓶。

也支持 JSON object 负载：

```json
{
  "storage_location": "A-02"
}
```

建议先执行 `common-shelf locations <group_key>`，确认目标位置和瓶数后再扣减。

### reagent-orders create

对应模型：`ReagentOrderCreate`

```json
{
  "cas_number": "64-17-5",
  "name": "乙醇",
  "english_name": "Ethanol",
  "alias": null,
  "category": "醇",
  "brand": "国药",
  "purity": "AR",
  "specification": "500ml",
  "quantity": 2,
  "price": 120.5,
  "order_reason": "running_out",
  "is_hazardous": true,
  "notes": "教学实验使用"
}
```

### reagent-orders update

参数模式示例：

```bash
python -m lsm_cli reagent-orders update 18 \
  --price 199 \
  --brand 国药 \
  --order-reason reorder
```

### reagent-orders confirm-arrival

参数模式示例：

```bash
python -m lsm_cli reagent-orders confirm-arrival 18 \
  --arrival-notes "已到货" \
  --storage-location B-01
```

### reagent-orders stock-in

参数模式示例：

```bash
python -m lsm_cli reagent-orders stock-in 18 \
  --storage-location B-01 \
  --remaining-quantity 450
```

### consumable-orders update

参数模式示例：

```bash
python -m lsm_cli consumable-orders update 9 \
  --quantity 3 \
  --notes "改成三盒"
```

对应模型：`ConsumableOrderUpdate`

```json
{
  "name": "一次性手套",
  "english_name": "Disposable Gloves",
  "product_number": "DG-100",
  "specification": "100只/盒",
  "unit": "盒",
  "quantity": 3,
  "price": 45.0,
  "communication": "优先同品牌",
  "notes": "备注"
}
```

### reagent-orders confirm-arrival

对应模型：`ConfirmArrivalRequest`

```json
{
  "arrival_notes": "已签收",
  "storage_location": "A-01"
}
```

### reagent-orders stock-in

对应模型：`StockInRequest`

```json
{
  "storage_location": "A-01",
  "remaining_quantity": 500
}
```

### consumable-orders create

对应模型：`ConsumableOrderCreate`

```json
{
  "name": "手套",
  "english_name": "Gloves",
  "product_number": "GL-001",
  "specification": "M",
  "unit": "盒",
  "quantity": 3,
  "price": 45.0,
  "communication": "优先现货",
  "notes": "实验课使用"
}
```

### consumable-orders update

对应模型：`ConsumableOrderUpdate`

```json
{
  "name": "手套",
  "english_name": "Gloves",
  "product_number": "GL-001",
  "specification": "M",
  "unit": "盒",
  "quantity": 3,
  "price": 45.0,
  "communication": "优先现货",
  "notes": "更新备注"
}
```

### consumable-orders complete

该命令不接受 `--data-json` 或 `--data-file`。

## 常见示例

### 登录

```bash
Get-Content .\password.txt | python -m lsm_cli auth login --username alice --password-stdin
```

### 查看当前登录用户

```bash
python -m lsm_cli auth whoami
```

### 查看某个库存是谁借的

```bash
python -m lsm_cli inventory get 123
```

看返回里的 `borrower_name`、`last_borrower_name` 即可，不需要额外查用户接口。

### 查询自己的借用

```bash
python -m lsm_cli inventory my-borrows
```

### 新建试剂订单

```bash
python -m lsm_cli reagent-orders create --data-file reagent-order.json
```

### 完成耗材订单

```bash
python -m lsm_cli consumable-orders complete 42
```

## 常见错误

### 参数格式错误

```bash
python -m lsm_cli inventory list --param bad
```

结果：退出码 `7`

### 缺少子命令

```bash
python -m lsm_cli auth
```

结果：退出码 `8`

### 服务不可达

```bash
python -m lsm_cli auth whoami --base-url http://127.0.0.1:9/api
```

结果：退出码 `9`

### 同时使用 `--data-json` 和 `--data-file`

结果：退出码 `7`

## 明确不支持的能力

即使后端有 API，CLI 也不会开放这些能力：

- 所有 `delete`
- 所有 `export`
- 常用货架分组编辑、条目编辑、删除、导出
- CAS 主数据管理
- 文件上传
- 用户资料修改、用户名修改、密码修改、头像相关
- 用户管理、会话管理
- 任何未出现在本 README 命令列表中的接口
