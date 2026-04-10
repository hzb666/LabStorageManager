# 代码注释审查报告

> 审查范围：仓库内所有已跟踪代码文件（扩展名：.py/.js/.ts/.tsx/.mjs/.vue/.css/.html/.sh/.yml/.yaml/.toml/.conf）。\
> 审查项：1) 纯英文注释；2) 多行注释（排除分类/分隔用途注释）。\
> 说明：本次仅生成报告，不修改代码。

- 目标代码文件数：**223**
- 缺失文件数：**0**
- 存在问题的文件数：**88**
- 问题总数：**373**

## 逐文件审查结果

### .github/workflows/ci.yml

- 结果：✅ 无问题

### .github/workflows/security.yml

- 结果：✅ 无问题

### .github/workflows/wiki-pages.yml

- 结果：✅ 无问题

### app/__init__.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：13；片段：`Keep stdlib sqlite3 as fallback for local/dev environments.`

### app/api/__init__.py

- 结果：✅ 无问题

### app/api/announcements.py

- 结果：❌ 发现 3 处问题
  - 1. 类型：纯英文注释；行号：209；片段：`Update fields`
  - 2. 类型：纯英文注释；行号：214；片段：`Update timestamp`
  - 3. 类型：纯英文注释；行号：239；片段：`Delete associated images`

### app/api/cart_sync.py

- 结果：✅ 无问题

### app/api/chemical_name_map.py

- 结果：✅ 无问题

### app/api/common_shelf.py

- 结果：✅ 无问题

### app/api/consumable_orders.py

- 结果：❌ 发现 17 处问题
  - 1. 类型：多行注释；行号：1；片段：`耗材订单 API 路由：耗材申购流程管理。`
  - 2. 类型：纯英文注释；行号：139；片段：`Atomic delete avoids check-then-delete races; explicit existence check preserves 404/403 semantics.`
  - 3. 类型：多行注释；行号：163；片段：`补充 specification 展示字段。`
  - 4. 类型：纯英文注释；行号：178；片段：`Get consumable order by ID`
  - 5. 类型：纯英文注释；行号：347；片段：`Create a new consumable order`
  - 6. 类型：纯英文注释；行号：476；片段：`Enrich with applicant names`
  - 7. 类型：纯英文注释；行号：500；片段：`--- Export ---`
  - 8. 类型：纯英文注释；行号：506；片段：`Export consumable orders as a downloadable XLSX file.`
  - 9. 类型：纯英文注释；行号：524；片段：`Get consumable order by ID`
  - 10. 类型：纯英文注释；行号：541；片段：`Update consumable order information`
  - 11. 类型：纯英文注释；行号：623；片段：`Approve a consumable order (Admin only)`
  - 12. 类型：纯英文注释；行号：664；片段：`Reject a consumable order (Admin only). Does not modify notes.`
  - 13. 类型：多行注释；行号：699；片段：`完成耗材订单（耗材不需要入库）。`
  - 14. 类型：纯英文注释；行号：708；片段：`Check if user is the applicant or admin`
  - 15. 类型：纯英文注释；行号：722；片段：`Consumables complete directly (no stock-in)`
  - 16. 类型：纯英文注释；行号：752；片段：`Get current user's consumable order progress`
  - 17. 类型：纯英文注释；行号：808；片段：`Delete a consumable order (only applicant or admin can delete).`

### app/api/deps.py

- 结果：✅ 无问题

### app/api/error_logs.py

- 结果：✅ 无问题

### app/api/events.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`SSE 事件流入口。`

### app/api/inventory.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`Inventory API 路由：库存管理。`

### app/api/inventory_extended_routes.py

- 结果：✅ 无问题

### app/api/reagent_orders.py

- 结果：❌ 发现 12 处问题
  - 1. 类型：多行注释；行号：1；片段：`试剂订单 API 路由：试剂申购流程管理。`
  - 2. 类型：纯英文注释；行号：186；片段：`Add computed specification field to order response dict`
  - 3. 类型：纯英文注释；行号：201；片段：`Get reagent order by ID`
  - 4. 类型：纯英文注释；行号：391；片段：`Normalize CAS Number`
  - 5. 类型：纯英文注释；行号：401；片段：`Parse specification to get initial_quantity and unit`
  - 6. 类型：纯英文注释；行号：423；片段：`Create order`
  - 7. 类型：纯英文注释；行号：558；片段：`Enrich with applicant names`
  - 8. 类型：纯英文注释；行号：583；片段：`--- Export ---`
  - 9. 类型：纯英文注释；行号：589；片段：`Export reagent orders as a downloadable XLSX file.`
  - 10. 类型：纯英文注释；行号：608；片段：`Get CAS overview for duplicate-check hints in forms and expanded rows.`
  - 11. 类型：多行注释；行号：624；片段：`订单：匹配同 CAS 的所有订单。`
  - 12. 类型：纯英文注释；行号：717；片段：`Get reagent order by ID`

### app/api/reagent_orders_workflow.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：735；片段：`Keep delete atomic while preserving legacy API semantics: missing -> 404, unauthorized existing row -> 403.`

### app/api/user_logs.py

- 结果：✅ 无问题

### app/api/user_sessions.py

- 结果：✅ 无问题

### app/api/users.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1073；片段：`重置管理员密码时，要求当前操作者再次验证自己的口令，而不是目标管理员旧口令。`

### app/archive_logs.py

- 结果：✅ 无问题

### app/core/__init__.py

- 结果：✅ 无问题

### app/core/auth.py

- 结果：❌ 发现 6 处问题
  - 1. 类型：纯英文注释；行号：25；片段：`HTTP Bearer token scheme`
  - 2. 类型：纯英文注释；行号：407；片段：`Production must use RS256; HS256 branch is for development fallback only.`
  - 3. 类型：纯英文注释；行号：415；片段：`HS256 development fallback`
  - 4. 类型：纯英文注释；行号：427；片段：`Production must use RS256; HS256 branch is for development fallback only.`
  - 5. 类型：纯英文注释；行号：435；片段：`HS256 development fallback`
  - 6. 类型：多行注释；行号：471；片段：`命中 session 缓存时仍查询一次 User，确保禁用账号/用户名版本变更能立即生效，`

### app/core/banner.py

- 结果：✅ 无问题

### app/core/config.py

