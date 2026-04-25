# 核心导读

本文档梳理系统设计、代码治理和线上问题定位所需的核心边界，覆盖业务分流、事实源、实时同步、认证边界和外部导入链路。

## 核心架构边界

1. 试剂和耗材采用两套数据模型和两套工作流。<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py" /> 在模型层分叉；<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 和 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 在 API 层维持独立链路。
2. `Inventory` 承担现货侧事实源职责。订单记录采购事实，借用日志记录流转事实，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" /> 记录当前库存、位置和剩余量。
3. SSE 承担增量通知职责。前端仅在语义安全时 patch 列表缓存；排序、筛选或序号存在歧义时，房间标记为 stale 并重新拉取 HTTP 快照。
4. 浏览器插件导入属于外围采集链路。插件负责采集和桥接，订单创建统一进入系统表单校验、权限检查和后端 DTO 规范化流程。

## 系统约束

- SQLite + WAL 是当前数据库方案。<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 在连接层强制启用 WAL，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap" /> 在启动期补性能索引、维护 FTS 表和触发器，并执行 schema consistency check。
- 搜索依赖写入期预计算。拼音字段、CAS 规范化和规格解析均在写入阶段完成，查询阶段直接使用预计算字段。
- 列表缓存必须和写操作、SSE 一起看。后端短 TTL 列表缓存只服务于“第一页、无复杂搜索”的热点列表，写操作后通常需要同时清缓存和发 SSE。
- Redis 承担加速和跨进程协作职责。当前项目把会话失效通知、登录限流和跨进程 SSE 放在 Redis 上，业务主数据仍落在 SQLite。
- 公共账号属于专门受限身份。导入、建单等路径显式拒绝公共账号写入。

## 快速进入状态的阅读顺序

- 运行边界：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />
- 数据基线：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />
- 主业务流：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />
- 认证与会话：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />
- 实时同步：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts" />
- 外围系统：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />

## 按任务切入的阅读顺序

1. 业务流程调整：先看订单模型，再看 workflow API，再看库存承接逻辑。
2. 搜索与性能调整：先看 `db_bootstrap` 的索引和 FTS，再看 `search_matchers.py`、`api_utils.py`，最后看前端表格状态。
3. 权限与安全调整：先看 `auth.py`、`main.py` 中间件，再看前端 `useAuthStore`、`api/client.ts` 和路由守卫。
4. 实时同步调整：先看后端事件入口，再看 `useSSE`、`useListSSE`、`sseStore.ts`，确认 stale 场景和 patch 场景的边界。
5. 导入链路调整：先看插件 popup/bridge，再看 `CartImport` 控制器；不要先在插件里加业务规则。

## 设计取舍

- 选择 SQLite + WAL：获得低运维成本、本地可运行能力和足够的读性能，同时要求索引、FTS、排序字段和一致性检查保持完整。
- 选择“快照 + SSE 增量提示”：提升正确性边界，放弃所有更新原地 patch 的目标。
- 选择订单与库存分层：换来更清晰的审计链，但也意味着任何“订单更新”“库存借还”“常用货架补瓶”都要分别处理。
- 选择插件桥接而非插件直写：换来统一的业务规则入口，但也要求导入页处理好草稿、校验和失败重试。

## 线上问题定位顺序

线上问题按以下顺序定位：

1. 判断问题来源于 HTTP 快照还是 SSE 增量通知。
2. 判断问题来源于业务写入失败还是列表缓存/SSE 刷新缺失。
3. 定位问题所在链路：试剂、耗材、库存或常用货架。
4. 检查前端表现层同步状态。

典型例子：

- 列表里数据旧，但刷新后正确：优先查短 TTL 缓存和 SSE stale 处理。
- 到货后找不到库存：优先查 `reagent_orders_workflow.py` 的确认到货/入库分支。
- 会话被强制下线但页面仍停留在当前状态：优先查 `auth.invalid` 事件、`triggerSessionInvalidation` 和当前会话 token hash。
- 浏览器插件导入打开了页面但没有批次：优先查 bridge、批次 TTL 和 `batch_id`。

## 接手注意点

- `CartImport` 页面主链路逐条走标准订单创建接口。
- `temporary_keeper_id` 表示库存暂管人字段。
- `arrived` 表示试剂已到货且尚未完成正式落位。
- `COMMON_PUBLIC` 订单在确认到货时可能直接进入常用货架，不一定创建普通库存。
- API 写成功不等于页面一定马上 patch；很多时候前端会故意退回 stale 刷新。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/db_bootstrap](https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)
- [app/models/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py)
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/internal_code.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/pages/cartimport/cartImportControllers.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts)
