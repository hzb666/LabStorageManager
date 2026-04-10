# 代码注释审查结果

> 说明：已通过子代理分区协作审查，并汇总为本报告。

> 审查规则：标注“纯英文注释”“多行注释（排除分类用注释）”。

> 审查文件数：236（代码/配置类文件）

## `.github/workflows/ci.yml`
- 结论：无问题

## `.github/workflows/security.yml`
- 结论：无问题

## `.github/workflows/wiki-pages.yml`
- 结论：无问题

## `.vscode/settings.json`
- 结论：无问题

## `app/__init__.py`
- 结论：有问题
  - [纯英文注释] 行 13：`Keep stdlib sqlite3 as fallback for local/dev environments.`

## `app/api/__init__.py`
- 结论：无问题

## `app/api/announcements.py`
- 结论：无问题

## `app/api/cart_sync.py`
- 结论：无问题

## `app/api/chemical_name_map.py`
- 结论：无问题

## `app/api/common_shelf.py`
- 结论：无问题

## `app/api/consumable_orders.py`
- 结论：有问题
  - [多行注释] 行 1：`耗材订单 API 路由：耗材申购流程管理。 与试剂订单分离（耗材无需入库流程）。`
  - [纯英文注释] 行 139：`Atomic delete avoids check-then-delete races; explicit existence check preserves 404/403 semantics.`
  - [多行注释] 行 163：`补充 specification 展示字段。 specification 为用户直接输入的完整规格字符串，无需拼接。 specification 字段已包含在 model_dump 中，无需额外处理`
  - [纯英文注释] 行 506：`Export consumable orders as a downloadable XLSX file.`
  - [纯英文注释] 行 664：`Reject a consumable order (Admin only). Does not modify notes.`
  - [多行注释] 行 699：`完成耗材订单（耗材不需要入库）。 仅申请人或管理员可执行该操作。`
  - [纯英文注释] 行 808：`Delete a consumable order (only applicant or admin can delete).`

## `app/api/deps.py`
- 结论：无问题

## `app/api/error_logs.py`
- 结论：无问题

## `app/api/events.py`
- 结论：有问题
  - [多行注释] 行 1：`SSE 事件流入口。 前端通过 /api/events?rooms=inventory,common_shelf 建连。`

## `app/api/inventory.py`
- 结论：有问题
  - [多行注释] 行 1：`Inventory API 路由：库存管理。 关键规则 #2：CAS 编号标准化（数据从订单复制）。 所有用户可查看/消耗/新增/编辑/删除分组。 路由顺序要求：具名路由必须在 /{inventory_id} 之前， 避免路径参数误捕获 "export"、"dashboard" 等字符串。`
  - [纯英文注释] 行 476：`Register named/extended routes first to keep path precedence semantics.`

## `app/api/inventory_extended_routes.py`
- 结论：无问题

## `app/api/reagent_orders.py`
- 结论：有问题
  - [多行注释] 行 1：`试剂订单 API 路由：试剂申购流程管理。 与耗材订单分离，支持独立工作流。`
  - [纯英文注释] 行 161：`Validate order reason in API layer and convert to enum for model persistence.`
  - [纯英文注释] 行 186：`Add computed specification field to order response dict`
  - [纯英文注释] 行 401：`Parse specification to get initial_quantity and unit`
  - [纯英文注释] 行 589：`Export reagent orders as a downloadable XLSX file.`
  - [纯英文注释] 行 608：`Get CAS overview for duplicate-check hints in forms and expanded rows.`
  - [多行注释] 行 624：`订单：匹配同 CAS 的所有订单。 统一排除已到货/已入库（避免与库存重复）， 供“新建查重”和“展开行”复用同一口径。`

## `app/api/reagent_orders_workflow.py`
- 结论：有问题
  - [纯英文注释] 行 735：`Keep delete atomic while preserving legacy API semantics: missing -> 404, unauthorized existing row -> 403.`

## `app/api/user_logs.py`
- 结论：无问题

## `app/api/user_sessions.py`
- 结论：无问题

## `app/api/users.py`
- 结论：有问题
  - [多行注释] 行 1073：`重置管理员密码时，要求当前操作者再次验证自己的口令，而不是目标管理员旧口令。 否则该接口会退化成“在线探测目标管理员密码是否正确”的 oracle。`

## `app/archive_logs.py`
- 结论：无问题

## `app/core/__init__.py`
- 结论：无问题

## `app/core/auth.py`
- 结论：有问题
  - [纯英文注释] 行 407：`Production must use RS256; HS256 branch is for development fallback only.`
  - [纯英文注释] 行 427：`Production must use RS256; HS256 branch is for development fallback only.`
  - [多行注释] 行 471：`命中 session 缓存时仍查询一次 User，确保禁用账号/用户名版本变更能立即生效， 同时避免每次都回源联表查询 session。`

## `app/core/banner.py`
- 结论：无问题

## `app/core/config.py`
- 结论：有问题
  - [纯英文注释] 行 104：`Only generate temporary key in explicit development mode`
  - [纯英文注释] 行 128：`Derive from private key only in explicit development mode`

## `app/core/constants.py`
- 结论：有问题
  - [多行注释] 行 166：`SSE runtime tuning 单连接待发送队列上限：超过后触发慢连接治理逻辑`