- 结果：❌ 发现 21 处问题
  - 1. 类型：纯英文注释；行号：21；片段：`Application`
  - 2. 类型：纯英文注释；行号：28；片段：`Database`
  - 3. 类型：纯英文注释；行号：31；片段：`JWT Authentication`
  - 4. 类型：纯英文注释；行号：36；片段：`RSA Keys for RS256`
  - 5. 类型：纯英文注释；行号：40；片段：`CORS`
  - 6. 类型：纯英文注释；行号：47；片段：`File Upload`
  - 7. 类型：纯英文注释；行号：57；片段：`Default Admin`
  - 8. 类型：纯英文注释；行号：62；片段：`Session & Device Settings (IP Limit Feature)`
  - 9. 类型：纯英文注释；行号：68；片段：`Announcement Settings`
  - 10. 类型：纯英文注释；行号：72；片段：`Redis Configuration (for session caching)`
  - 11. 类型：纯英文注释；行号：79；片段：`CAS Configuration`
  - 12. 类型：纯英文注释；行号：82；片段：`Niutrans Translation API`
  - 13. 类型：纯英文注释；行号：104；片段：`Only generate temporary key in explicit development mode`
  - 14. 类型：纯英文注释；行号：128；片段：`Derive from private key only in explicit development mode`
  - 15. 类型：纯英文注释；行号：148；片段：`Save private key`
  - 16. 类型：纯英文注释；行号：155；片段：`Save public key`
  - 17. 类型：纯英文注释；行号：162；片段：`Ensure directory exists`
  - 18. 类型：纯英文注释；行号：166；片段：`Write keys`
  - 19. 类型：纯英文注释；行号：210；片段：`Global settings instance`
  - 20. 类型：纯英文注释；行号：214；片段：`Paths`
  - 21. 类型：纯英文注释；行号：220；片段：`Ensure directories exist`

### app/core/constants.py

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：166；片段：`SSE runtime tuning`
  - 2. 类型：纯英文注释；行号：166；片段：`SSE runtime tuning`

### app/core/db_compat.py

- 结果：❌ 发现 3 处问题
  - 1. 类型：纯英文注释；行号：15；片段：`Both SQLAlchemy's .returning() and raw-SQL RETURNING require SQLite >= 3.35.0`
  - 2. 类型：纯英文注释；行号：37；片段：`Fallback: fetch the row first, then delete it.`
  - 3. 类型：纯英文注释；行号：57；片段：`Fallback: fetch all matching rows first, then delete them.`

### app/core/redis.py

- 结果：✅ 无问题

### app/core/request_utils.py

- 结果：✅ 无问题

### app/core/time_utils.py

- 结果：✅ 无问题

### app/database.py

- 结果：❌ 发现 15 处问题
  - 1. 类型：纯英文注释；行号：52；片段：`Inventory searchable fields.`
  - 2. 类型：纯英文注释；行号：63；片段：`Reagent order searchable raw-text and pinyin fields.`
  - 3. 类型：纯英文注释；行号：68；片段：`Reagent order searchable pinyin fields.`
  - 4. 类型：纯英文注释；行号：75；片段：`Consumable order searchable raw-text and pinyin fields.`
  - 5. 类型：纯英文注释；行号：79；片段：`Chemical name map searchable pinyin fields.`
  - 6. 类型：纯英文注释；行号：92；片段：`Inventory filter/sort and operational paths.`
  - 7. 类型：纯英文注释；行号：99；片段：`Inventory operation log audit queries.`
  - 8. 类型：纯英文注释；行号：106；片段：`Reagent order operation log audit queries.`
  - 9. 类型：纯英文注释；行号：114；片段：`Consumable order operation log audit queries.`
  - 10. 类型：纯英文注释；行号：122；片段：`User operation log audit queries.`
  - 11. 类型：纯英文注释；行号：128；片段：`Borrow log operational queries.`
  - 12. 类型：纯英文注释；行号：131；片段：`Reagent/consumable list status + applicant filters.`
  - 13. 类型：纯英文注释；行号：145；片段：`Common shelf filters and grouping.`
  - 14. 类型：纯英文注释；行号：151；片段：`Chemical name map filtering.`
  - 15. 类型：纯英文注释；行号：153；片段：`Common shelf operation log audit queries.`

### app/main.py

- 结果：❌ 发现 6 处问题
  - 1. 类型：纯英文注释；行号：74；片段：`Configure logging`
  - 2. 类型：纯英文注释；行号：95；片段：`Mask numeric ids and long opaque tokens/UUID-like segments.`
  - 3. 类型：纯英文注释；行号：211；片段：`Add cache headers for static files (images, fonts, etc.)`
  - 4. 类型：纯英文注释；行号：239；片段：`Create FastAPI application`
  - 5. 类型：纯英文注释；行号：392；片段：`CORS middleware - must be added AFTER exception handlers`
  - 6. 类型：纯英文注释；行号：440；片段：`Mount static files with caching`

### app/models/__init__.py

- 结果：❌ 发现 7 处问题
  - 1. 类型：纯英文注释；行号：72；片段：`Base`
  - 2. 类型：纯英文注释；行号：74；片段：`User`
  - 3. 类型：纯英文注释；行号：79；片段：`Session`
  - 4. 类型：纯英文注释；行号：82；片段：`Inventory`
  - 5. 类型：纯英文注释；行号：110；片段：`Reagent Order`
  - 6. 类型：纯英文注释；行号：117；片段：`Consumable Order`
  - 7. 类型：纯英文注释；行号：123；片段：`Announcement`

### app/models/announcement.py

- 结果：✅ 无问题

### app/models/base.py

- 结果：✅ 无问题

### app/models/chemical_name_map.py

- 结果：✅ 无问题

### app/models/common_shelf.py

- 结果：✅ 无问题

### app/models/common_shelf_operation_log.py

- 结果：✅ 无问题

### app/models/consumable_order.py

- 结果：❌ 发现 4 处问题
  - 1. 类型：纯英文注释；行号：27；片段：`Chinese name (with index for query)`
  - 2. 类型：纯英文注释；行号：29；片段：`English name`
  - 3. 类型：纯英文注释；行号：39；片段：`Price`
  - 4. 类型：纯英文注释；行号：43；片段：`Notes`

### app/models/consumable_order_operation_log.py

- 结果：✅ 无问题

### app/models/inventory.py

- 结果：❌ 发现 5 处问题
  - 1. 类型：纯英文注释；行号：28；片段：`Critical: CAS Number copied from Order (already normalized)`
  - 2. 类型：纯英文注释；行号：50；片段：`Search/sort acceleration: keep indexes that can actually hit B-Tree paths.`
  - 3. 类型：纯英文注释；行号：85；片段：`Unique internal code: e.g., "64175-250113-001" (CAS-Date-Sequence)`
  - 4. 类型：纯英文注释；行号：224；片段：`Computed field: specification (e.g., "500ml")`
  - 5. 类型：纯英文注释；行号：226；片段：`Computed fields: user names`

### app/models/inventory_operation_log.py

- 结果：❌ 发现 9 处问题
  - 1. 类型：多行注释；行号：27；片段：`snapshot_json short-key contract:`
  - 2. 类型：纯英文注释；行号：27；片段：`snapshot_json short-key contract:`
  - 3. 类型：纯英文注释；行号：28；片段：`id=inventory row id, ic=internal_code, ca=cas_number, na=name, en=english_name,`
  - 4. 类型：纯英文注释；行号：29；片段：`al=alias, cg=category, br=brand, pu=purity, sl=storage_location, iq=initial_quantity,`
  - 5. 类型：纯英文注释；行号：30；片段：`rq=remaining_quantity, rp=remaining_percent, un=unit, hz=is_hazardous,`
  - 6. 类型：纯英文注释；行号：31；片段：`nt=notes, bi=borrower_id, lb=last_borrower_id,`
  - 7. 类型：纯英文注释；行号：32；片段：`tk=temporary_keeper_id, oi=source_order_id, cb=created_by_id, cr=created_at,`
  - 8. 类型：纯英文注释；行号：33；片段：`up=updated_at, sc=source, ct=count(export only), cq=consumed_quantity,`
  - 9. 类型：纯英文注释；行号：34；片段：`bf=before(update only), af=after(update only)`

