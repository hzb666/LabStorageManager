# 核心导读

这页写给已经能独立接手系统设计、代码治理和线上问题定位的开发者。你不需要先知道每个页面怎么点，但需要先抓住项目的核心架构洞见以及实际行为路径。

## 最重要的架构洞见

1. **试剂/耗材分流**：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py" /> 分别定义两条链路，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 负责试剂从 `pending`→`approved`→`arrived`→`stocked`，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 只需 `pending`→`approved`→`completed`（不存在库存）。
2. **库存作为事实源**：`Inventory` 模型在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" /> 中实现 `internal_code`, `is_common`, 拼音字段；所有借用/归还/常用货架都通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> 与 `register_common_shelf` 实现，`BorrowLog` 记录每次借用。
3. **前端 + SSE 负责可感知实时反馈**：前端 `useSSE.ts` + `sseStore.ts` 订阅 `/api/events?rooms=...`，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 保证消息对齐（序列号、慢客户端回退）。
4. **购物车同步始终回到系统**：浏览器扩展抓购物车写入 `chrome.storage.local.import_batch_latest`，`content/import-bridge.js` 把数据送到 `/cart-import` 页面并写入 `localStorage.cart_import_batch_latest`，前端 `cartSyncAPI.importItems` 调用 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />，导入过程中仍通过 `compute_pinyin_fields`、`normalize_cas`、`parse_specification` 统一清洗。

## 先打开这些文件

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：看中间件链（CORS、CSRF、HTTPS 重定向）、`init_db()` 流程以及 `/cart-import` 入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />：验证 WAL/FTS/索引创建 + 拼音/internal code 实现。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />：重要工作流、借用接口、SSE 事件。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />：耗材审批、完成与外部购物车导入策略。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：掌握路由、受保护页面、Auth、API 定义。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" /> + `store/sseStore.ts`：理解 SSE 订阅/状态治理逻辑。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />：理解扩展如何把外部数据注入到应用。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> + <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />：确认部署边界（`/api`、`/static`、`health`、SSE）。

## 运行链的记忆套路

1. 后端：`python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`，`init_db` 会创建索引、FTS、default admin；`/api/events` 需要登录并用 `/api/events?rooms=...` 订阅。
2. 前端：`npm run dev` 启动 Vite（5173），`App` 会懒加载页面；`Auth` 通过 HTTP-only Cookie，`useAuthStore` 在 `authAPI.getProfile()` 中刷新。
3. SSE：`useSSE` 会注册 `handlers`（事件类型如 `inventory_updated`、`common_shelf_updated`），`processSeq` 保证不重复，`markRoomStale` 触发数据刷新。
4. 购物车导入：扩展到 `/cart-import` 页面 → `cartSyncAPI.importItems` → <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" /> → `ReagentOrder`/`ConsumableOrder` 创建。

## 设计取舍提醒

- **SQLite**：启用 WAL + FTS（`inventory_fts`, `reagent_order_fts`, `consumable_order_fts`, `users_fts`），`SQLITE_PERFORMANCE_INDEX_UPGRADES` 拼接复合索引，避免在业务逻辑里直接写 SQL。
- **Redis**：主要用于 SSE、登录限流、会话黑名单（封装在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/rate_limit.py" />），业务仍以 SQLite 作为事实源。
- **安全优先**：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 中 `_apply_security_headers`、`CurrentUser`、`require_admin`、HTTPS 重定向/CSRF 检查全部在线。
- **前后端输入验证**：前端 `validationSchemas.ts`、Valibot 校验，后端 `pydantic` DTO（如 `ReagentOrderCreate`、`InventoryUpdate`）保障字段合法性；`cart_sync` 进一步清洗。
- **扩展不会绕过权限**：扩展本身只负责数据搬运，最终创建订单仍走后端 API，因此不要在扩展中添加独立验证逻辑。

## 其他提醒

- 避免参考旧的 `docs/` 内容，真正可靠的是 `app/`、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/frontend/src" />、`browser-extension/`、`docker/` 这四个目录。
- 所有变更需关注 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" />、`LIST_CACHE_PREFIX` 与 SSE 推送是否同步（`clear_cache_by_prefix` + `sse_manager.broadcast`）。
- 解决问题时优先复盘 `app` 日志、`frontend` 控制台、`docker-compose logs`，必要时使用 `python -m uvicorn` 和 `npm run dev` 分别确认接口与前端表现。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)
- [app/models/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py)
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/internal_code.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/rate_limit.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/rate_limit.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [app/services/sse_redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)


