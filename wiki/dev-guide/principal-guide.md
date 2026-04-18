# 核心导读

这页写给需要接手系统设计、代码治理和线上问题定位的开发者。重点不是页面操作，而是先建立对业务分流、事实源、实时同步、认证边界和外部导入链路的统一认识。

## 最重要的架构洞见

1. 试剂和耗材不是“同一个订单表上的两个状态”，而是两套数据模型和两套工作流。<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py" /> 从模型层就已经分叉；<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 和 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 在 API 层继续把链路彻底分开。
2. `Inventory` 才是现货侧事实源。订单能说明“买了什么”，借用日志能说明“动过什么”，但只有 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" /> 能回答“现在库里还有什么、在哪、还剩多少”。
3. SSE 是增量通知层，不是第二事实源。前端会尽量 patch 列表缓存，但只在语义足够安全时这样做；一旦排序、筛选或序号存在歧义，就直接把房间标记为 stale，重新拉 HTTP 快照。
4. 扩展导入是外围链路，不是旁路系统。扩展只负责采集和桥接，最终订单创建仍要回到系统自己的表单校验、权限检查和后端 DTO 规范化。

## 接手时先确认的五个系统约束

- SQLite 不是临时过渡实现。<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 在启动时强制启用 WAL、补性能索引、维护 FTS 表和触发器，并执行 schema consistency check。
- 搜索依赖写入期预计算。拼音字段、CAS 规范化、规格解析都在写入阶段完成，而不是查询时即时推导。
- 列表缓存必须和写操作、SSE 一起看。后端短 TTL 列表缓存只服务于“第一页、无复杂搜索”的热点列表，写操作后通常需要同时清缓存和发 SSE。
- Redis 是加速层，不是事实源。当前项目把会话失效通知、登录限流和跨进程 SSE 放在 Redis 上，但就算 Redis 退化，SQLite 仍是业务主数据源。
- 公共账号不是“弱权限用户”，而是专门受限身份。它在导入、建单等路径上会被显式拒绝。

## 快速进入状态的阅读顺序

- 运行边界：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />
- 数据基线：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />
- 主业务流：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />
- 认证与会话：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />
- 实时同步：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts" />
- 外围系统：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />

## 按任务切入的阅读顺序

1. 业务流程调整：先看订单模型，再看 workflow API，再看库存承接逻辑。
2. 搜索与性能调整：先看 `database.py` 的索引和 FTS，再看 `search_matchers.py`、`api_utils.py`，最后看前端表格状态。
3. 权限与安全调整：先看 `auth.py`、`main.py` 中间件，再看前端 `useAuthStore`、`api/client.ts` 和路由守卫。
4. 实时同步调整：先看后端事件入口，再看 `useSSE`、`useListSSE`、`sseStore.ts`，重点确认哪些场景必须 stale，而不是勉强 patch。
5. 导入链路调整：先看扩展 popup/bridge，再看 `CartImport` 控制器；不要先在扩展里加业务规则。

## 这套设计的核心取舍

- 选择 SQLite + WAL：换来低运维成本、本地可运行和足够的读性能，但要求我们把索引、FTS、排序字段和一致性检查做扎实。
- 选择“快照 + SSE 增量提示”：换来更稳的正确性边界，而不是追求所有更新都原地 patch。
- 选择订单与库存分层：换来更清晰的审计链，但也意味着任何“订单更新”“库存借还”“常用货架补瓶”都要分别处理。
- 选择扩展桥接而非扩展直写：换来统一的业务规则入口，但也要求导入页处理好草稿、校验和失败重试。

## 线上问题的第一定位顺序

遇到问题时，建议按下面顺序定位：

1. 先确认是“快照错了”还是“增量通知错了”。
2. 再确认是“业务写入失败”还是“列表缓存/SSE 没刷新”。
3. 再看问题发生在试剂、耗材、库存还是常用货架哪条链路。
4. 最后再看前端是否只是表现层没同步。

典型例子：

- 列表里数据旧，但刷新后正确：优先查短 TTL 缓存和 SSE stale 处理。
- 到货后找不到库存：优先查 `reagent_orders_workflow.py` 的确认到货/入库分支。
- 会话被强制下线但页面仍停留在当前状态：优先查 `auth.invalid` 事件、`triggerSessionInvalidation` 和当前会话 token hash。
- 扩展导入打开了页面但没有批次：优先查 bridge、批次 TTL 和 `batch_id`。

## 接手时容易漏掉的点

- `CartImport` 页面主链路逐条走标准订单创建接口。
- `temporary_keeper_id` 是库存暂管字段，不是用户角色。
- `arrived` 不是“已正式入库”，而是试剂已到货但尚未完成正式落位。
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