### app/models/reagent_order.py

- 结果：❌ 发现 14 处问题
  - 1. 类型：纯英文注释；行号：41；片段：`CAS Number - Critical field for reagents`
  - 2. 类型：纯英文注释；行号：43；片段：`Chinese name (with index for query and pinyin for sorting)`
  - 3. 类型：纯英文注释；行号：45；片段：`English name`
  - 4. 类型：纯英文注释；行号：49；片段：`Category (with index for query and pinyin for sorting)`
  - 5. 类型：纯英文注释；行号：51；片段：`Brand (with index for query and pinyin for sorting)`
  - 6. 类型：纯英文注释；行号：53；片段：`Purity / grade (e.g. 95%, AR, HPLC)`
  - 7. 类型：纯英文注释；行号：57；片段：`Unit (e.g., "ml", "g", "L")`
  - 8. 类型：纯英文注释；行号：59；片段：`Quantity ordered (number of bottles)`
  - 9. 类型：纯英文注释；行号：61；片段：`Price`
  - 10. 类型：多行注释；行号：63；片段：`Order reason`
  - 11. 类型：纯英文注释；行号：63；片段：`Order reason`
  - 12. 类型：纯英文注释；行号：64；片段：`Order reason (optional, frontend must provide when creating)`
  - 13. 类型：纯英文注释；行号：78；片段：`Hazardous flag`
  - 14. 类型：纯英文注释；行号：80；片段：`Notes`

### app/models/reagent_order_operation_log.py

- 结果：✅ 无问题

### app/models/runtime_state.py

- 结果：✅ 无问题

### app/models/user.py

- 结果：✅ 无问题

### app/models/user_operation_log.py

- 结果：✅ 无问题

### app/models/user_session.py

- 结果：✅ 无问题

### app/services/__init__.py

- 结果：✅ 无问题

### app/services/api_utils.py

- 结果：✅ 无问题

### app/services/audit_logger.py

- 结果：✅ 无问题

### app/services/cache_reset_service.py

- 结果：✅ 无问题

### app/services/cas_utils.py

- 结果：❌ 发现 10 处问题
  - 1. 类型：纯英文注释；行号：38；片段：`Remove all whitespace`
  - 2. 类型：多行注释；行号：83；片段：``validate_and_normalize_cas` passes normalized input, so compare directly`
  - 3. 类型：纯英文注释；行号：83；片段：``validate_and_normalize_cas` passes normalized input, so compare directly`
  - 4. 类型：纯英文注释；行号：84；片段：`here to avoid a second normalize pass via `is_special_cas_value`.`
  - 5. 类型：纯英文注释；行号：88；片段：`Check basic pattern`
  - 6. 类型：纯英文注释；行号：92；片段：`Split and validate structure`
  - 7. 类型：纯英文注释；行号：97；片段：`Extract parts`
  - 8. 类型：纯英文注释；行号：102；片段：`Combine first two parts as sequence number`
  - 9. 类型：纯英文注释；行号：105；片段：`Calculate expected check digit`
  - 10. 类型：纯英文注释；行号：109；片段：`Validate check digit`

### app/services/chemical_info.py

- 结果：✅ 无问题

### app/services/chemical_name_map_fts.py

- 结果：✅ 无问题

### app/services/common_shelf_creation.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：162；片段：`Savepoint rollback only affects this batch, preserving outer confirm-arrival updates.`

### app/services/common_shelf_operation_logger.py

- 结果：✅ 无问题

### app/services/common_shelf_queries.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：577；片段：`Keep window ranking constrained to the filtered subset to avoid full-table scans.`

### app/services/error_logger.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：77；片段：`匹配 key=value 或 key: value 格式，要求前面有空格或开头`

### app/services/excel_service.py

- 结果：✅ 无问题

### app/services/image_service.py

- 结果：✅ 无问题

### app/services/internal_code.py

- 结果：❌ 发现 7 处问题
  - 1. 类型：纯英文注释；行号：19；片段：`UPDATE ... RETURNING requires SQLite >= 3.35.0`
  - 2. 类型：纯英文注释；行号：101；片段：`Use lazy bootstrap so runtime can upgrade old DBs without a separate migration release.`
  - 3. 类型：纯英文注释；行号：125；片段：`Reserve the whole range in one atomic operation to avoid check-then-insert races.`
  - 4. 类型：纯英文注释；行号：150；片段：`Fallback for SQLite < 3.35: UPDATE then SELECT within the same transaction.`
  - 5. 类型：多行注释；行号：198；片段：`Validate CAS number to prevent SQL injection`
  - 6. 类型：纯英文注释；行号：198；片段：`Validate CAS number to prevent SQL injection`
  - 7. 类型：纯英文注释；行号：199；片段：`CAS should only contain digits and hyphens`

### app/services/inventory_creation.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：89；片段：`Full rollback is required here because this path does not use nested savepoints.`

### app/services/inventory_fts.py

- 结果：✅ 无问题

### app/services/inventory_import_preview_sessions.py

- 结果：✅ 无问题

### app/services/inventory_operation_logger.py

- 结果：✅ 无问题

### app/services/inventory_queries.py

- 结果：✅ 无问题

### app/services/order_fts.py

- 结果：✅ 无问题

### app/services/order_operation_logger.py

- 结果：✅ 无问题

### app/services/pinyin_utils.py

- 结果：✅ 无问题

### app/services/rate_limit.py

- 结果：✅ 无问题

### app/services/search_matchers.py

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：110；片段：`Prefix LIKE can use B-Tree index on normalized CAS column.`
  - 2. 类型：纯英文注释；行号：132；片段：`Ignore hour/minute/second. Keep at most yyyyMMdd.`

### app/services/session_service.py

- 结果：✅ 无问题

### app/services/shelf_utils.py

- 结果：✅ 无问题

### app/services/spec_utils.py

- 结果：❌ 发现 6 处问题
  - 1. 类型：纯英文注释；行号：10；片段：`Canonical unit form mapping (lowercase -> display form)`
  - 2. 类型：纯英文注释；行号：53；片段：`Normalize unit to canonical form (e.g., "ml" -> "mL")`
  - 3. 类型：纯英文注释；行号：56；片段：`Format number: integer without decimals, float with decimals`
  - 4. 类型：多行注释；行号：82；片段：`Pattern: number + optional space + unit`
  - 5. 类型：纯英文注释；行号：82；片段：`Pattern: number + optional space + unit`
  - 6. 类型：纯英文注释；行号：83；片段：`Use (\d+(?:\.\d+)?) to avoid matching invalid formats like "1.5.5"`

