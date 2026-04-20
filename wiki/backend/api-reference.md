# API 参考

> 本页按 `app/main.py` 的实际挂载结果和各路由文件的装饰器整理，覆盖 `app/main.py`、`app/api/*.py`、`app/services/chemical_info.py`，用于快速定位主要运行路由。

## 路由挂载

- `announcements.router` -> `/api`
- `cart_sync.router` -> `/api`
- `chem.router` -> `/api`
- `chemical_info.router` -> `/api`
- `chemical_name_map.router` -> `/api`
- `common_shelf.router` -> `/api`
- `consumable_orders.router` -> `/api`
- `error_logs.router` -> `/api`
- `events.router` -> `/api`
- `inventory.router` -> `/api`
- `reagent_orders.router` -> `/api`
- `user_logs.router` -> `/api`
- `user_sessions.router` -> `/api/users/me`
- `users.router` -> `/api`
- `inventory_extended_routes` 通过 `register_*` 动态挂到 `inventory.router`，最终前缀为 `/api/inventory`。
- `reagent_orders_workflow` 通过 `register_*` 动态挂到 `reagent_orders.router`，最终前缀为 `/api/reagent-orders`。

## 权限判定

- `管理员`：路由依赖 `require_admin` 或参数类型为 `AdminUser`。
- `已登录用户`：路由依赖 `get_current_user` / `get_current_session` 或参数类型为 `CurrentUser`。
- `公开`：无上述依赖。
- `POST /api/users/logout` 为公开接口，但实现会校验当前会话 Cookie/Token 后执行退出。

## 路由清单