## `app/core/db_compat.py`
- 结论：有问题
  - [纯英文注释] 行 15：`Both SQLAlchemy's .returning() and raw-SQL RETURNING require SQLite >= 3.35.0`
  - [纯英文注释] 行 37：`Fallback: fetch the row first, then delete it.`
  - [纯英文注释] 行 57：`Fallback: fetch all matching rows first, then delete them.`

## `app/core/redis.py`
- 结论：无问题

## `app/core/request_utils.py`
- 结论：无问题

## `app/core/time_utils.py`
- 结论：无问题

## `app/database.py`
- 结论：有问题
  - [纯英文注释] 行 52：`Inventory searchable fields.`
  - [纯英文注释] 行 63：`Reagent order searchable raw-text and pinyin fields.`
  - [纯英文注释] 行 68：`Reagent order searchable pinyin fields.`
  - [纯英文注释] 行 75：`Consumable order searchable raw-text and pinyin fields.`
  - [纯英文注释] 行 79：`Chemical name map searchable pinyin fields.`
  - [纯英文注释] 行 92：`Inventory filter/sort and operational paths.`
  - [纯英文注释] 行 99：`Inventory operation log audit queries.`
  - [纯英文注释] 行 106：`Reagent order operation log audit queries.`
  - [纯英文注释] 行 114：`Consumable order operation log audit queries.`
  - [纯英文注释] 行 122：`User operation log audit queries.`
  - [纯英文注释] 行 128：`Borrow log operational queries.`
  - [纯英文注释] 行 131：`Reagent/consumable list status + applicant filters.`
  - [纯英文注释] 行 138：`Other modules.`
  - [纯英文注释] 行 145：`Common shelf filters and grouping.`
  - [纯英文注释] 行 151：`Chemical name map filtering.`
  - [纯英文注释] 行 153：`Common shelf operation log audit queries.`

## `app/main.py`
- 结论：有问题
  - [纯英文注释] 行 95：`Mask numeric ids and long opaque tokens/UUID-like segments.`
  - [纯英文注释] 行 211：`Add cache headers for static files (images, fonts, etc.)`
  - [纯英文注释] 行 392：`CORS middleware - must be added AFTER exception handlers`
  - [纯英文注释] 行 418：`Global exception handler for logging 500 errors - must be added BEFORE routes`
  - [多行注释] 行 497：`Import models to ensure tables are created This is needed for SQLModel to register all models`
  - [纯英文注释] 行 497：`Import models to ensure tables are created This is needed for SQLModel to register all models`

## `app/models/__init__.py`
- 结论：无问题

## `app/models/announcement.py`
- 结论：无问题

## `app/models/base.py`
- 结论：无问题

## `app/models/chemical_name_map.py`
- 结论：无问题

## `app/models/common_shelf.py`
- 结论：无问题

## `app/models/common_shelf_operation_log.py`
- 结论：无问题

## `app/models/consumable_order.py`
- 结论：无问题

## `app/models/consumable_order_operation_log.py`
- 结论：无问题

## `app/models/inventory.py`
- 结论：有问题
  - [纯英文注释] 行 28：`Critical: CAS Number copied from Order (already normalized)`
  - [纯英文注释] 行 50：`Search/sort acceleration: keep indexes that can actually hit B-Tree paths.`
  - [纯英文注释] 行 85：`Unique internal code: e.g., "64175-250113-001" (CAS-Date-Sequence)`
  - [纯英文注释] 行 224：`Computed field: specification (e.g., "500ml")`
  - [纯英文注释] 行 226：`Computed fields: user names`

## `app/models/inventory_operation_log.py`
- 结论：有问题
  - [多行注释] 行 27：`snapshot_json short-key contract: id=inventory row id, ic=internal_code, ca=cas_number, na=name, en=english_name, al=alias, cg=category, br=brand, pu=purity, sl=storage_location, iq=initial_quantity,`
  - [纯英文注释] 行 27：`snapshot_json short-key contract: id=inventory row id, ic=internal_code, ca=cas_number, na=name, en=english_name, al=alias, cg=category, br=brand, pu=purity, sl=storage_location, iq=initial_quantity,`

## `app/models/reagent_order.py`
- 结论：有问题
  - [纯英文注释] 行 43：`Chinese name (with index for query and pinyin for sorting)`
  - [纯英文注释] 行 49：`Category (with index for query and pinyin for sorting)`
  - [纯英文注释] 行 51：`Brand (with index for query and pinyin for sorting)`
  - [纯英文注释] 行 53：`Purity / grade (e.g. 95%, AR, HPLC)`
  - [纯英文注释] 行 57：`Unit (e.g., "ml", "g", "L")`
  - [多行注释] 行 63：`Order reason Order reason (optional, frontend must provide when creating)`
  - [纯英文注释] 行 63：`Order reason Order reason (optional, frontend must provide when creating)`

## `app/models/reagent_order_operation_log.py`
- 结论：无问题

## `app/models/runtime_state.py`
- 结论：无问题

## `app/models/user.py`
- 结论：无问题

## `app/models/user_operation_log.py`
- 结论：无问题

## `app/models/user_session.py`
- 结论：无问题

## `app/services/__init__.py`
- 结论：无问题

## `app/services/api_utils.py`
- 结论：无问题

## `app/services/audit_logger.py`
- 结论：无问题