### app/services/sql_utils.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：27；片段：`使用 reduce 动态生成嵌套的 func.replace`

### app/services/sse_manager.py

- 结果：❌ 发现 9 处问题
  - 1. 类型：纯英文注释；行号：129；片段：`Reclaim empty rooms to avoid unbounded in-memory room growth.`
  - 2. 类型：纯英文注释；行号：209；片段：`Queue full means client is too slow; drop and eventually disconnect.`
  - 3. 类型：纯英文注释；行号：226；片段：`Client may already be disconnected by another coroutine.`
  - 4. 类型：多行注释；行号：262；片段：`Drop already-buffered business events so revocation is the next thing the`
  - 5. 类型：纯英文注释；行号：262；片段：`Drop already-buffered business events so revocation is the next thing the`
  - 6. 类型：纯英文注释；行号：263；片段：`client sees. Otherwise a kicked session can still consume stale messages.`
  - 7. 类型：纯英文注释；行号：338；片段：`Extract room from channel with prefix: "lsm:sse:room-123" -> "room-123"`
  - 8. 类型：纯英文注释；行号：360；片段：`Already pushed locally by this process.`
  - 9. 类型：纯英文注释；行号：502；片段：`Stop stream quickly when client is removed (e.g., slow client governance).`

### app/services/sse_redis.py

- 结果：✅ 无问题

### app/services/user_operation_logger.py

- 结果：✅ 无问题

### app/services/user_service.py

- 结果：✅ 无问题

### app/services/user_utils.py

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：21；片段：`Filter out None values`

### app/services/xlsx_export.py

- 结果：✅ 无问题

### browser-extension/background/cart-tab-selection.js

- 结果：✅ 无问题

### browser-extension/background/service-worker.js

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`// 购物车同步 - Service Worker // 处理跨标签页通信和后端API调用`

### browser-extension/content/import-bridge.js

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：1；片段：`// 导入桥接脚本 // 在系统 /import 页面读取扩展存储中的批次数据，并写入页面 localStorage。`
  - 2. 类型：纯英文注释；行号：45；片段：`ignore storage cleanup errors`

### browser-extension/content/script.js

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：1；片段：`// 购物车同步 - Content Script // 购物车页面：只获取产品ID、数量、价格、详情页URL`
  - 2. 类型：多行注释；行号：137；片段：`// 2. 获取购物车项ID - 从元素ID或checkbox value获取 // 元素ID格式: cpdiv807440`

### browser-extension/popup/order-type-detection.js

- 结果：✅ 无问题

### browser-extension/popup/popup.html

- 结果：✅ 无问题

### browser-extension/popup/popup.js

- 结果：❌ 发现 3 处问题
  - 1. 类型：多行注释；行号：1；片段：`// 购物车同步 - Popup Script // 直接与内容脚本通信，不依赖 service worker`
  - 2. 类型：多行注释；行号：216；片段：`// 表格结构固定，直接匹配 td-2 中的内容 // 注意：</td> 和 <td> 之间可能有换行和空格`
  - 3. 类型：纯英文注释；行号：336；片段：`ignore malformed app-ui`

### browser-extension/shared/site-config.js

- 结果：✅ 无问题

### docker-compose.yml

- 结果：✅ 无问题

### docker/backend/entrypoint.sh

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：1；片段：`!/bin/sh`

### docker/nginx/default.conf

- 结果：✅ 无问题

### docker/nginx/nginx.conf

- 结果：✅ 无问题

### frontend/eslint.config.js

- 结果：❌ 发现 3 处问题
  - 1. 类型：多行注释；行号：10；片段：`/*.css"]), { files: ["**/`
  - 2. 类型：纯英文注释；行号：10；片段：`.css"]),`
  - 3. 类型：纯英文注释；行号：12；片段：`files: ["*`

### frontend/index.html

- 结果：✅ 无问题

### frontend/postcss.config.js

- 结果：✅ 无问题

### frontend/public/lib/RDKit_minimal.js

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：16；片段：`// This default export looks redundant, but it allows TS to import this // commonjs style module.`
  - 2. 类型：纯英文注释；行号：16；片段：`This default export looks redundant, but it allows TS to import this`

### frontend/scripts/lib-assets.mjs

- 结果：✅ 无问题

### frontend/src/App.tsx

- 结果：✅ 无问题

### frontend/src/api/client.ts

- 结果：❌ 发现 19 处问题
  - 1. 类型：纯英文注释；行号：65；片段：`Response interceptor to handle auth errors`
  - 2. 类型：纯英文注释；行号：90；片段：`Paginated response type`
  - 3. 类型：纯英文注释；行号：105；片段：`Reagent Order Status Enum`
  - 4. 类型：纯英文注释；行号：114；片段：`Reagent Order Reason Enum`
  - 5. 类型：纯英文注释；行号：126；片段：`Consumable Order Status Enum`
  - 6. 类型：纯英文注释；行号：134；片段：`Consumable Order Reason Enum`
  - 7. 类型：纯英文注释；行号：146；片段：`Session Info type for device management`
  - 8. 类型：纯英文注释；行号：159；片段：`Auth APIs`
  - 9. 类型：纯英文注释；行号：174；片段：`Session APIs (Device Management)`
  - 10. 类型：纯英文注释；行号：184；片段：`User Admin APIs`
  - 11. 类型：纯英文注释；行号：224；片段：`Reagent Order APIs`
  - 12. 类型：纯英文注释；行号：301；片段：`Consumable Order APIs (new)`
  - 13. 类型：纯英文注释；行号：357；片段：`Inventory APIs`
  - 14. 类型：纯英文注释；行号：560；片段：`Chemical Info APIs`
  - 15. 类型：纯英文注释；行号：575；片段：`Announcement types`
  - 16. 类型：纯英文注释；行号：596；片段：`Announcement APIs`
  - 17. 类型：纯英文注释；行号：631；片段：`User Operation Logs APIs`
  - 18. 类型：多行注释；行号：657；片段：`// 创建日志 API 适配器（用于 FilterTable） // 注意：FilterTable 使用 status_filter 参数，但日志 API 需要 log_type，需要转换`
  - 19. 类型：多行注释；行号：673；片段：`// 将 status_filter 转换为 log_type（FilterTable 使用 status_filter，日志 API 需要 log_type） // 注意：'all' 表示全部类型，不传参给后端`

### frontend/src/components/AnnouncementBanner.tsx

- 结果：✅ 无问题

### frontend/src/components/AnnouncementButton.tsx

- 结果：✅ 无问题

### frontend/src/components/AnnouncementDetail.tsx

- 结果：✅ 无问题

### frontend/src/components/AuthDeferredShell.tsx

- 结果：✅ 无问题

### frontend/src/components/BaseForm.tsx

- 结果：✅ 无问题

### frontend/src/components/BorrowDialog.tsx

- 结果：✅ 无问题

### frontend/src/components/BugReportButton.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * BugReportButton - Bug反馈按钮组件 * * 点击后： * 1. 获取前端错误日志 * 2. 获取后端错误日志（需要管理员权限） * 3. 生成日志文件并下载 * 4. 打开mailto链...`

