# 核心导读

这页写给需要接手系统设计、代码治理和线上问题定位的开发者。重点不是页面操作，而是先建立对业务分流、事实源、实时同步和外部导入边界的统一认识。

## 最重要的架构洞见

1. 试剂和耗材是两条不同业务链：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py" /> 明确了两种订单模型；<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 负责试剂从审批、到货到入库的完整链路，而 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 只覆盖采购完成，不进入库存。
2. 库存是现货侧事实源：`Inventory` 在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" /> 中承载 `internal_code`、`is_common`、拼音字段和剩余量；借用、归还、常用货架和库存导出都围绕这张表展开，`BorrowLog` 只记录动作历史，不替代库存当前状态。
3. 实时同步是增量通知，不是第二事实源：前端 `useSSE.ts` + `sseStore.ts` 订阅 `/api/events`，后端 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 负责房间、序列号和慢客户端处理。事件用于提示和局部 patch，权威数据仍然来自 HTTP 查询。
4. 外部购物车导入不会绕开主系统规则：扩展抓到的数据先写入浏览器存储，再由 `content/import-bridge.js` 注入 `/cart-import` 页面，最终仍调用 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />，复用 CAS、规格和拼音清洗链路。

## 接手时先确认的四个系统约束

- SQLite 不是临时方案：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 在启动时强制打开 WAL、补索引、初始化 FTS 并执行一致性检查。
- 搜索依赖预计算字段：拼音字段、CAS 标准化和规格解析都在写入阶段完成。
- 缓存必须配合失效和 SSE：`LIST_CACHE_PREFIX` 只承担短 TTL 列表削峰；写操作后需要清缓存并广播事件。
- Redis 是加速层，不是唯一依赖：会话、限流和跨进程 SSE 会优先走 Redis，但系统设计允许 Redis 不可用时降级继续运行。

## 建议优先打开的文件

- 运行边界：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />。
- 数据基线：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />。
- 主业务流：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />。
- 前端入口：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" />。
- 外围系统：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />。

## 按任务切入的阅读顺序

1. 业务流程调整：试剂/耗材订单模型、对应 API 与 workflow、库存承接链路。
2. 搜索与性能调整：`app/database.py` 的索引与 FTS 初始化、`search_matchers.py`、`api_utils.py` 和前端表格状态。
3. 权限与安全调整：`app/core/auth.py`、`app/main.py` 的中间件和 `CurrentUser` 依赖、前端路由守卫。
4. 实时同步调整：SSE 后端、`useSSE.ts`、`useListSSE.ts` 和 `sseStore.ts`，重点确认 patch 与 stale 刷新的边界。
5. 导入链路调整：扩展桥接、`CartImport.tsx` 与 `cart_sync.py`，避免在扩展中重复实现业务校验。

## 设计取舍

- SQLite：启用 WAL + FTS（`inventory_fts`, `reagent_order_fts`, `consumable_order_fts`, `users_fts`），`SQLITE_PERFORMANCE_INDEX_UPGRADES` 拼接复合索引。
- Redis：主要用于 SSE、登录限流和会话黑名单，但业务仍以 SQLite 作为事实源。
- 安全优先：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 中的安全头、`CurrentUser`、`require_admin`、HTTPS 重定向和 CSRF 检查都在线。
- 前后端输入验证：前端 `validationSchemas.ts`、Valibot 校验，后端 DTO 保障字段合法性；`cart_sync` 进一步清洗。
- 扩展不会绕过权限：扩展只负责数据搬运，最终创建订单仍走后端 API。

## 接手时容易漏掉的点

- 不要把旧 `docs/` 当作事实源，当前代码行为应以 `app/`、`frontend/src/`、`browser-extension/` 和 `docker/` 为准。
- 任何写操作改动都要同步检查缓存失效和 SSE 广播。
- 线上问题定位应优先检查 `app` 日志、前端控制台和 `docker compose logs`。

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
