# API 参考

> 本页按运行时 OpenAPI 结果整理，覆盖当前应用暴露的主要运行路由；页面保留静态索引格式，便于快速定位接口与实现文件。

## 路由挂载

- `announcements.router` -> `/api`
- `cart_sync.router` -> `/api`
- `chem.router` -> `/api`
- `chemical_info.router` -> `/api`
- `chemical_name_map.router` -> `/api`
- `common_shelf.router` -> `/api`
- `consumable_orders.router` -> `/api`
- `dashboard.router` -> `/api`
- `error_logs.router` -> `/api`
- `events.router` -> `/api`
- `inventory.router` -> `/api`
- `reagent_brands.router` -> `/api`
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
| `GET` | `/` | `root` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |
| `GET` | `/cart-import` | `cart_import_redirect` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |
| `GET` | `/health` | `health_check` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |
| `GET` | `/robots.txt` | `robots_txt` | 公开 | — | `PlainTextResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |
| `GET` | `/api/runtime/cache-version` | `get_runtime_cache_version` | 公开 | — | `dict[str, str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> |

### 用户与认证 (`users`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/users/` | `list_users` | 管理员 | query: `username`；query: `full_name` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/` | `create_user` | 管理员 | body: `UserCreate` | `UserResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/change-password` | `change_password` | 已登录用户 | body: `ChangePasswordRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/login` | `login` | 公开 | body: `LoginRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/login/token` | `login_cli_token` | 公开 | body: `LoginRequest` | `CLILoginResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/logout` | `logout` | 公开 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `GET` | `/api/users/me` | `get_me` | 已登录用户 | — | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `GET` | `/api/users/search` | `search_users` | 已登录用户 | query: `q` | `list[UserSearchItem]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `DELETE` | `/api/users/{user_id}` | `delete_user` | 管理员 | path: `user_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `GET` | `/api/users/{user_id}` | `get_user` | 已登录用户 | path: `user_id` | `PublicUserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `PUT` | `/api/users/{user_id}` | `update_user` | 已登录用户 | path: `user_id`；body: `UserUpdate` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/{user_id}/activate` | `activate_user` | 管理员 | path: `user_id` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `DELETE` | `/api/users/{user_id}/avatar` | `delete_avatar` | 已登录用户 | path: `user_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/{user_id}/avatar` | `upload_avatar` | 已登录用户 | path: `user_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `POST` | `/api/users/{user_id}/reset-password` | `reset_user_password` | 管理员 | path: `user_id`；body: `ResetPasswordRequest` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |
| `PUT` | `/api/users/{user_id}/role` | `update_user_role` | 管理员 | path: `user_id` | `UserResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> |

### 会话与设备 (`user_sessions`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DELETE` | `/api/users/me/sessions/` | `delete_all_sessions` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> |
| `GET` | `/api/users/me/sessions/` | `list_sessions` | 已登录用户 | — | `List[SessionResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> |
| `POST` | `/api/users/me/sessions/refresh` | `refresh_session` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> |
| `DELETE` | `/api/users/me/sessions/{session_id}` | `delete_session` | 已登录用户 | path: `session_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> |
| `PATCH` | `/api/users/me/sessions/{session_id}` | `update_session` | 已登录用户 | path: `session_id`；body: `SessionUpdateRequest` | `SessionResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> |

### 管理员用户日志 (`user_logs`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/api/admin/users/logs/query` | `get_user_logs` | 管理员 | body: `LogsQueryRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py" /> |
| `POST` | `/api/admin/users/{user_id}/logs-token` | `generate_logs_token` | 管理员 | path: `user_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py" /> |

### 仪表盘聚合接口 (`dashboard`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/dashboard/board/summary` | `get_dashboard_board_summary` | 已登录用户 | — | `DashboardBoardSummaryEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |
| `GET` | `/api/dashboard/board/sections/{section}` | `get_dashboard_board_section_items` | 已登录用户 | path: `section`；query: `skip`；query: `limit` | `DashboardSectionItemsEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |
| `GET` | `/api/dashboard/board/summary/window-stats` | `get_dashboard_board_window_stats` | 已登录用户 | query: `window_days`；query: `all_time` | `DashboardWindowStatsEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |
| `GET` | `/api/dashboard/admin/summary` | `get_admin_dashboard_summary` | 管理员 | — | `DashboardAdminSummaryEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |
| `GET` | `/api/dashboard/admin/sections/{section}` | `get_admin_dashboard_section_items` | 管理员 | path: `section`；query: `skip`；query: `limit` | `DashboardSectionItemsEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |
| `GET` | `/api/dashboard/admin/summary/window-stats` | `get_admin_dashboard_window_stats` | 管理员 | query: `window_days`；query: `all_time` | `DashboardWindowStatsEnvelope` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py" /> |

### 库存基础接口 (`inventory`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/inventory/` | `list_inventory` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> |
| `DELETE` | `/api/inventory/{inventory_id}` | `delete_inventory` | 非公用账号 | path: `inventory_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> |
| `GET` | `/api/inventory/{inventory_id}` | `get_inventory` | 已登录用户 | path: `inventory_id` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> |
| `PUT` | `/api/inventory/{inventory_id}` | `update_inventory` | 已登录用户 | path: `inventory_id`；body: `InventoryUpdate` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> |

### 库存扩展接口 (`inventory_extended_routes`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/inventory/cas/{cas_number}` | `check_cas_inventory` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/cas/{cas_number}/total` | `get_cas_total_quantity` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/code/{internal_code}` | `get_inventory_by_internal_code` | 已登录用户 | path: `internal_code` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/dashboard/my-borrows` | `get_my_borrows` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/dashboard/admin/borrows` | `get_admin_borrows` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/dashboard/pending-stockin` | `get_pending_stockin` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/dashboard/admin/pending-stockin` | `get_admin_pending_stockin` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/export` | `export_inventory` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/import/preview` | `preview_inventory_import` | 非公用账号 | file: `file` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/import/confirm` | `confirm_inventory_import` | 非公用账号 | body: `preview_token` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/import/template` | `get_import_template` | 非公用账号 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/manual-add` | `manual_add_inventory` | 非公用账号 | body: `ManualInventoryCreate` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/{inventory_id}/borrow` | `borrow_item` | 已登录用户 | path: `inventory_id` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `GET` | `/api/inventory/{inventory_id}/borrow-history` | `get_borrow_history` | 已登录用户 | path: `inventory_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/{inventory_id}/complete-stockin` | `complete_manual_pending_stockin` | 已登录用户 | path: `inventory_id`；body: `ManualPendingStockInRequest` | `InventoryResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |
| `POST` | `/api/inventory/{inventory_id}/return` | `return_item` | 已登录用户 | path: `inventory_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> |

### 常用货架接口 (`common_shelf`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/common-shelf/groups` | `list_common_shelf_groups` | 已登录用户 | query: `search`、`search_field`、`fuzzy`、`sort_by`、`sort_order` | `CommonShelfGroupListResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `POST` | `/api/common-shelf/manual-add` | `manual_add_common_shelf` | 已登录用户 | body: `CommonShelfManualCreate` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/locations` | `get_common_shelf_group_locations` | 已登录用户 | path: `group_key` | `list[CommonShelfLocationSummaryResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/location-suggestions` | `get_common_shelf_group_location_suggestions` | 已登录用户 | path: `group_key` | `list[str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `GET` | `/api/common-shelf/location-suggestions` | `get_common_shelf_location_suggestions_by_fields` | 已登录用户 | query: `cas_number`、`brand`、`specification` | `list[str]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `GET` | `/api/common-shelf/groups/{group_key}/items` | `get_common_shelf_group_items` | 已登录用户 | path: `group_key` | `list[CommonShelfGroupItemResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `PUT` | `/api/common-shelf/groups/{group_key}` | `update_common_shelf_group` | 已登录用户 | path: `group_key`；body: `CommonShelfGroupEditRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `PUT` | `/api/common-shelf/groups/{group_key}/items/{item_id}` | `update_common_shelf_item` | 已登录用户 | path: `group_key`、`item_id`；body: `CommonShelfGroupItemUpdateRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `POST` | `/api/common-shelf/groups/{group_key}/add-bottles` | `add_common_shelf_bottles` | 已登录用户 | path: `group_key`；body: `CommonShelfAddBottlesRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `POST` | `/api/common-shelf/groups/{group_key}/remove-one` | `remove_one_common_shelf` | 已登录用户 | path: `group_key`；body: `CommonShelfRemoveOneRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `DELETE` | `/api/common-shelf/groups/{group_key}/items/{item_id}` | `delete_common_shelf_item` | 已登录用户 | path: `group_key`、`item_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `DELETE` | `/api/common-shelf/groups/{group_key}` | `delete_common_shelf_group` | 管理员 | path: `group_key` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |
| `GET` | `/api/common-shelf/export` | `export_common_shelf` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" /> |

### CAS 主数据接口 (`chemical_name_map`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chemical-name-map` | `list_chemical_name_map` | 已登录用户 | query: `search`、`search_field`、`fuzzy`、`skip`、`limit` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py" /> |
| `POST` | `/api/chemical-name-map` | `create_chemical_name_map` | 已登录用户 | body: `ChemicalNameMapCreate` | `ChemicalNameMapResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py" /> |
| `PUT` | `/api/chemical-name-map/{item_id}` | `update_chemical_name_map` | 已登录用户 | path: `item_id`；body: `ChemicalNameMapUpdate` | `ChemicalNameMapResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py" /> |
| `DELETE` | `/api/chemical-name-map/{item_id}` | `delete_chemical_name_map` | 已登录用户 | path: `item_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py" /> |

### 试剂品牌接口 (`reagent_brands`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/reagent-brands` | `list_reagent_brands` | 已登录用户 | query: `search`、`sort_by`、`sort_order`、`skip`、`limit`、`include_inactive` | `ReagentBrandListResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py" /> |
| `POST` | `/api/reagent-brands` | `create_reagent_brand` | 非公用账号 | body: `ReagentBrandCreate` | `ReagentBrandResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py" /> |
| `PUT` | `/api/reagent-brands/{brand_id}` | `update_reagent_brand` | 非公用账号 | path: `brand_id`；body: `ReagentBrandUpdate` | `ReagentBrandResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py" /> |
| `DELETE` | `/api/reagent-brands/{brand_id}` | `delete_reagent_brand` | 非公用账号 | path: `brand_id` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py" /> |

### 试剂订单基础接口 (`reagent_orders`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/reagent-orders/` | `list_reagent_orders` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |
| `POST` | `/api/reagent-orders/` | `create_reagent_order` | 已登录用户 | body: `ReagentOrderCreate` | `ReagentOrderResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |
| `GET` | `/api/reagent-orders/cas-overview/{cas_number}` | `get_cas_overview` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |
| `GET` | `/api/reagent-orders/export` | `export_reagent_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |
| `GET` | `/api/reagent-orders/{order_id}` | `get_reagent_order` | 已登录用户 | path: `order_id` | `ReagentOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |
| `PUT` | `/api/reagent-orders/{order_id}` | `update_reagent_order` | 已登录用户 | path: `order_id`；body: `ReagentOrderUpdate` | `ReagentOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> |

### 试剂订单工作流接口 (`reagent_orders_workflow`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/reagent-orders/dashboard/arrived-orders` | `get_arrived_reagent_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `GET` | `/api/reagent-orders/dashboard/my-reagent-orders` | `get_my_reagent_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `GET` | `/api/reagent-orders/dashboard/admin/reagent-orders` | `get_admin_reagent_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `DELETE` | `/api/reagent-orders/{order_id}` | `delete_reagent_order` | 已登录用户 | path: `order_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `POST` | `/api/reagent-orders/{order_id}/approve` | `approve_reagent_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `POST` | `/api/reagent-orders/{order_id}/confirm-arrival` | `confirm_reagent_arrival` | 已登录用户 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `POST` | `/api/reagent-orders/{order_id}/reject` | `reject_reagent_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |
| `POST` | `/api/reagent-orders/{order_id}/stock-in` | `stock_in_reagent_order` | 已登录用户 | path: `order_id`；body: `StockInRequest` | `dict` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> |

### 耗材订单接口 (`consumable_orders`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/consumable-orders/` | `list_consumable_orders` | 已登录用户 | query: `search` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `POST` | `/api/consumable-orders/` | `create_consumable_order` | 已登录用户 | body: `ConsumableOrderCreate` | `ConsumableOrderResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `GET` | `/api/consumable-orders/dashboard/my-consumable-orders` | `get_my_consumable_orders` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `GET` | `/api/consumable-orders/dashboard/admin/consumable-orders` | `get_admin_consumable_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `GET` | `/api/consumable-orders/export` | `export_consumable_orders` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `DELETE` | `/api/consumable-orders/{order_id}` | `delete_consumable_order` | 已登录用户 | path: `order_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `GET` | `/api/consumable-orders/{order_id}` | `get_consumable_order` | 已登录用户 | path: `order_id` | `ConsumableOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `PUT` | `/api/consumable-orders/{order_id}` | `update_consumable_order` | 已登录用户 | path: `order_id`；body: `ConsumableOrderUpdate` | `ConsumableOrderResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `POST` | `/api/consumable-orders/{order_id}/approve` | `approve_consumable_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `POST` | `/api/consumable-orders/{order_id}/complete` | `complete_consumable_order` | 已登录用户 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |
| `POST` | `/api/consumable-orders/{order_id}/reject` | `reject_consumable_order` | 管理员 | path: `order_id` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> |

### 公告接口 (`announcements`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/announcements/` | `list_announcements` | 管理员 | — | `List[AnnouncementResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `POST` | `/api/announcements/` | `create_announcement` | 管理员 | body: `AnnouncementCreate` | `AnnouncementResponse` | `status.HTTP_201_CREATED` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `DELETE` | `/api/announcements/images/{filename}` | `delete_announcement_image` | 管理员 | path: `filename` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `GET` | `/api/announcements/public` | `get_public_announcements` | 已登录用户 | — | `List[AnnouncementResponse]` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `GET` | `/api/announcements/storage-info` | `get_storage_info` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `POST` | `/api/announcements/upload-image` | `upload_announcement_image` | 管理员 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `DELETE` | `/api/announcements/{announcement_id}` | `delete_announcement` | 管理员 | path: `announcement_id` | `—` | `status.HTTP_204_NO_CONTENT` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `GET` | `/api/announcements/{announcement_id}` | `get_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `PUT` | `/api/announcements/{announcement_id}` | `update_announcement` | 管理员 | path: `announcement_id`；body: `AnnouncementUpdate` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `POST` | `/api/announcements/{announcement_id}/toggle-pin` | `toggle_pin_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |
| `POST` | `/api/announcements/{announcement_id}/toggle-visibility` | `toggle_visibility_announcement` | 管理员 | path: `announcement_id` | `AnnouncementResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" /> |

### SSE 事件接口 (`events`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/events` | `sse_events` | 已登录用户 | — | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> |

### 错误日志接口 (`error_logs`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/error-logs` | `get_error_logs` | 已登录用户 | query: `hours`；query: `lines` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py" /> |

### 购物车同步接口 (`cart_sync`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST` | `/api/cart-sync` | `sync_cart` | 已登录用户 | body: `CartItemRequest` | `CartSyncResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" /> |

### 化学信息接口 (`chemical_info`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chemical-info/{cas_number}` | `get_chemical_info` | 已登录用户 | path: `cas_number` | `—` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py" /> |

### 化学结构接口 (`chem`)

| 方法 | 路径 | 函数 | 权限 | 关键参数（path/query/body/file） | 返回模型 | 状态码 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/chem/index/status` | `get_structure_index_status` | 已登录用户 | — | `StructureIndexStatusResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/index/rebuild` | `rebuild_structure_index` | 管理员 | — | `StructureIndexStatusResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `GET` | `/api/chem/structures/cache` | `list_structure_cache` | 已登录用户 | query: `status_filter`、`search`、`skip`、`limit` | `StructureCacheListResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `GET` | `/api/chem/structures/cache/{cas_number}` | `get_structure_cache_status` | 已登录用户 | path: `cas_number` | `CompoundStructureCacheResponse or None` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/structures/cache/{cas_number}/pubchem-candidates` | `preview_structure_pubchem_candidates` | 管理员 | path: `cas_number` | `PubChemCandidatePreviewResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/structures/resolve-cas` | `resolve_structure_cas` | 管理员 | body: `ResolveCasRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `PUT` | `/api/chem/structures/cache/{cas_number}/manual` | `save_manual_structure` | 管理员 | path: `cas_number`；body: `ManualStructureRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/structures/cache/{cas_number}/confirm-pubchem` | `confirm_pubchem_candidate` | 管理员 | path: `cas_number`；body: `ConfirmPubChemCidRequest` | `CompoundStructureCacheResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |
| `POST` | `/api/chem/search/substructure` | `search_substructure` | 已登录用户 | body: `SubstructureSearchRequest` | `SubstructureSearchResponse` | `200` | <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> |

## 二次开发规则

- 新增 API 时，优先沿用现有依赖模式（`CurrentUser` / `AdminUser`），避免权限漂移。
- 新增 `/api/inventory/*` 或 `/api/reagent-orders/*` 路径时，先确认命名路由优先级，避免被 `/{id}` 路由吞掉。
- 新增列表筛选条件时，需要同步评估索引、缓存 Key、FTS 字段和前端查询参数。

## 参考代码
- [app/api/announcements.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py)
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/chem.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py)
- [app/api/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/dashboard.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py)
- [app/api/error_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory_extended_routes.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_brands.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/user_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py)
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py)
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services/chemical_info.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py)