### frontend/src/components/CartImportLoadingScreen.tsx

- 结果：✅ 无问题

### frontend/src/components/CommonShelfDialogs.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：56；片段：`// 常用货架弹窗统一使用分组 controller。 // 页面层只关心 state/forms/actions/itemEdit 四类职责，避免继续平铺几十个字段来回透传。`
  - 2. 类型：多行注释；行号：143；片段：`// 通用的取消/提交按钮区。 // 各业务模式只保留自己的字段和文案，不再重复写一整段按钮布局。`

### frontend/src/components/ConsumableOrderExpandedRow.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 耗材订单展开行组件（共享） * 用于 Dashboard 耗材订单 Tab 和 ConsumableOrders 页面 * 展示英文名称、货号、价格、备注，可选显示申购时间和订购人 */`

### frontend/src/components/EditDialogActions.tsx

- 结果：✅ 无问题

### frontend/src/components/ErrorBoundary.tsx

- 结果：✅ 无问题

### frontend/src/components/ReagentCasDuplicateWarning.tsx

- 结果：✅ 无问题

### frontend/src/components/ReagentOrderExpandedRow.tsx

- 结果：✅ 无问题

### frontend/src/components/SidebarLogo.tsx

- 结果：✅ 无问题

### frontend/src/components/TableActionButtons.tsx

- 结果：✅ 无问题

### frontend/src/components/UserEditDialog.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/AutoComplete.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Avatar.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Button.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Card.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Checkbox.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/DataTable.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：158；片段：`eslint-disable-next-line react-hooks/incompatible-library`

### frontend/src/components/ui/DataTableBody.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * DataTable 表体组件 * 从 DataTable 中提取的虚拟化/非虚拟化行渲染、加载更多、空状态 */`

### frontend/src/components/ui/DataTableHeader.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * DataTable 表头组件 * 从 DataTable 中提取的表头渲染逻辑：排序、列宽调整手柄、Tooltip */`

### frontend/src/components/ui/Dialog.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/FilterTable.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：632；片段：`eslint-disable-next-line react-hooks/incompatible-library`

### frontend/src/components/ui/FormField.tsx

- 结果：❌ 发现 8 处问题
  - 1. 类型：多行注释；行号：13；片段：`/** * FormField - 表单字段组合组件 * 封装 Label + Input/Select + ErrorMessage 的组合 * 支持语义化颜色和 dark mode * * 使用示例: * ```ts...`
  - 2. 类型：纯英文注释；行号：19；片段：````tsx`
  - 3. 类型：纯英文注释；行号：21；片段：`<Input`
  - 4. 类型：纯英文注释；行号：22；片段：`id="add_spec"`
  - 5. 类型：纯英文注释；行号：23；片段：`value={formData.specification}`
  - 6. 类型：纯英文注释；行号：24；片段：`onChange={(e) => handleChange('specification', e.target.value)}`
  - 7. 类型：纯英文注释；行号：25；片段：`className={cn(INPUT_STYLES.lg, error && 'border-destructive')}`
  - 8. 类型：纯英文注释；行号：27；片段：`</FormField>`

### frontend/src/components/ui/HazardousIcon.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：15；片段：`/** * 危险品图标组件 * 显示危险品警告标识 */`

### frontend/src/components/ui/HighlightText.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Input.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Label.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/LoadingButton.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/MoleculeStructure.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/NoteDisplay.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Pagination.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/PasswordInput.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：8；片段：`/** * 密码输入框组件 * 支持显示/隐藏密码切换 */`

### frontend/src/components/ui/QuantityIndicator.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/RadioGroup.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Select.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Separator.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/StaleBanner.tsx

- 结果：❌ 发现 3 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * Banner shown when list snapshot is considered structurally stale. * * Keep it independent so each page can o...`
  - 2. 类型：纯英文注释；行号：2；片段：`Banner shown when list snapshot is considered structurally stale.`
  - 3. 类型：纯英文注释；行号：4；片段：`Keep it independent so each page can opt in with minimal wiring.`

### frontend/src/components/ui/StatusBadge.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：10；片段：`/** * 通用状态标签组件 * 自动根据 status 映射到对应颜色 */`

### frontend/src/components/ui/TableFilters.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Tabs.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Textarea.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Toast.tsx

- 结果：✅ 无问题

### frontend/src/components/ui/Tooltip.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：8；片段：`// 给 tooltip 加入一个小的延迟，避免在侧边栏折叠/动画过程中 // 因短暂经过触发区域而打开大量 tooltip`

### frontend/src/fontLoader.ts

- 结果：✅ 无问题

### frontend/src/hooks/useBulkExpand.ts

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 批量展开/折叠动画 Hook * 从 DataTable 中提取的锚点定位和动画管理逻辑 */`
  - 2. 类型：多行注释；行号：29；片段：`/** * 批量展开动画完成后的多帧测量和锚点恢复 * 提取为独立函数以避免嵌套回调过深 */`

### frontend/src/hooks/useColumnResize.ts

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 列宽拖拽调整 Hook * 从 DataTable 中提取的纯逻辑 Hook */`

### frontend/src/hooks/useDataTableScroll.ts

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 表格行点击展开时的滚动定位 Hook * 从 DataTable 中提取的行点击展开和平滑滚动逻辑 */`

### frontend/src/hooks/useDialogState.tsx

- 结果：❌ 发现 5 处问题
  - 1. 类型：多行注释；行号：3；片段：`/** * Custom hook for confirm dialog * @param initialState string | null * @returns A stateful value, and a functi...`
  - 2. 类型：纯英文注释；行号：4；片段：`Custom hook for confirm dialog`
  - 3. 类型：纯英文注释；行号：5；片段：`@param initialState string | null`
  - 4. 类型：纯英文注释；行号：6；片段：`@returns A stateful value, and a function to update it.`
  - 5. 类型：纯英文注释；行号：7；片段：`@example const [open, setOpen] = useDialogState<"approve" | "reject">()`

### frontend/src/hooks/useErrorLogger.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * useErrorLogger - 前端错误日志收集Hook * * 自动捕获前端控制台错误和网络请求错误 * 日志仅保存在内存中，页面刷新后清除（保护隐私） */`

### frontend/src/hooks/useFormModal.tsx

- 结果：❌ 发现 18 处问题
  - 1. 类型：多行注释；行号：3；片段：`/** * 验证规则类型 * 每个规则包含字段名和对应的验证函数 */`
  - 2. 类型：多行注释；行号：44；片段：`/** * 通用表单Modal Hook * 封装表单状态管理、验证和提交流逻辑 * * @example * ```tsx * const { * formData, * formErrors, * ...`
  - 3. 类型：纯英文注释；行号：48；片段：`@example`
  - 4. 类型：纯英文注释；行号：49；片段：````tsx`
  - 5. 类型：纯英文注释；行号：50；片段：`const {`
  - 6. 类型：纯英文注释；行号：51；片段：`formData,`
  - 7. 类型：纯英文注释；行号：52；片段：`formErrors,`
  - 8. 类型：纯英文注释；行号：53；片段：`submitting,`
  - 9. 类型：纯英文注释；行号：54；片段：`handleChange,`
  - 10. 类型：纯英文注释；行号：55；片段：`validateForm,`
  - 11. 类型：纯英文注释；行号：56；片段：`resetForm,`
  - 12. 类型：纯英文注释；行号：57；片段：`handleSubmit`
  - 13. 类型：纯英文注释；行号：58；片段：`} = useFormModal({`
  - 14. 类型：纯英文注释；行号：59；片段：`initialData: { name: '', quantity: 0 },`
  - 15. 类型：纯英文注释；行号：60；片段：`validationRules: [`
  - 16. 类型：纯英文注释；行号：64；片段：`onSubmit: async (data) => {`
  - 17. 类型：纯英文注释；行号：65；片段：`await api.save(data)`
  - 18. 类型：多行注释；行号：101；片段：`/** * 验证表单 * @returns 验证是否通过 */`

### frontend/src/hooks/useListSSE.ts

- 结果：❌ 发现 6 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * List-focused SSE integration hook. * * Policy: * - Stable row-field updates are patched locally. * - Struc...`
  - 2. 类型：纯英文注释；行号：2；片段：`List-focused SSE integration hook.`
  - 3. 类型：纯英文注释；行号：4；片段：`Policy:`
  - 4. 类型：纯英文注释；行号：5；片段：`- Stable row-field updates are patched locally.`
  - 5. 类型：纯英文注释；行号：6；片段：`- Structural changes only patch when they are obviously safe.`
  - 6. 类型：纯英文注释；行号：7；片段：`- Ambiguous cases fall back to stale banner refresh.`