## `app/services/cache_reset_service.py`
- 结论：无问题

## `app/services/cas_utils.py`
- 结论：有问题
  - [多行注释] 行 83：`\`validate_and_normalize_cas\` passes normalized input, so compare directly here to avoid a second normalize pass via \`is_special_cas_value\`.`
  - [纯英文注释] 行 83：`\`validate_and_normalize_cas\` passes normalized input, so compare directly here to avoid a second normalize pass via \`is_special_cas_value\`.`

## `app/services/chemical_info.py`
- 结论：无问题

## `app/services/chemical_name_map_fts.py`
- 结论：无问题

## `app/services/common_shelf_creation.py`
- 结论：有问题
  - [纯英文注释] 行 162：`Savepoint rollback only affects this batch, preserving outer confirm-arrival updates.`

## `app/services/common_shelf_operation_logger.py`
- 结论：无问题

## `app/services/common_shelf_queries.py`
- 结论：有问题
  - [纯英文注释] 行 577：`Keep window ranking constrained to the filtered subset to avoid full-table scans.`

## `app/services/error_logger.py`
- 结论：有问题
  - [多行注释] 行 77：`匹配 key=value 或 key: value 格式，要求前面有空格或开头 排除常见单词中的关键词（如 password123 中的 pass 不会被替换）`

## `app/services/excel_service.py`
- 结论：无问题

## `app/services/image_service.py`
- 结论：无问题

## `app/services/internal_code.py`
- 结论：有问题
  - [纯英文注释] 行 19：`UPDATE ... RETURNING requires SQLite >= 3.35.0`
  - [纯英文注释] 行 101：`Use lazy bootstrap so runtime can upgrade old DBs without a separate migration release.`
  - [纯英文注释] 行 125：`Reserve the whole range in one atomic operation to avoid check-then-insert races.`
  - [纯英文注释] 行 150：`Fallback for SQLite < 3.35: UPDATE then SELECT within the same transaction.`
  - [多行注释] 行 198：`Validate CAS number to prevent SQL injection CAS should only contain digits and hyphens`
  - [纯英文注释] 行 198：`Validate CAS number to prevent SQL injection CAS should only contain digits and hyphens`

## `app/services/inventory_creation.py`
- 结论：有问题
  - [纯英文注释] 行 89：`Full rollback is required here because this path does not use nested savepoints.`

## `app/services/inventory_fts.py`
- 结论：无问题

## `app/services/inventory_import_preview_sessions.py`
- 结论：无问题

## `app/services/inventory_operation_logger.py`
- 结论：无问题

## `app/services/inventory_queries.py`
- 结论：无问题

## `app/services/order_fts.py`
- 结论：无问题

## `app/services/order_operation_logger.py`
- 结论：无问题

## `app/services/pinyin_utils.py`
- 结论：无问题

## `app/services/rate_limit.py`
- 结论：无问题

## `app/services/search_matchers.py`
- 结论：有问题
  - [纯英文注释] 行 110：`Prefix LIKE can use B-Tree index on normalized CAS column.`
  - [纯英文注释] 行 132：`Ignore hour/minute/second. Keep at most yyyyMMdd.`

## `app/services/session_service.py`
- 结论：无问题

## `app/services/shelf_utils.py`
- 结论：无问题

## `app/services/spec_utils.py`
- 结论：有问题
  - [纯英文注释] 行 10：`Canonical unit form mapping (lowercase -> display form)`
  - [纯英文注释] 行 53：`Normalize unit to canonical form (e.g., "ml" -> "mL")`
  - [纯英文注释] 行 56：`Format number: integer without decimals, float with decimals`
  - [多行注释] 行 82：`Pattern: number + optional space + unit Use (\d+(?:\.\d+)?) to avoid matching invalid formats like "1.5.5"`
  - [纯英文注释] 行 82：`Pattern: number + optional space + unit Use (\d+(?:\.\d+)?) to avoid matching invalid formats like "1.5.5"`

## `app/services/sql_utils.py`
- 结论：有问题
  - [多行注释] 行 27：`使用 reduce 动态生成嵌套的 func.replace 相当于 func.replace(func.replace(field, '-', ''), ' ', '') ...`

## `app/services/sse_manager.py`
- 结论：有问题
  - [纯英文注释] 行 129：`Reclaim empty rooms to avoid unbounded in-memory room growth.`
  - [纯英文注释] 行 209：`Queue full means client is too slow; drop and eventually disconnect.`
  - [纯英文注释] 行 226：`Client may already be disconnected by another coroutine.`
  - [多行注释] 行 262：`Drop already-buffered business events so revocation is the next thing the client sees. Otherwise a kicked session can still consume stale messages.`
  - [纯英文注释] 行 262：`Drop already-buffered business events so revocation is the next thing the client sees. Otherwise a kicked session can still consume stale messages.`
  - [纯英文注释] 行 338：`Extract room from channel with prefix: "lsm:sse:room-123" -> "room-123"`
  - [纯英文注释] 行 360：`Already pushed locally by this process.`
  - [纯英文注释] 行 502：`Stop stream quickly when client is removed (e.g., slow client governance).`

## `app/services/sse_redis.py`
- 结论：无问题

## `app/services/user_operation_logger.py`
- 结论：无问题

## `app/services/user_service.py`
- 结论：无问题

## `app/services/user_utils.py`
- 结论：无问题

