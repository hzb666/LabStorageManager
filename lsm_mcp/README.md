# LabStorageManager MCP

`lsm_mcp` exposes a controlled MCP tool surface over `python -m lsm_cli`.
The MCP server must stay aligned with the CLI command surface and the WeCom robot flows.

## Run

```powershell
$env:LSM_MCP_BASE_URL="http://127.0.0.1:8000/api"
$env:LSM_MCP_CLI_TIMEOUT="5"
poetry run uvicorn lsm_mcp.http_app:app --host 127.0.0.1 --port 8030
```

## Help Tool

Call `lab_storage_manager_help` to inspect exposed tools, mapped CLI commands, and robot usage notes.
It accepts optional `topic` and `user_token` arguments. `user_token` is ignored by the help tool but
accepted so LLM planners can pass the same bound-user argument shape used by business tools.

## Alignment Table

| MCP tool | CLI command | Robot usage | Write |
| --- | --- | --- | --- |
| `lab_storage_manager_help` | n/a | 工具目录查询 | No |
| `auth_login` | `auth login --username <username> --password-stdin` | 私聊绑定账号 | No |
| `inventory_search_by_name` | `inventory name <keyword>` | 名称库存查询 | No |
| `inventory_get_by_cas` | `inventory cas <cas_number>` | CAS 库存查询 | No |
| `inventory_get_by_id` | `inventory get <inventory_id>` | 候选详情确认 | No |
| `inventory_list_low_stock` | `inventory list --param status_filter=run_short` | 低库存查询 | No |
| `inventory_my_borrows` | `inventory my-borrows` | 本人借用查询 | No |
| `inventory_borrow` | `inventory borrow <inventory_id>` | 借用，必须确认 | Yes |
| `inventory_return` | `inventory return <inventory_id>` | 归还，必须确认 | Yes |
| `reagent_orders_search_by_name` | `reagent-orders name <keyword>` | 试剂订单查询 | No |
| `reagent_orders_search_by_cas` | `reagent-orders cas <cas_number>` | 试剂订单 CAS 查询 | No |
| `reagent_orders_get_cas_overview` | `reagent-orders cas-overview <cas_number>` | 试剂 CAS 概览 | No |
| `consumable_orders_search_by_name` | `consumable-orders name <keyword>` | 耗材订单查询 | No |
| `common_shelf_search_by_alias` | `common-shelf alias <keyword>` | 常用货架查询 | No |
| `common_shelf_search_by_cas` | `common-shelf cas <cas_number>` | 常用货架 CAS 查询 | No |
| `chemical_name_map_search` | `chemical-name-map search <keyword>` | 库存为空时辅助判断常用货架 | No |
| `chemical_name_map_search_by_cas` | `chemical-name-map cas <cas_number>` | CAS 库存为空时辅助判断常用货架 | No |

Business tools except `auth_login` and `lab_storage_manager_help` require a bound user's
LabStorageManager token. Internal code lookup is intentionally not exposed to the WeCom robot.
