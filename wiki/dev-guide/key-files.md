# 关键文件索引

## 后端启动与基础设施

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：FastAPI 实例化、生命周期（`lifespan` + `init_db()`）、CORS/HTTPS/CSRF/日志/安全头中间件、SSE 事件广播与 `/cart-import` 重定向。上线改动务必确认中间件顺序（安全头需最晚挂载）。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：创建 SQLite 引擎（`check_same_thread=False`）、每次连接启用 `PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`，批量创建 `SQLITE_PERFORMANCE_INDEX_UPGRADES`、FTS 表与触发器，还负责默认管理员创建。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" />：JWT 签名、当前用户依赖、管理员/公共账户限制，Redis 负责登录限流、会话黑名单，用于 `SessionService`。

## 业务路由与服务

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" />：用户 CRUD + 登录/注销/头像上传 + 日志 Token API，所有管理员功能会检查 `UserRole.ADMIN`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />：试剂订单列表/筛选/导入/审批/到货/入库，配套 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/spec_utils.py" /> 进行拼音/规格处理。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />：耗材订单专属接口，`complete` 仅接受审批后状态，`export` 生成 XLSX；只维护 `consumable_order` 表，无库存联动。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" />：库存列表/借用/归还/常用货架，使用 `regular_inventory_query()`、`apply_inventory_fts_filter` 及 `register_common_shelf`，`SSEEventType.INVENTORY/CUSTOMER` 推事件。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />：购物车同步/导入 API，身份必须非 `public`，通过 `normalize_cas`/`parse_specification` 清洗并创建 `ReagentOrder` 或 `ConsumableOrder`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" />：SSE 流（`/api/events`），`SSERoom`、`SSEClient`、`redis_pubsub` 协作保证多个进程的事件流一致，前端 `useSSE.ts` 依赖 `handlers` 处理各房间事件。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py" />：处理上传图片，生成缩略图并写 `static/uploads`/`static/thumbnails`，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的 `CachedStaticFiles` 负责缓存与安全头。

## 数据模型与工具

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：`User`/`UserSession`/`ReagentOrder`/`ConsumableOrder`/`Inventory`/`Announcement`，每个模型都包含 `Field` 定义、索引与序列化 DTO (`BaseResponse`, `*Response`)。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />：生成 `internal_code`（`CAS-YYMMDD-序号`）用于唯一识别瓶级库存。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" />：`get_cached_result`/`set_cached_result` + `clear_cache_by_prefix` 控制 `LIST_CACHE_PREFIX`，配合 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> 与 `consumable_orders.py` 让列表页有基本缓存。

## 前端关键文件

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />：`QueryClientProvider` + `App`，并打印 LSM 终端横幅。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：路由树，`ProtectedRoute`/`AdminRoute` 守护，懒加载页面组件（仪表盘、订单、库存、常用货架、导入、公告、设备、日志）。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：Axios 实例（Cookie）、统一 API、枚举、分页类型、`authAPI`/`inventoryAPI`/`reagentOrderAPI`/`cartSyncAPI` 等所有后端接口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" /> + `store/sseStore.ts`：SSE 连接与状态管理，`processSeq` 检查序号、`markRoomStale` 标记过期，`useListSSE` 在表格页面封装房间切换。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" /> + `hooks/useTableState.tsx`：TanStack Table + 状态管理（分页、排序、列宽、展开），大部分列表页都复用。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />：Valibot 验证、错误映射到中文提示。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" />：处理扩展数据、划分试剂/耗材、调用 `cartSyncAPI.importItems`。

## 浏览器扩展与部署

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json" />：声明权限（`tabs`、`storage`、`scripting`）、`content_scripts`、`popup`、`host_permissions`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" />：从 `reagent.bjmu.edu.cn` 抓购物车并写入 `chrome.storage.local.import_batch_latest`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />：在 `/cart-import` 页面注入桥接逻辑，读取 `chrome.storage` 并触发前端导入。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />：组合 `redis`、`backend`、`frontend`；`backend` 依赖 `.env`（`DEFAULT_ADMIN_PASSWORD`、`REDIS_PASSWORD`、`ENV`、`TRUST_PROXY_HEADERS`），`frontend` 通过 `VITE_API_URL` 指向 `/api`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />：反向代理 `/api`、`/static` 与前端（处理 SSE、CORS、gzip）。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory_extended_routes.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/image_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py)
- [app/services/internal_code.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/spec_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/spec_utils.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
- [browser-extension/manifest.json](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)
- [frontend/src/main.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)