## `app/services/xlsx_export.py`
- 结论：无问题

## `browser-extension/background/cart-tab-selection.js`
- 结论：无问题

## `browser-extension/background/service-worker.js`
- 结论：无问题

## `browser-extension/content/import-bridge.js`
- 结论：有问题
  - [多行注释] 行 1：`导入桥接脚本 在系统 /import 页面读取扩展存储中的批次数据，并写入页面 localStorage。`

## `browser-extension/content/script.js`
- 结论：有问题
  - [多行注释] 行 1：`购物车同步 - Content Script 购物车页面：只获取产品ID、数量、价格、详情页URL`
  - [多行注释] 行 137：`2. 获取购物车项ID - 从元素ID或checkbox value获取 元素ID格式: cpdiv807440`

## `browser-extension/manifest.json`
- 结论：无问题

## `browser-extension/popup/order-type-detection.js`
- 结论：无问题

## `browser-extension/popup/popup.html`
- 结论：无问题

## `browser-extension/popup/popup.js`
- 结论：有问题
  - [多行注释] 行 1：`购物车同步 - Popup Script 直接与内容脚本通信，不依赖 service worker`
  - [多行注释] 行 216：`表格结构固定，直接匹配 td-2 中的内容 注意：</td> 和 <td> 之间可能有换行和空格`

## `browser-extension/shared/site-config.js`
- 结论：无问题

## `docker-compose.yml`
- 结论：无问题

## `docker/backend/Dockerfile`
- 结论：无问题

## `docker/backend/entrypoint.sh`
- 结论：有问题
  - [纯英文注释] 行 1：`!/bin/sh`

## `docker/frontend/Dockerfile`
- 结论：无问题

## `docker/nginx/default.conf`
- 结论：无问题

## `docker/nginx/nginx.conf`
- 结论：无问题

## `frontend/eslint.config.js`
- 结论：有问题
  - [多行注释] 行 10：`.css"]), { files: ["*`
  - [纯英文注释] 行 10：`.css"]), { files: ["*`

## `frontend/index.html`
- 结论：无问题

## `frontend/package-lock.json`
- 结论：无问题

## `frontend/package.json`
- 结论：无问题

## `frontend/postcss.config.js`
- 结论：无问题

## `frontend/public/lib/RDKit_minimal.js`
- 结论：有问题
  - [多行注释] 行 16：`This default export looks redundant, but it allows TS to import this commonjs style module.`
  - [纯英文注释] 行 16：`This default export looks redundant, but it allows TS to import this commonjs style module.`

## `frontend/scripts/lib-assets.mjs`
- 结论：无问题

## `frontend/src/App.tsx`
- 结论：无问题

## `frontend/src/api/client.ts`
- 结论：有问题
  - [多行注释] 行 657：`创建日志 API 适配器（用于 FilterTable） 注意：FilterTable 使用 status_filter 参数，但日志 API 需要 log_type，需要转换`
  - [多行注释] 行 673：`将 status_filter 转换为 log_type（FilterTable 使用 status_filter，日志 API 需要 log_type） 注意：'all' 表示全部类型，不传参给后端`

## `frontend/src/components/AnnouncementBanner.tsx`
- 结论：无问题

## `frontend/src/components/AnnouncementButton.tsx`
- 结论：无问题

## `frontend/src/components/AnnouncementDetail.tsx`
- 结论：无问题

## `frontend/src/components/AuthDeferredShell.tsx`
- 结论：无问题

## `frontend/src/components/BaseForm.tsx`
- 结论：无问题

## `frontend/src/components/BorrowDialog.tsx`
- 结论：无问题

## `frontend/src/components/BugReportButton.tsx`
- 结论：有问题
  - [多行注释] 行 1：`BugReportButton - Bug反馈按钮组件 点击后： 1. 获取前端错误日志 2. 获取后端错误日志（需要管理员权限） 3. 生成日志文件并下载 4. 打开mailto链接`

## `frontend/src/components/CartImportLoadingScreen.tsx`
- 结论：无问题

## `frontend/src/components/CommonShelfDialogs.tsx`
- 结论：有问题
  - [多行注释] 行 56：`常用货架弹窗统一使用分组 controller。 页面层只关心 state/forms/actions/itemEdit 四类职责，避免继续平铺几十个字段来回透传。`
  - [多行注释] 行 143：`通用的取消/提交按钮区。 各业务模式只保留自己的字段和文案，不再重复写一整段按钮布局。`

## `frontend/src/components/ConsumableOrderExpandedRow.tsx`
- 结论：有问题
  - [多行注释] 行 1：`耗材订单展开行组件（共享） 用于 Dashboard 耗材订单 Tab 和 ConsumableOrders 页面 展示英文名称、货号、价格、备注，可选显示申购时间和订购人`

## `frontend/src/components/EditDialogActions.tsx`
- 结论：无问题

## `frontend/src/components/ErrorBoundary.tsx`
- 结论：无问题

## `frontend/src/components/ReagentCasDuplicateWarning.tsx`
- 结论：无问题

## `frontend/src/components/ReagentOrderExpandedRow.tsx`
- 结论：无问题

## `frontend/src/components/SidebarLogo.tsx`
- 结论：无问题

## `frontend/src/components/TableActionButtons.tsx`
- 结论：无问题