### frontend/src/hooks/useMobile.tsx

- 结果：✅ 无问题

### frontend/src/hooks/useReagentCasDuplicateCheck.ts

- 结果：✅ 无问题

### frontend/src/hooks/useRememberedUser.ts

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：11；片段：`/** * Hook: 记住用户信息 * 用于实现类似微软锁屏的登录体验 * - 登录成功后自动保存用户信息（无需勾选） * - Session 过期后显示锁屏模式，只需输入密码 * - 修改用户名时清除记住信息，修改头像自...`

### frontend/src/hooks/useSSE.ts

- 结果：❌ 发现 7 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * Generic SSE hook for room-based event streams. * * Integration: * 1) Build event handlers in page/domain ho...`
  - 2. 类型：纯英文注释；行号：2；片段：`Generic SSE hook for room-based event streams.`
  - 3. 类型：纯英文注释；行号：4；片段：`Integration:`
  - 4. 类型：纯英文注释；行号：5；片段：`1) Build event handlers in page/domain hook.`
  - 5. 类型：纯英文注释；行号：6；片段：`2) Call useSSE({ rooms, handlers }).`
  - 6. 类型：纯英文注释；行号：7；片段：`3) Use store stale flag to show refresh banner.`
  - 7. 类型：纯英文注释；行号：106；片段：`keep fallback reason`

### frontend/src/hooks/useTableState.tsx

- 结果：✅ 无问题

### frontend/src/hooks/useTableUrlState.ts

- 结果：✅ 无问题

### frontend/src/hooks/useTheme.ts

- 结果：✅ 无问题

### frontend/src/index.css

- 结果：❌ 发现 4 处问题
  - 1. 类型：纯英文注释；行号：165；片段：`Prevent focus zoom on mobile devices`
  - 2. 类型：纯英文注释；行号：356；片段：`Marquee Animation for Announcement Banner`
  - 3. 类型：纯英文注释；行号：358；片段：`index.css`
  - 4. 类型：纯英文注释；行号：360；片段：`index.css`

### frontend/src/lib/apiConfig.ts

- 结果：✅ 无问题

### frontend/src/lib/authSession.ts

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：30；片段：`eslint-disable-next-line sonarjs/no-hardcoded-passwords`
  - 2. 类型：纯英文注释；行号：32；片段：`eslint-disable-next-line sonarjs/no-hardcoded-passwords`

### frontend/src/lib/cacheVersionBootstrap.ts

- 结果：❌ 发现 5 处问题
  - 1. 类型：纯英文注释；行号：35；片段：`ignore storage errors`
  - 2. 类型：纯英文注释；行号：43；片段：`ignore storage errors`
  - 3. 类型：纯英文注释；行号：139；片段：`ignore network errors; backend startup reset already invalidates old sessions`
  - 4. 类型：纯英文注释；行号：152；片段：`ignore storage errors`
  - 5. 类型：纯英文注释；行号：158；片段：`ignore storage errors`

### frontend/src/lib/chemicalProperties.ts

- 结果：✅ 无问题

### frontend/src/lib/constants.ts

- 结果：❌ 发现 12 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * Centralized mapping tables for status/reason/role display * Backend stores English values; frontend maps to C...`
  - 2. 类型：纯英文注释；行号：2；片段：`Centralized mapping tables for status/reason/role display`
  - 3. 类型：纯英文注释；行号：3；片段：`Backend stores English values; frontend maps to Chinese.`
  - 4. 类型：纯英文注释；行号：6；片段：`=== UI Component Styles ===`
  - 5. 类型：纯英文注释；行号：19；片段：`=== Status Badge Colors ===`
  - 6. 类型：纯英文注释；行号：114；片段：`=== Session Storage Keys ===`
  - 7. 类型：纯英文注释；行号：119；片段：`=== Order Status (Reagent) ===`
  - 8. 类型：纯英文注释；行号：136；片段：`=== Order Status (Consumable) ===`
  - 9. 类型：纯英文注释；行号：152；片段：`=== Inventory Status ===`
  - 10. 类型：纯英文注释；行号：177；片段：`=== Order Reason ===`
  - 11. 类型：纯英文注释；行号：187；片段：`=== User Role ===`
  - 12. 类型：纯英文注释；行号：213；片段：`=== Import Template Columns ===`

### frontend/src/lib/dashboardUtils.tsx

- 结果：❌ 发现 5 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * Dashboard 共享工具函数、类型定义和常量 * 纯工具文件，不包含 React 组件（避免 react-refresh/only-export-components 规则冲突） */`
  - 2. 类型：多行注释；行号：92；片段：`/** * 清除 Dashboard Tab 持久化状态 * 用于退出登录时清理用户特定的状态 */`
  - 3. 类型：纯英文注释；行号：100；片段：`ignore localStorage errors`
  - 4. 类型：多行注释；行号：140；片段：`/** * 广播“仪表盘统计需要刷新”的信号。 * 存在原因：统计卡片使用轻量缓存，子 Tab 完成变更后需要显式通知顶部卡片同步更新。 */`
  - 5. 类型：多行注释；行号：151；片段：`/** * 订阅“仪表盘统计需要刷新”的信号，并返回清理函数。 * 存在原因：让 Dashboard 容器可以在子 Tab 触发变更后重新拉取统计数字。 */`

### frontend/src/lib/formConfigs.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：141；片段：`// 试剂订单默认值 // 注意：price 和 order_reason 验证为必填，但默认值允许为空（用户必须手动选择/输入）`
  - 2. 类型：多行注释；行号：288；片段：`/** * 获取归还表单字段配置 * @param mode 归还模式（remaining 或 used） * @param maxQuantity 最大数量（原借用时的剩余量） */`

