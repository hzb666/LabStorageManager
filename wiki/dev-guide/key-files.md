# 关键文件索引

## 启动与运行边界

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：FastAPI 实例、生命周期、中间件、安全头、SSE 初始化和 `/cart-import` 入口都在这里。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：SQLite 引擎、WAL、外键、索引、FTS 和默认管理员初始化都在这里收口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" />：分别负责认证依赖和 Redis 降级能力，是理解登录、会话和限流的起点。

## 核心业务链

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" />：用户 CRUD、登录、注销、头像上传和日志 Token API。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />：试剂订单列表、筛选、导入、审批、到货和入库。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />：耗材订单接口，`complete` 仅接受审批后状态，`export` 生成 XLSX。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_extended_routes.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" />：库存列表、借用、归还和常用货架。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />：购物车同步和导入 API，通过 `normalize_cas` 和 `parse_specification` 清洗并创建订单。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" />：SSE 流的核心实现，决定实时同步是否稳定。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py" />：处理上传图片并写入 `static/uploads` 和 `static/thumbnails`。

## 数据模型与查询工具

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：`User`、`UserSession`、`ReagentOrder`、`ConsumableOrder`、`Inventory`、`Announcement` 等模型。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />：生成 `internal_code`，用于唯一识别瓶级库存。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" />：列表页短 TTL 缓存，是排查“数据改了但列表还旧”问题时必须检查的地方。

## 前端关键入口

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />：`QueryClientProvider` + `App`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：路由树、`ProtectedRoute`、`AdminRoute` 和懒加载页面。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：Axios 实例、统一 API 和各业务接口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" /> + `store/sseStore.ts`：SSE 连接和状态管理。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" /> + `hooks/useTableState.tsx`：TanStack Table + 状态管理。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />：Valibot 验证和中文错误提示。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" />：处理扩展数据、划分试剂/耗材并调用 `cartSyncAPI.importItems`。

## 浏览器扩展与部署入口

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json" />：扩展权限、入口和内容脚本声明。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" />：从外部平台抓购物车并写入 `chrome.storage.local.import_batch_latest`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />：在 `/cart-import` 页面注入桥接逻辑。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />：组合 `redis`、`backend`、`frontend`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />：反向代理 `/api`、`/static` 与前端路由。

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