## `frontend/src/components/UserEditDialog.tsx`
- 结论：无问题

## `frontend/src/components/ui/AutoComplete.tsx`
- 结论：无问题

## `frontend/src/components/ui/Avatar.tsx`
- 结论：无问题

## `frontend/src/components/ui/Button.tsx`
- 结论：无问题

## `frontend/src/components/ui/Card.tsx`
- 结论：无问题

## `frontend/src/components/ui/Checkbox.tsx`
- 结论：无问题

## `frontend/src/components/ui/DataTable.tsx`
- 结论：有问题
  - [纯英文注释] 行 158：`eslint-disable-next-line react-hooks/incompatible-library`

## `frontend/src/components/ui/DataTableBody.tsx`
- 结论：有问题
  - [多行注释] 行 1：`DataTable 表体组件 从 DataTable 中提取的虚拟化/非虚拟化行渲染、加载更多、空状态`

## `frontend/src/components/ui/DataTableHeader.tsx`
- 结论：有问题
  - [多行注释] 行 1：`DataTable 表头组件 从 DataTable 中提取的表头渲染逻辑：排序、列宽调整手柄、Tooltip`

## `frontend/src/components/ui/Dialog.tsx`
- 结论：无问题

## `frontend/src/components/ui/FilterTable.tsx`
- 结论：有问题
  - [纯英文注释] 行 632：`eslint-disable-next-line react-hooks/incompatible-library`

## `frontend/src/components/ui/FormField.tsx`
- 结论：有问题
  - [多行注释] 行 13：`FormField - 表单字段组合组件 封装 Label + Input/Select + ErrorMessage 的组合 支持语义化颜色和 dark mode 使用示例: \`\`\`tsx <FormField label="规格" required error={formErrors.specification}> <Input id="add_spec" value={formData.sp`

## `frontend/src/components/ui/HazardousIcon.tsx`
- 结论：无问题

## `frontend/src/components/ui/HighlightText.tsx`
- 结论：无问题

## `frontend/src/components/ui/Input.tsx`
- 结论：无问题

## `frontend/src/components/ui/Label.tsx`
- 结论：无问题

## `frontend/src/components/ui/LoadingButton.tsx`
- 结论：无问题

## `frontend/src/components/ui/MoleculeStructure.tsx`
- 结论：无问题

## `frontend/src/components/ui/NoteDisplay.tsx`
- 结论：无问题

## `frontend/src/components/ui/Pagination.tsx`
- 结论：无问题

## `frontend/src/components/ui/PasswordInput.tsx`
- 结论：无问题

## `frontend/src/components/ui/QuantityIndicator.tsx`
- 结论：无问题

## `frontend/src/components/ui/RadioGroup.tsx`
- 结论：无问题

## `frontend/src/components/ui/Select.tsx`
- 结论：无问题

## `frontend/src/components/ui/Separator.tsx`
- 结论：无问题

## `frontend/src/components/ui/StaleBanner.tsx`
- 结论：有问题
  - [多行注释] 行 1：`Banner shown when list snapshot is considered structurally stale. Keep it independent so each page can opt in with minimal wiring.`
  - [纯英文注释] 行 1：`Banner shown when list snapshot is considered structurally stale. Keep it independent so each page can opt in with minimal wiring.`

## `frontend/src/components/ui/StatusBadge.tsx`
- 结论：无问题

## `frontend/src/components/ui/TableFilters.tsx`
- 结论：无问题

## `frontend/src/components/ui/Tabs.tsx`
- 结论：无问题

## `frontend/src/components/ui/Textarea.tsx`
- 结论：无问题

## `frontend/src/components/ui/Toast.tsx`
- 结论：无问题

## `frontend/src/components/ui/Tooltip.tsx`
- 结论：有问题
  - [多行注释] 行 8：`给 tooltip 加入一个小的延迟，避免在侧边栏折叠/动画过程中 因短暂经过触发区域而打开大量 tooltip`

## `frontend/src/fontLoader.ts`
- 结论：无问题

## `frontend/src/hooks/useBulkExpand.ts`
- 结论：无问题

## `frontend/src/hooks/useColumnResize.ts`
- 结论：无问题

## `frontend/src/hooks/useDataTableScroll.ts`
- 结论：无问题

## `frontend/src/hooks/useDialogState.tsx`
- 结论：有问题
  - [多行注释] 行 3：`Custom hook for confirm dialog @param initialState string | null @returns A stateful value, and a function to update it. @example const [open, setOpen] = useDialogState<"approve" | "reject">()`
  - [纯英文注释] 行 3：`Custom hook for confirm dialog @param initialState string | null @returns A stateful value, and a function to update it. @example const [open, setOpen] = useDialogState<"approve" | "reject">()`

## `frontend/src/hooks/useErrorLogger.tsx`
- 结论：有问题
  - [多行注释] 行 1：`useErrorLogger - 前端错误日志收集Hook 自动捕获前端控制台错误和网络请求错误 日志仅保存在内存中，页面刷新后清除（保护隐私）`

## `frontend/src/hooks/useFormModal.tsx`
- 结论：有问题
  - [多行注释] 行 44：`通用表单Modal Hook 封装表单状态管理、验证和提交流逻辑 @example \`\`\`tsx const { formData, formErrors, submitting, handleChange, validateForm, resetForm, handleSubmit } = useFormModal({ initialData: { name: '', quantity: 0 }`