### frontend/src/lib/inputConfigs.ts

- 结果：✅ 无问题

### frontend/src/lib/options.ts

- 结果：❌ 发现 9 处问题
  - 1. 类型：纯英文注释；行号：65；片段：`B`
  - 2. 类型：纯英文注释；行号：69；片段：`E-F`
  - 3. 类型：纯英文注释；行号：73；片段：`G`
  - 4. 类型：纯英文注释；行号：78；片段：`I-J`
  - 5. 类型：纯英文注释；行号：82；片段：`L`
  - 6. 类型：纯英文注释；行号：85；片段：`M`
  - 7. 类型：纯英文注释；行号：90；片段：`O`
  - 8. 类型：纯英文注释；行号：93；片段：`S`
  - 9. 类型：纯英文注释；行号：97；片段：`T`

### frontend/src/lib/orderSubmitHelpers.ts

- 结果：✅ 无问题

### frontend/src/lib/sseEvents.ts

- 结果：✅ 无问题

### frontend/src/lib/sseRuntime.ts

- 结果：✅ 无问题

### frontend/src/lib/staticAssets.ts

- 结果：✅ 无问题

### frontend/src/lib/storage/appAuthMetaStorage.ts

- 结果：✅ 无问题

### frontend/src/lib/storage/appTableStorage.ts

- 结果：✅ 无问题

### frontend/src/lib/storage/appUiStorage.ts

- 结果：✅ 无问题

### frontend/src/lib/storage/localStorageCore.ts

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：40；片段：`ignore storage errors`
  - 2. 类型：纯英文注释；行号：71；片段：`ignore storage errors`

### frontend/src/lib/tableConfigs.tsx

- 结果：❌ 发现 3 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 表格列配置抽离 * 仿照 formConfigs.tsx 模式，集中管理表格列配置 * * 使用方式： * import { getInventoryTableColumns } from '@/lib/tab...`
  - 2. 类型：纯英文注释；行号：6；片段：`import { getInventoryTableColumns } from '@/lib/tableConfigs'`
  - 3. 类型：纯英文注释；行号：7；片段：`const columns = getInventoryTableColumns()`

### frontend/src/lib/toast.ts

- 结果：✅ 无问题

### frontend/src/lib/utils.ts

- 结果：❌ 发现 3 处问题
  - 1. 类型：多行注释；行号：41；片段：`// 处理备注字段：保留标签前缀，只移除内容为空的标签 // 支持所有在 inputConfigs 中定义的标签`
  - 2. 类型：多行注释；行号：61；片段：`/** * 库存借用状态标签 * 用于试剂订单展开行和仪表盘中显示库存借用状态 */`
  - 3. 类型：多行注释；行号：75；片段：`/** * 安全地将 unknown 值转换为字符串 * 用于处理 API 返回的可能为 null/undefined/非字符串的值 */`

### frontend/src/lib/validationSchemas.ts