### 应用级路由 (`main`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/` | `root` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L370" /> |
| `GET` | `/cart-import` | `cart_import_redirect` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L396" /> |
| `GET` | `/health` | `health_check` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L382" /> |
| `GET` | `/robots.txt` | `robots_txt` | 公开 | — | `PlainTextResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |
| `GET` | `/api/runtime/cache-version` | `get_runtime_cache_version` | 公开 | — | `dict[str, str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |

### 用户与认证 (`users`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/users/` | `list_users` | 管理员 | query: `username`；query: `full_name` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L480" /> |
| `POST` | `/api/users/` | `create_user` | 管理员 | body: `UserCreate` | `UserResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L447" /> |
| `POST` | `/api/users/change-password` | `change_password` | 已登录用户 | body: `ChangePasswordRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L410" /> |
| `POST` | `/api/users/login` | `login` | 公开 | body: `LoginRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L211" /> |
| `POST` | `/api/users/login/token` | `login_cli_token` | 公开 | body: `LoginRequest` | `CLILoginResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/logout` | `logout` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L365" /> |
| `GET` | `/api/users/me` | `get_me` | 已登录用户 | — | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L607" /> |
| `GET` | `/api/users/search` | `search_users` | 已登录用户 | query: `q` | `list[UserSearchItem]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L579" /> |
| `DELETE` | `/api/users/{user_id}` | `delete_user` | 管理员 | path: `user_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L768" /> |
| `GET` | `/api/users/{user_id}` | `get_user` | 已登录用户 | path: `user_id` | `PublicUserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L613" /> |
| `PUT` | `/api/users/{user_id}` | `update_user` | 已登录用户 | path: `user_id`；body: `UserUpdate` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L628" /> |
| `POST` | `/api/users/{user_id}/activate` | `activate_user` | 管理员 | path: `user_id` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L732" /> |
| `DELETE` | `/api/users/{user_id}/avatar` | `delete_avatar` | 已登录用户 | path: `user_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L922" /> |
| `POST` | `/api/users/{user_id}/avatar` | `upload_avatar` | 已登录用户 | path: `user_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L958" /> |
| `POST` | `/api/users/{user_id}/reset-password` | `reset_user_password` | 管理员 | path: `user_id`；body: `ResetPasswordRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L858" /> |
| `PUT` | `/api/users/{user_id}/role` | `update_user_role` | 管理员 | path: `user_id` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L812" /> |

### 会话与设备 (`user_sessions`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DELETE` | `/api/users/me/sessions/` | `delete_all_sessions` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py#L92" /> |
| `GET` | `/api/users/me/sessions/` | `list_sessions` | 已登录用户 | — | `List[SessionResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py#L43" /> |
| `POST` | `/api/users/me/sessions/refresh` | `refresh_session` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py#L119" /> |
| `DELETE` | `/api/users/me/sessions/{session_id}` | `delete_session` | 已登录用户 | path: `session_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py#L60" /> |
| `PATCH` | `/api/users/me/sessions/{session_id}` | `update_session` | 已登录用户 | path: `session_id`；body: `SessionUpdateRequest` | `SessionResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py#L174" /> |

### 管理员用户日志 (`user_logs`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/api/admin/users/logs/query` | `get_user_logs` | 管理员 | body: `LogsQueryRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py#L162" /> |
| `POST` | `/api/admin/users/{user_id}/logs-token` | `generate_logs_token` | 管理员 | path: `user_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py#L132" /> |

### 库存基础接口 (`inventory`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/inventory/` | `list_inventory` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L379" /> |
| `DELETE` | `/api/inventory/{inventory_id}` | `delete_inventory` | 已登录用户 | path: `inventory_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L549" /> |
| `GET` | `/api/inventory/{inventory_id}` | `get_inventory` | 已登录用户 | path: `inventory_id` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L460" /> |
| `PUT` | `/api/inventory/{inventory_id}` | `update_inventory` | 已登录用户 | path: `inventory_id`；body: `InventoryUpdate` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L469" /> |

### 库存扩展接口 (`inventory_extended_routes`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/inventory/cas/{cas_number}` | `check_cas_inventory` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L99" /> |
| `GET` | `/api/inventory/cas/{cas_number}/total` | `get_cas_total_quantity` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L140" /> |
| `GET` | `/api/inventory/code/{internal_code}` | `get_inventory_by_internal_code` | 已登录用户 | path: `internal_code` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L163" /> |
| `GET` | `/api/inventory/dashboard/my-borrows` | `get_my_borrows` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L214" /> |
| `GET` | `/api/inventory/dashboard/pending-stockin` | `get_pending_stockin` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L277" /> |
| `GET` | `/api/inventory/export` | `export_inventory` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L171" /> |
| `POST` | `/api/inventory/import/preview` | `preview_inventory_import` | 已登录用户 | file: `file` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/import/confirm` | `confirm_inventory_import` | 已登录用户 | body: `preview_token` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/import/template` | `get_import_template` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L312" /> |
| `POST` | `/api/inventory/manual-add` | `manual_add_inventory` | 已登录用户 | body: `ManualInventoryCreate` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L187" /> |
| `POST` | `/api/inventory/{inventory_id}/borrow` | `borrow_item` | 已登录用户 | path: `inventory_id` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L392" /> |
| `GET` | `/api/inventory/{inventory_id}/borrow-history` | `get_borrow_history` | 已登录用户 | path: `inventory_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L559" /> |
| `POST` | `/api/inventory/{inventory_id}/return` | `return_item` | 已登录用户 | path: `inventory_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py#L476" /> |

### 常用货架接口 (`common_shelf`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/common-shelf/groups` | `list_common_shelf_groups` | 已登录用户 | query: `search`、`search_field`、`fuzzy`、`sort_by`、`sort_order` | `CommonShelfGroupListResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L131" /> |
| `POST` | `/api/common-shelf/manual-add` | `manual_add_common_shelf` | 已登录用户 | body: `CommonShelfManualCreate` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L206" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/locations` | `get_common_shelf_group_locations` | 已登录用户 | path: `group_key` | `list[CommonShelfLocationSummaryResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L155" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/location-suggestions` | `get_common_shelf_group_location_suggestions` | 已登录用户 | path: `group_key` | `list[str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L164" /> |
| `GET` | `/api/common-shelf/location-suggestions` | `get_common_shelf_location_suggestions_by_fields` | 已登录用户 | query: `cas_number`、`brand`、`specification` | `list[str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L169" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/items` | `get_common_shelf_group_items` | 已登录用户 | path: `group_key` | `list[CommonShelfGroupItemResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L187" /> |
| `PUT` | `/api/common-shelf/groups/{group_key}` | `update_common_shelf_group` | 已登录用户 | path: `group_key`；body: `CommonShelfGroupEditRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L229" /> |
| `PUT` | `/api/common-shelf/groups/{group_key}/items/{item_id}` | `update_common_shelf_item` | 已登录用户 | path: `group_key`、`item_id`；body: `CommonShelfGroupItemUpdateRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L312" /> |
| `POST` | `/api/common-shelf/groups/{group_key}/add-bottles` | `add_common_shelf_bottles` | 已登录用户 | path: `group_key`；body: `CommonShelfAddBottlesRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L357" /> |
| `POST` | `/api/common-shelf/groups/{group_key}/remove-one` | `remove_one_common_shelf` | 已登录用户 | path: `group_key`；body: `CommonShelfRemoveOneRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L399" /> |
| `DELETE` | `/api/common-shelf/groups/{group_key}/items/{item_id}` | `delete_common_shelf_item` | 已登录用户 | path: `group_key`、`item_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L439" /> |
| `DELETE` | `/api/common-shelf/groups/{group_key}` | `delete_common_shelf_group` | 管理员 | path: `group_key` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L473" /> |
| `GET` | `/api/common-shelf/export` | `export_common_shelf` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py#L506" /> |

### CAS 主数据接口 (`chemical_name_map`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chemical-name-map` | `list_chemical_name_map` | 已登录用户 | query: `search`、`search_field`、`fuzzy`、`skip`、`limit` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py#L85" /> |
| `POST` | `/api/chemical-name-map` | `create_chemical_name_map` | 已登录用户 | body: `ChemicalNameMapCreate` | `ChemicalNameMapResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py#L123" /> |
| `PUT` | `/api/chemical-name-map/{item_id}` | `update_chemical_name_map` | 已登录用户 | path: `item_id`；body: `ChemicalNameMapUpdate` | `ChemicalNameMapResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py#L149" /> |
| `DELETE` | `/api/chemical-name-map/{item_id}` | `delete_chemical_name_map` | 已登录用户 | path: `item_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py#L173" /> |

### 试剂订单基础接口 (`reagent_orders`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/reagent-orders/` | `list_reagent_orders` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L351" /> |
| `POST` | `/api/reagent-orders/` | `create_reagent_order` | 已登录用户 | body: `ReagentOrderCreate` | `ReagentOrderResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L275" /> |
| `GET` | `/api/reagent-orders/cas-overview/{cas_number}` | `get_cas_overview` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L489" /> |
| `GET` | `/api/reagent-orders/export` | `export_reagent_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L472" /> |
| `GET` | `/api/reagent-orders/{order_id}` | `get_reagent_order` | 已登录用户 | path: `order_id` | `ReagentOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L599" /> |
| `PUT` | `/api/reagent-orders/{order_id}` | `update_reagent_order` | 已登录用户 | path: `order_id`；body: `ReagentOrderUpdate` | `ReagentOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L614" /> |

### 试剂订单工作流接口 (`reagent_orders_workflow`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/reagent-orders/dashboard/arrived-orders` | `get_arrived_reagent_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L272" /> |
| `GET` | `/api/reagent-orders/dashboard/my-reagent-orders` | `get_my_reagent_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L299" /> |
| `DELETE` | `/api/reagent-orders/{order_id}` | `delete_reagent_order` | 已登录用户 | path: `order_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L361" /> |
| `POST` | `/api/reagent-orders/{order_id}/approve` | `approve_reagent_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L129" /> |
| `POST` | `/api/reagent-orders/{order_id}/confirm-arrival` | `confirm_reagent_arrival` | 已登录用户 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L184" /> |
| `POST` | `/api/reagent-orders/{order_id}/reject` | `reject_reagent_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L154" /> |
| `POST` | `/api/reagent-orders/{order_id}/stock-in` | `stock_in_reagent_order` | 已登录用户 | path: `order_id`；body: `StockInRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L387" /> |

### 耗材订单接口 (`consumable_orders`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/consumable-orders/` | `list_consumable_orders` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L244" /> |
| `POST` | `/api/consumable-orders/` | `create_consumable_order` | 已登录用户 | body: `ConsumableOrderCreate` | `ConsumableOrderResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L203" /> |
| `GET` | `/api/consumable-orders/dashboard/my-consumable-orders` | `get_my_consumable_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L572" /> |
| `GET` | `/api/consumable-orders/export` | `export_consumable_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L356" /> |
| `DELETE` | `/api/consumable-orders/{order_id}` | `delete_consumable_order` | 已登录用户 | path: `order_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L627" /> |
| `GET` | `/api/consumable-orders/{order_id}` | `get_consumable_order` | 已登录用户 | path: `order_id` | `ConsumableOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L373" /> |
| `PUT` | `/api/consumable-orders/{order_id}` | `update_consumable_order` | 已登录用户 | path: `order_id`；body: `ConsumableOrderUpdate` | `ConsumableOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L388" /> |
| `POST` | `/api/consumable-orders/{order_id}/approve` | `approve_consumable_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L463" /> |
| `POST` | `/api/consumable-orders/{order_id}/complete` | `complete_consumable_order` | 已登录用户 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L523" /> |
| `POST` | `/api/consumable-orders/{order_id}/reject` | `reject_consumable_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L496" /> |

### 公告接口 (`announcements`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/announcements/` | `list_announcements` | 管理员 | — | `List[AnnouncementResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L93" /> |
| `POST` | `/api/announcements/` | `create_announcement` | 管理员 | body: `AnnouncementCreate` | `AnnouncementResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L130" /> |
| `DELETE` | `/api/announcements/images/{filename}` | `delete_announcement_image` | 管理员 | path: `filename` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L330" /> |
| `GET` | `/api/announcements/public` | `get_public_announcements` | 已登录用户 | — | `List[AnnouncementResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L52" /> |
| `GET` | `/api/announcements/storage-info` | `get_storage_info` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L81" /> |
| `POST` | `/api/announcements/upload-image` | `upload_announcement_image` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L300" /> |
| `DELETE` | `/api/announcements/{announcement_id}` | `delete_announcement` | 管理员 | path: `announcement_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L224" /> |
| `GET` | `/api/announcements/{announcement_id}` | `get_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L177" /> |
| `PUT` | `/api/announcements/{announcement_id}` | `update_announcement` | 管理员 | path: `announcement_id`；body: `AnnouncementUpdate` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L194" /> |
| `POST` | `/api/announcements/{announcement_id}/toggle-pin` | `toggle_pin_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L252" /> |
| `POST` | `/api/announcements/{announcement_id}/toggle-visibility` | `toggle_visibility_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py#L276" /> |

### SSE 事件接口 (`events`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/events` | `sse_events` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py#L57" /> |

### 错误日志接口 (`error_logs`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/error-logs` | `get_error_logs` | 已登录用户 | query: `hours`；query: `lines` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py#L34" /> |

### 购物车同步接口 (`cart_sync`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/api/cart-sync` | `sync_cart` | 已登录用户 | body: `CartItemRequest` | `CartSyncResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py#L138" /> |

### 化学信息接口 (`chemical_info`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chemical-info/{cas_number}` | `get_chemical_info` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py#L442" /> |

### 化学结构接口 (`chem`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chem/index/status` | `get_structure_index_status` | 已登录用户 | — | `StructureIndexStatusResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/index/rebuild` | `rebuild_structure_index` | 管理员 | — | `StructureIndexStatusResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `GET` | `/api/chem/structures/cache/{cas_number}` | `get_structure_cache_status` | 已登录用户 | path: `cas_number` | `CompoundStructureCacheResponse or None` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/structures/resolve-cas` | `resolve_structure_cas` | 管理员 | body: `ResolveCasRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `PUT` | `/api/chem/structures/cache/{cas_number}/manual` | `save_manual_structure` | 管理员 | path: `cas_number`；body: `ManualStructureRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/structures/cache/{cas_number}/confirm-pubchem` | `confirm_pubchem_candidate` | 管理员 | path: `cas_number`；body: `ConfirmPubChemCidRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/search/substructure` | `search_substructure` | 已登录用户 | body: `SubstructureSearchRequest` | `SubstructureSearchResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |

## 二次开发建议

- 新增 API 时，优先沿用现有依赖模式（`CurrentUser` / `AdminUser`），避免权限漂移。
- 新增 `/api/inventory/*` 或 `/api/reagent-orders/*` 路径时，先确认命名路由优先级，避免被 `/{id}` 路由吞掉。
- 新增列表筛选条件时，需要同步评估索引、缓存 Key、FTS 字段和前端查询参数。

## 参考代码
- [app/api/announcements.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py)（行52，81，93，130，177，194，224，252，276，300，330）
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)（行138，170）
- [app/api/chem.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py)
- [app/api/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py)（行591，679，757，783，862，895）
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)（行203，244，356，373，388，463，496，523，572，627）
- [app/api/error_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py)（行34）
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)（行57）
- [app/api/inventory_extended_routes.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py)（行99，140，163，171，187，214，277，312，333，392，476，559）
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)（行379，460，469，549）
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)（行129，154，184，272，299，361，387）
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)（行275，351，472，489，599，614）
- [app/api/user_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py)（行132，162）
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py)（行43，60，92，119，174）
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)（行211，365，410，447，480，579，607，613，628，732，768，812，858，922，958）
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)（行370，382，396）
- [app/services/chemical_info.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py)（行442）