## `frontend/src/hooks/useListSSE.ts`
- 结论：有问题
  - [多行注释] 行 1：`List-focused SSE integration hook. Policy: - Stable row-field updates are patched locally. - Structural changes only patch when they are obviously safe. - Ambiguous cases fall back to stale banner ref`
  - [纯英文注释] 行 1：`List-focused SSE integration hook. Policy: - Stable row-field updates are patched locally. - Structural changes only patch when they are obviously safe. - Ambiguous cases fall back to stale banner ref`

## `frontend/src/hooks/useMobile.tsx`
- 结论：无问题

## `frontend/src/hooks/useReagentCasDuplicateCheck.ts`
- 结论：无问题

## `frontend/src/hooks/useRememberedUser.ts`
- 结论：有问题
  - [多行注释] 行 11：`Hook: 记住用户信息 用于实现类似微软锁屏的登录体验 - 登录成功后自动保存用户信息（无需勾选） - Session 过期后显示锁屏模式，只需输入密码 - 修改用户名时清除记住信息，修改头像自动更新`

## `frontend/src/hooks/useSSE.ts`
- 结论：有问题
  - [多行注释] 行 1：`Generic SSE hook for room-based event streams. Integration: 1) Build event handlers in page/domain hook. 2) Call useSSE({ rooms, handlers }). 3) Use store stale flag to show refresh banner.`
  - [纯英文注释] 行 1：`Generic SSE hook for room-based event streams. Integration: 1) Build event handlers in page/domain hook. 2) Call useSSE({ rooms, handlers }). 3) Use store stale flag to show refresh banner.`

## `frontend/src/hooks/useTableState.tsx`
- 结论：无问题

## `frontend/src/hooks/useTableUrlState.ts`
- 结论：无问题

## `frontend/src/hooks/useTheme.ts`
- 结论：无问题

## `frontend/src/index.css`
- 结论：无问题

## `frontend/src/lib/apiConfig.ts`
- 结论：无问题

## `frontend/src/lib/authSession.ts`
- 结论：有问题
  - [纯英文注释] 行 30：`eslint-disable-next-line sonarjs/no-hardcoded-passwords`
  - [纯英文注释] 行 32：`eslint-disable-next-line sonarjs/no-hardcoded-passwords`

## `frontend/src/lib/cacheVersionBootstrap.ts`
- 结论：有问题
  - [纯英文注释] 行 139：`ignore network errors; backend startup reset already invalidates old sessions`

## `frontend/src/lib/chemicalProperties.ts`
- 结论：无问题

## `frontend/src/lib/constants.ts`
- 结论：有问题
  - [多行注释] 行 1：`Centralized mapping tables for status/reason/role display Backend stores English values; frontend maps to Chinese.`
  - [纯英文注释] 行 1：`Centralized mapping tables for status/reason/role display Backend stores English values; frontend maps to Chinese.`

## `frontend/src/lib/dashboardUtils.tsx`
- 结论：有问题
  - [多行注释] 行 1：`Dashboard 共享工具函数、类型定义和常量 纯工具文件，不包含 React 组件（避免 react-refresh/only-export-components 规则冲突）`
  - [多行注释] 行 140：`广播“仪表盘统计需要刷新”的信号。 存在原因：统计卡片使用轻量缓存，子 Tab 完成变更后需要显式通知顶部卡片同步更新。`
  - [多行注释] 行 151：`订阅“仪表盘统计需要刷新”的信号，并返回清理函数。 存在原因：让 Dashboard 容器可以在子 Tab 触发变更后重新拉取统计数字。`

## `frontend/src/lib/formConfigs.tsx`
- 结论：有问题
  - [多行注释] 行 1：`表单字段配置 统一管理库存、试剂订单和耗材订单的表单字段配置，供 BaseForm 组件使用`
  - [多行注释] 行 85：`获取库存表单字段配置 @param isEdit 是否为编辑模式 @param initialQuantity 初始数量（编辑模式下使用）`
  - [多行注释] 行 141：`试剂订单默认值 注意：price 和 order_reason 验证为必填，但默认值允许为空（用户必须手动选择/输入）`
  - [多行注释] 行 288：`获取归还表单字段配置 @param mode 归还模式（remaining 或 used） @param maxQuantity 最大数量（原借用时的剩余量）`

## `frontend/src/lib/inputConfigs.ts`
- 结论：无问题

## `frontend/src/lib/options.ts`
- 结论：无问题

## `frontend/src/lib/orderSubmitHelpers.ts`
- 结论：无问题

## `frontend/src/lib/sseEvents.ts`
- 结论：无问题

## `frontend/src/lib/sseRuntime.ts`
- 结论：无问题

## `frontend/src/lib/staticAssets.ts`
- 结论：无问题

## `frontend/src/lib/storage/appAuthMetaStorage.ts`
- 结论：无问题

## `frontend/src/lib/storage/appTableStorage.ts`
- 结论：无问题

## `frontend/src/lib/storage/appUiStorage.ts`
- 结论：无问题

## `frontend/src/lib/storage/localStorageCore.ts`
- 结论：无问题