- 结果：❌ 发现 22 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * Valibot 验证 Schemas * 使用方法: * ```tsx * import { useForm } from 'react-hook-form' * import { valibotResolver...`
  - 2. 类型：纯英文注释；行号：4；片段：````tsx`
  - 3. 类型：纯英文注释；行号：5；片段：`import { useForm } from 'react-hook-form'`
  - 4. 类型：纯英文注释；行号：6；片段：`import { valibotResolver } from '@hookform/resolvers/valibot'`
  - 5. 类型：纯英文注释；行号：9；片段：`const form = useForm({`
  - 6. 类型：纯英文注释；行号：11；片段：`defaultValues: {...}`
  - 7. 类型：多行注释；行号：50；片段：`/** * 必填字符串验证 - 替代 validateRequired * @param fieldName 字段中文名称 */`
  - 8. 类型：多行注释；行号：61；片段：`/** * 字符串长度验证 - 替代 validateStringLength * @param fieldName 字段中文名称 * @param min 最小长度 * @param max 最大长度 */`
  - 9. 类型：多行注释；行号：79；片段：`/** * 字符串最大长度验证 - 仅验证最大长度，不限制最小值 * @param fieldName 字段中文名称 * @param max 最大长度 */`
  - 10. 类型：多行注释；行号：94；片段：`/** * 正整数验证 (>=1) - 用于瓶数等必须为整数的字段 * 支持字符串和数字输入，在 handleSubmit 中手动转换 * 注意：不包含上限限制，具体上限由使用处单独定义 * @param fieldName ...`
  - 11. 类型：多行注释；行号：109；片段：`/** * 正数验证 (可小数) - 用于初始量等可以是小数 quantity 的字段 * 支持字符串和数字输入 * @param fieldName 字段中文名称 */`
  - 12. 类型：多行注释；行号：122；片段：`/** * 非负数验证 - 用于剩余量等可以为0的字段 * 支持字符串和数字输入 * @param fieldName 字段中文名称 */`
  - 13. 类型：多行注释；行号：135；片段：`/** * 剩余量验证 - 用于编辑时验证剩余量不超过初始量 * 支持字符串和数字输入 * @param fieldName 字段中文名称 * @param maxValue 最大值（初始量） */`
  - 14. 类型：多行注释；行号：150；片段：`/** * 价格验证 - 替代 validatePrice * 支持字符串和数字输入 * @param min 最小值 * @param max 最大值 */`
  - 15. 类型：多行注释；行号：178；片段：`/** * 规格验证 - 替代 validateSpecification * 支持格式: 500ml, 1L, 100g, 500 ml, 1.5L 等 */`
  - 16. 类型：多行注释；行号：203；片段：`/** * CAS 校验码计算逻辑 * CAS号格式：三部分组成，第一部分2-6位数字，第二部分2位数字，第三部分1位校验码 * 校验码计算：将第一二部分的数字从右到左依次乘以1,2,3...，求和后取模10 */`
  - 17. 类型：多行注释；行号：240；片段：`/** * CAS号验证 - 替代 validateCASNumber & normalizeCASNumber * 自动标准化：大写 + 去除空格 */`
  - 18. 类型：多行注释；行号：297；片段：`/** * 剩余量验证（非负数，允许0，但不能是null/undefined/空字符串） * 使用 v.union 在最外层拒绝空字符串 * 注意：此 Schema 用于基础验证，编辑模式下 additional 验证在 han...`
  - 19. 类型：多行注释；行号：312；片段：`/** * 库存表单 Schema * remaining_quantity 可选（后端自动计算等于 initial_quantity） * 编辑模式下 remaining_quantity 必填的验证在 handleFormS...`
  - 20. 类型：多行注释；行号：407；片段：`/** * 试剂订单 Schema * 前端输入: specification (规格字符串，如 500ml) * 后端处理: 拆分为 initial_quantity 和 unit */`
  - 21. 类型：多行注释；行号：523；片段：`/** * 归还数量验证 Schema - 用于验证归还时的剩余量或使用量 * 支持字符串和数字输入 * @param fieldName 字段中文名称（如"剩余量"或"使用量"） * @param maxValue 最大值（...`
  - 22. 类型：多行注释；行号：586；片段：`/** * 安全的值转换为字符串 * 避免 [object Object] 问题 * @param value 要转换的值 * @param fallback 回退值，默认为 '-' * @returns 字符串值或回退值 */`

### frontend/src/main.tsx

- 结果：✅ 无问题

### frontend/src/pages/AdminUsers.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：606；片段：`// 这里不会把 table 实例再交给 memo comparator 缓存，按项目约定定点忽略编译器告警。 // eslint-disable-next-line react-hooks/incompatible-library`
  - 2. 类型：纯英文注释；行号：607；片段：`eslint-disable-next-line react-hooks/incompatible-library`

### frontend/src/pages/AnnouncementManagement.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：777；片段：`// 这里直接在当前 hook 内消费 table 实例，没有额外 memo 边界，按项目约定定点忽略。 // eslint-disable-next-line react-hooks/incompatible-library`
  - 2. 类型：纯英文注释；行号：778；片段：`eslint-disable-next-line react-hooks/incompatible-library`

### frontend/src/pages/CartImport.tsx

- 结果：✅ 无问题

### frontend/src/pages/CommonShelf.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1010；片段：`// 页面装配层负责把刷新、弹窗、表格列和导出动作收敛起来。 // 主页面只消费这个 controller，避免在 JSX 上方继续堆叠一长串 useCallback/useMemo。`

### frontend/src/pages/ConsumableOrders.tsx

- 结果：✅ 无问题

### frontend/src/pages/Dashboard.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 组织仪表盘页签、统计卡片和按需加载的子页。 * `activeTab` 会持久化到 localStorage，并按当前角色校验可见范围。 */`
  - 2. 类型：纯英文注释；行号：135；片段：`ignore localStorage errors`

### frontend/src/pages/DeviceManagement.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：471；片段：`// 这里直接消费 table 实例，不再放进 useMemo 缓存；按项目约定定点忽略编译器告警。 // eslint-disable-next-line react-hooks/incompatible-library`
  - 2. 类型：纯英文注释；行号：472；片段：`eslint-disable-next-line react-hooks/incompatible-library`

### frontend/src/pages/Import.tsx

- 结果：✅ 无问题

### frontend/src/pages/Inventory.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：多行注释；行号：1；片段：`// Inventory.tsx // 库存管理页面 功能：库存列表展示、搜索筛选、手动入库、编辑、删除、借用、导出`
  - 2. 类型：纯英文注释；行号：1；片段：`Inventory.tsx`

### frontend/src/pages/Layout.tsx

- 结果：✅ 无问题

### frontend/src/pages/Login.tsx

- 结果：✅ 无问题

### frontend/src/pages/NotFound.tsx

- 结果：✅ 无问题

### frontend/src/pages/OperationLogs.tsx

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：1；片段：`OperationLogs.tsx`
  - 2. 类型：多行注释；行号：2；片段：`/** * 用户操作日志页面 * 使用 FilterTable 架构，与库存页面完全一致 */`

### frontend/src/pages/ReagentOrders.tsx

- 结果：✅ 无问题

### frontend/src/pages/TestError.tsx

- 结果：✅ 无问题

### frontend/src/pages/cartimport/cartImportControllers.ts

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：436；片段：`form errors shown inline`
  - 2. 类型：纯英文注释；行号：468；片段：`form errors shown inline`

### frontend/src/pages/cartimport/cartImportModel.ts

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：126；片段：`ignore storage errors`

### frontend/src/pages/dashboard/DashboardBorrowTab.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 仪表盘 - 借用记录 Tab * 展示当前用户的借用列表，支持归还操作（使用量/剩余量模式） */`

### frontend/src/pages/dashboard/DashboardConsumableTab.tsx

- 结果：✅ 无问题

### frontend/src/pages/dashboard/DashboardReagentTab.tsx

- 结果：✅ 无问题

### frontend/src/pages/dashboard/DashboardStockinTab.tsx

- 结果：❌ 发现 1 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * 仪表盘 - 待入库 Tab * 展示当前用户暂存的待入库记录，支持一键入库（填写存放位置） */`

### frontend/src/store/sseStore.ts

- 结果：❌ 发现 6 处问题
  - 1. 类型：多行注释；行号：1；片段：`/** * SSE runtime state store. * * This file is intentionally standalone so it can be integrated page-by-page * w...`
  - 2. 类型：纯英文注释；行号：2；片段：`SSE runtime state store.`
  - 3. 类型：纯英文注释；行号：4；片段：`This file is intentionally standalone so it can be integrated page-by-page`
  - 4. 类型：纯英文注释；行号：5；片段：`without touching existing global stores.`
  - 5. 类型：纯英文注释；行号：21；片段：`Track sequence per room for reliability checks.`
  - 6. 类型：纯英文注释；行号：107；片段：`Ignore duplicate/old events.`

### frontend/src/store/useStore.ts

- 结果：❌ 发现 3 处问题
  - 1. 类型：纯英文注释；行号：26；片段：`ignore storage errors`
  - 2. 类型：纯英文注释；行号：42；片段：`ignore storage errors`
  - 3. 类型：纯英文注释；行号：49；片段：`ignore storage errors`

### frontend/tailwind.config.js

- 结果：❌ 发现 3 处问题
  - 1. 类型：纯英文注释；行号：1；片段：`@type {import('tailwindcss').Config}`
  - 2. 类型：纯英文注释；行号：14；片段：`Chrome, Safari, Edge`
  - 3. 类型：纯英文注释；行号：16；片段：`Firefox`

### frontend/vite.config.ts

- 结果：❌ 发现 1 处问题
  - 1. 类型：纯英文注释；行号：94；片段：`https://vite.dev/config/`

### pyproject.toml

- 结果：❌ 发现 4 处问题
  - 1. 类型：纯英文注释；行号：15；片段：`Web Framework`
  - 2. 类型：纯英文注释；行号：20；片段：`Database`
  - 3. 类型：纯英文注释；行号：24；片段：`Auth`
  - 4. 类型：纯英文注释；行号：28；片段：`Utilities`

### wiki/.vitepress/theme/AsideOutline.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/Layout.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/OutlineTree.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/components/InlineCodeRef.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/components/MermaidAuto.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/components/SidebarsToggle.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/components/SidebarsToggleInExtraMenu.vue

- 结果：✅ 无问题

### wiki/.vitepress/theme/custom.css

- 结果：✅ 无问题

### wiki/.vitepress/theme/fontLoader.ts

- 结果：❌ 发现 2 处问题
  - 1. 类型：纯英文注释；行号：44；片段：`ignore localStorage errors`
  - 2. 类型：纯英文注释；行号：52；片段：`ignore localStorage errors`

### wiki/.vitepress/theme/index.ts

- 结果：✅ 无问题