## `frontend/src/lib/tableConfigs.tsx`
- 结论：有问题
  - [多行注释] 行 1：`表格列配置抽离 仿照 formConfigs.tsx 模式，集中管理表格列配置 使用方式： import { getInventoryTableColumns } from '@/lib/tableConfigs' const columns = getInventoryTableColumns()`
  - [多行注释] 行 30：`库存表格列配置 包含：CAS号、名称、位置、分类、品牌、剩余/规格、状态`
  - [多行注释] 行 149：`试剂订单表格列配置 包含：CAS号、名称、品牌、规格、价格、原因、订购人、时间、状态`
  - [多行注释] 行 284：`耗材订单表格列配置 包含：名称、分类、品牌、规格、数量、价格、订购人、状态`
  - [多行注释] 行 581：`用户管理表格列配置 包含：用户名、姓名、角色、状态、创建时间、最后活跃时间`
  - [多行注释] 行 657：`设备管理表格列配置 包含：设备名称、IP地址、最近活跃、首次登录、状态`

## `frontend/src/lib/toast.ts`
- 结论：无问题

## `frontend/src/lib/utils.ts`
- 结论：有问题
  - [多行注释] 行 41：`处理备注字段：保留标签前缀，只移除内容为空的标签 支持所有在 inputConfigs 中定义的标签`
  - [多行注释] 行 75：`安全地将 unknown 值转换为字符串 用于处理 API 返回的可能为 null/undefined/非字符串的值`

## `frontend/src/lib/validationSchemas.ts`
- 结论：有问题
  - [多行注释] 行 1：`Valibot 验证 Schemas 使用方法: \`\`\`tsx import { useForm } from 'react-hook-form' import { valibotResolver } from '@hookform/resolvers/valibot' import { InventorySchema } from '@/lib/validationSchemas' const`
  - [多行注释] 行 20：`类型化 resolver - 解决类型推断问题 使用方法: resolver: createValibotResolver(InventoryFormSchema)`
  - [多行注释] 行 50：`必填字符串验证 - 替代 validateRequired @param fieldName 字段中文名称`
  - [多行注释] 行 61：`字符串长度验证 - 替代 validateStringLength @param fieldName 字段中文名称 @param min 最小长度 @param max 最大长度`
  - [多行注释] 行 79：`字符串最大长度验证 - 仅验证最大长度，不限制最小值 @param fieldName 字段中文名称 @param max 最大长度`
  - [多行注释] 行 94：`正整数验证 (>=1) - 用于瓶数等必须为整数的字段 支持字符串和数字输入，在 handleSubmit 中手动转换 注意：不包含上限限制，具体上限由使用处单独定义 @param fieldName 字段中文名称`
  - [多行注释] 行 109：`正数验证 (可小数) - 用于初始量等可以是小数 quantity 的字段 支持字符串和数字输入 @param fieldName 字段中文名称`
  - [多行注释] 行 122：`非负数验证 - 用于剩余量等可以为0的字段 支持字符串和数字输入 @param fieldName 字段中文名称`
  - [多行注释] 行 135：`剩余量验证 - 用于编辑时验证剩余量不超过初始量 支持字符串和数字输入 @param fieldName 字段中文名称 @param maxValue 最大值（初始量）`
  - [多行注释] 行 150：`价格验证 - 替代 validatePrice 支持字符串和数字输入 @param min 最小值 @param max 最大值`
  - [多行注释] 行 178：`规格验证 - 替代 validateSpecification 支持格式: 500ml, 1L, 100g, 500 ml, 1.5L 等`
  - [多行注释] 行 203：`CAS 校验码计算逻辑 CAS号格式：三部分组成，第一部分2-6位数字，第二部分2位数字，第三部分1位校验码 校验码计算：将第一二部分的数字从右到左依次乘以1,2,3...，求和后取模10`
  - [多行注释] 行 240：`CAS号验证 - 替代 validateCASNumber & normalizeCASNumber 自动标准化：大写 + 去除空格`
  - [多行注释] 行 297：`剩余量验证（非负数，允许0，但不能是null/undefined/空字符串） 使用 v.union 在最外层拒绝空字符串 注意：此 Schema 用于基础验证，编辑模式下 additional 验证在 handleFormSubmit 中单独处理`
  - [多行注释] 行 312：`库存表单 Schema remaining_quantity 可选（后端自动计算等于 initial_quantity） 编辑模式下 remaining_quantity 必填的验证在 handleFormSubmit 中处理`
  - [多行注释] 行 407：`试剂订单 Schema 前端输入: specification (规格字符串，如 500ml) 后端处理: 拆分为 initial_quantity 和 unit`
  - [多行注释] 行 523：`归还数量验证 Schema - 用于验证归还时的剩余量或使用量 支持字符串和数字输入 @param fieldName 字段中文名称（如"剩余量"或"使用量"） @param maxValue 最大值（原借用时的剩余量）`
  - [多行注释] 行 572：`设备名称验证 Schema 必填，最大长度50字符`
  - [多行注释] 行 586：`安全的值转换为字符串 避免 [object Object] 问题 @param value 要转换的值 @param fallback 回退值，默认为 '-' @returns 字符串值或回退值`

## `frontend/src/main.tsx`
- 结论：无问题

## `frontend/src/pages/AdminUsers.tsx`
- 结论：有问题
  - [多行注释] 行 606：`这里不会把 table 实例再交给 memo comparator 缓存，按项目约定定点忽略编译器告警。 eslint-disable-next-line react-hooks/incompatible-library`

## `frontend/src/pages/AnnouncementManagement.tsx`
- 结论：有问题
  - [多行注释] 行 777：`这里直接在当前 hook 内消费 table 实例，没有额外 memo 边界，按项目约定定点忽略。 eslint-disable-next-line react-hooks/incompatible-library`

## `frontend/src/pages/CartImport.tsx`
- 结论：无问题

## `frontend/src/pages/CommonShelf.tsx`
- 结论：有问题
  - [多行注释] 行 1010：`页面装配层负责把刷新、弹窗、表格列和导出动作收敛起来。 主页面只消费这个 controller，避免在 JSX 上方继续堆叠一长串 useCallback/useMemo。`

## `frontend/src/pages/ConsumableOrders.tsx`
- 结论：无问题

## `frontend/src/pages/Dashboard.tsx`
- 结论：有问题
  - [多行注释] 行 1：`组织仪表盘页签、统计卡片和按需加载的子页。 \`activeTab\` 会持久化到 localStorage，并按当前角色校验可见范围。`

## `frontend/src/pages/DeviceManagement.tsx`
- 结论：有问题
  - [多行注释] 行 471：`这里直接消费 table 实例，不再放进 useMemo 缓存；按项目约定定点忽略编译器告警。 eslint-disable-next-line react-hooks/incompatible-library`

## `frontend/src/pages/Import.tsx`
- 结论：无问题

## `frontend/src/pages/Inventory.tsx`
- 结论：有问题
  - [多行注释] 行 1：`Inventory.tsx 库存管理页面 功能：库存列表展示、搜索筛选、手动入库、编辑、删除、借用、导出`

## `frontend/src/pages/Layout.tsx`
- 结论：无问题

## `frontend/src/pages/Login.tsx`
- 结论：无问题

## `frontend/src/pages/NotFound.tsx`
- 结论：无问题

## `frontend/src/pages/OperationLogs.tsx`
- 结论：有问题
  - [多行注释] 行 2：`用户操作日志页面 使用 FilterTable 架构，与库存页面完全一致`

## `frontend/src/pages/ReagentOrders.tsx`
- 结论：无问题

## `frontend/src/pages/TestError.tsx`
- 结论：无问题

## `frontend/src/pages/cartimport/cartImportControllers.ts`
- 结论：无问题

## `frontend/src/pages/cartimport/cartImportModel.ts`
- 结论：无问题

## `frontend/src/pages/dashboard/DashboardBorrowTab.tsx`
- 结论：有问题
  - [多行注释] 行 1：`仪表盘 - 借用记录 Tab 展示当前用户的借用列表，支持归还操作（使用量/剩余量模式）`

## `frontend/src/pages/dashboard/DashboardConsumableTab.tsx`
- 结论：无问题

## `frontend/src/pages/dashboard/DashboardReagentTab.tsx`
- 结论：无问题

## `frontend/src/pages/dashboard/DashboardStockinTab.tsx`
- 结论：有问题
  - [多行注释] 行 1：`仪表盘 - 待入库 Tab 展示当前用户暂存的待入库记录，支持一键入库（填写存放位置）`

## `frontend/src/store/sseStore.ts`
- 结论：有问题
  - [多行注释] 行 1：`SSE runtime state store. This file is intentionally standalone so it can be integrated page-by-page without touching existing global stores.`
  - [纯英文注释] 行 1：`SSE runtime state store. This file is intentionally standalone so it can be integrated page-by-page without touching existing global stores.`
  - [纯英文注释] 行 21：`Track sequence per room for reliability checks.`
  - [纯英文注释] 行 107：`Ignore duplicate/old events.`

## `frontend/src/store/useStore.ts`
- 结论：无问题

## `frontend/tailwind.config.js`
- 结论：有问题
  - [纯英文注释] 行 1：`@type {import('tailwindcss').Config}`

## `frontend/tsconfig.app.json`
- 结论：无问题

## `frontend/tsconfig.json`
- 结论：无问题

## `frontend/tsconfig.node.json`
- 结论：无问题

## `frontend/vite.config.ts`
- 结论：有问题
  - [纯英文注释] 行 94：`https://vite.dev/config/`

## `package-lock.json`
- 结论：无问题

## `package.json`
- 结论：无问题

## `pyproject.toml`
- 结论：无问题

## `wiki/.vitepress/theme/AsideOutline.vue`
- 结论：无问题

## `wiki/.vitepress/theme/Layout.vue`
- 结论：无问题

## `wiki/.vitepress/theme/OutlineTree.vue`
- 结论：无问题

## `wiki/.vitepress/theme/components/InlineCodeRef.vue`
- 结论：无问题

## `wiki/.vitepress/theme/components/MermaidAuto.vue`
- 结论：无问题

## `wiki/.vitepress/theme/components/SidebarsToggle.vue`
- 结论：无问题

## `wiki/.vitepress/theme/components/SidebarsToggleInExtraMenu.vue`
- 结论：无问题

## `wiki/.vitepress/theme/custom.css`
- 结论：无问题

## `wiki/.vitepress/theme/fontLoader.ts`
- 结论：无问题

## `wiki/.vitepress/theme/index.ts`
- 结论：无问题

## `wiki/package-lock.json`
- 结论：无问题

## `wiki/package.json`
- 结论：无问题
