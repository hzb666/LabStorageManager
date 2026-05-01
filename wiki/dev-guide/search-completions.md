# 搜索补全建议

本文档说明搜索补全建议在后端、补全索引、搜索记忆和前端表格输入之间的协作方式。该能力由提交 `44e88dce238c5850969cc2b6f920390fe75abdd7` 引入。

## 设计边界

搜索补全建议只服务于列表搜索输入框的“内联建议”，不参与库存或订单列表的实际搜索结果查询。真实搜索结果仍由库存、试剂订单和耗材订单各自的列表 API、SQL/FTS、缓存和排序逻辑决定。

当前支持的 endpoint 固定在三类列表：

- `/inventory/`
- `/reagent-orders/`
- `/consumable-orders/`

只有搜索字段为 `all` 时才返回建议。用户选择单字段搜索时，前端不会发起补全请求，后端即使收到 `field != "all"` 也返回空建议，避免“建议词来自其他字段”导致语义冲突。

## 后端入口

后端路由集中在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/search_completions.py" />。

主要接口：

- `GET /api/search-completions/inline`
  - 输入：`endpoint`、`q`、`field`
  - 输出：`completion`、`suffix`、`confidence`、`source`、`personalized`
  - 行为：只在 endpoint 合法、`field=all`、输入非空时计算建议
- `POST /api/search-completions/feedback`
  - 输入：`endpoint`、`field`、`query`、`accepted`
  - 行为：只记录 `field=all` 的接受/拒绝反馈
- `GET/PUT /api/search-completions/preferences`
  - 读写当前用户是否启用个性化搜索记忆

`inline` 请求在排序前会调用 `rebuild_completion_entity_index_if_stale(db, endpoint)`。这意味着写操作只设置 stale 标记，真正重建发生在下一次该 endpoint 的补全请求中。

## 数据库与表

补全相关数据保存在 `QUERY_LOG_DIR/query_logs.db`，由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/search_completion_db.py" /> 初始化和读写。它复用查询日志数据库文件，但维护独立表：

| 表 | 作用 |
| --- | --- |
| `search_query_memory` | 用户或全局搜索记忆，按 endpoint、field、规范化 query 去重 |
| `entity_completion_index` | 从主库实体抽取出的补全候选索引 |
| `user_search_preferences` | 用户级个性化开关 |
| `search_completion_meta` | endpoint 级 stale 标记 |

`search_query_memory` 使用非空哨兵值保存全局用户和全部字段，避免 SQLite `NULL` 唯一索引无法去重的问题。重复搜索不会新增行，而是增加 `frequency` 并更新 `last_used_at`。

`entity_completion_index` 是派生表，不是事实源。重建时先删除目标 endpoint 的旧索引，再批量插入该 endpoint 的候选行；它不会因为重复搜索而无限增长。

## 实体索引来源

实体索引构建逻辑在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_completion_entity_index.py" />。

每个 endpoint 只抽取与列表搜索相关的字段：

| Endpoint | 来源模型 | 字段 |
| --- | --- | --- |
| `/inventory/` | `Inventory` | `name`、`cas_number`、`storage_location`、`brand`、`category` |
| `/reagent-orders/` | `ReagentOrder` | `name`、`cas_number`、`brand`、`category`、`applicant` |
| `/consumable-orders/` | `ConsumableOrder` | `name`、`specification`、`communication`、`applicant` |

索引重建支持两种模式：

- `rebuild_completion_entity_index(db)`：启动时或维护任务重建全部 endpoint。
- `rebuild_completion_entity_index(db, endpoint)`：运行期只重建指定 endpoint。

运行期 stale 标记也是 endpoint 级。库存变更只影响 `/inventory/`；试剂订单变更只影响 `/reagent-orders/`；耗材订单变更只影响 `/consumable-orders/`。试剂订单入库会额外生成库存，因此还会标记 `/inventory/` stale。

## 排序与候选来源

候选排序在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_completion_ranker.py" />。

候选由三部分合并：

1. 当前用户的 `search_query_memory`
2. 全局 `search_query_memory`
3. `entity_completion_index`

搜索记忆的分数由频次、最近使用时间和接受/拒绝反馈共同决定。实体索引的基础分由业务状态决定，例如在库、待审批、已完成等状态会有不同权重。最终结果还会按规范化后的前缀去重，并低于置信阈值时返回空建议。

输入前缀使用 `normalize_search_term(...).casefold()` 规范化，因此 CAS 中的空格、连字符、大小写差异不会影响候选匹配。

当前 rank 方案如下：

| 场景 | 搜索记忆权重 | 实体索引权重 |
| --- | --- | --- |
| 开启个性化 | 个人记忆 `0.45`，全局记忆 `0.20` | `0.25` |
| 关闭个性化 | 全局记忆 `0.45` | `0.40` |

搜索记忆原始分为 `log1p(frequency) * exp(-0.05 * days) * accept_weight`，其中 `accept_weight = (accept_count + 1) / (accept_count + reject_count + 2)`。同一来源内按最大值归一化到 `0..1` 后再乘以上表权重。

实体索引使用 `operational_score` 作为基础分。库存、试剂订单和耗材订单分别根据业务状态给分，例如在库、待审批等状态优先级更高，已消耗、已拒绝等状态优先级更低。

候选合并顺序为个人记忆、全局记忆、实体索引。合并后按规范化 completion 去重，保留最先出现的候选；再从剩余候选中选择加权分最高且匹配前缀的项。最终分低于 `0.15` 或无法产生非空 suffix 时返回空建议。

## 前端接入

前端 API 封装在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />，Hook 在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useInlineSearchCompletion.ts" />。

`FilterTable` 通过 `inlineCompletionEndpoint` 和 `enableInlineCompletion` 开启补全：

- 库存页传 `/inventory/`
- 试剂订单页传 `/reagent-orders/`
- 耗材订单页传 `/consumable-orders/`

接入点在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" /> 和 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/TableFilters.tsx" />。`useInlineSearchCompletion` 内部负责：

- 输入防抖
- Abort 旧请求
- 本地补全结果缓存
- 接受建议后提交正反馈
- 隐藏建议后提交负反馈

前端同样只在 `searchField === "all"` 时启用补全配置。单字段搜索时 `FilterTable` 不会传递内联建议到 `TableFilters`。

## 写操作刷新规则

写路径不直接重建索引，只标记 stale。这样连续多次新增或修改记录时，中间没人请求补全就不会重复重建。

变更入口主要包括：

- 库存 CRUD、导入、借用、归还：标记 `/inventory/`
- 试剂订单创建、编辑、审批、到货、删除：标记 `/reagent-orders/`
- 试剂订单正式入库：标记 `/reagent-orders/` 和 `/inventory/`
- 耗材订单创建、编辑、审批、完成、拒绝、删除：标记 `/consumable-orders/`

如果后续改成行级增量刷新，需要保证所有这些写路径都覆盖到；否则宁可 fallback 到 endpoint stale，避免建议索引永久不一致。

## 性能与容量

`entity_completion_index` 是可重建缓存，大小跟主库实体数和索引字段数相关。例如一个订单可能生成多行候选，因为名称、CAS、品牌和申请人分别是不同候选。endpoint 级重建一般比全库重建更可控。

`search_query_memory` 会按不同规范化搜索词增长。重复搜索不会增加行数，但新的不同搜索词会新增记录。当前没有 TTL 或 per-scope 上限；如果搜索记忆持续增长，应优先加入保留最近/高频 N 条的裁剪任务，而不是改动实体索引。

## 维护约束

搜索补全的契约由 endpoint、实体索引字段、stale 标记、前端接入和前后端规范化共同组成。新增 endpoint 时，`TARGET_ENDPOINTS`、实体索引构建函数、写路径 stale 标记和前端 `inlineCompletionEndpoint` 需要保持一致。

补全建议只在 `field=all` 场景启用。单字段搜索不返回建议，这是前后端共同维护的语义边界。

搜索词和候选值的匹配语义以 `normalize_search_term(...).casefold()` 为准。调整规范化逻辑时，需要同步评估搜索记忆、实体索引和前端 suffix 计算。

## 参考代码

- [app/api/search_completions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/search_completions.py)
- [app/search_completion_db.py](https://github.com/hzb666/LabStorageManager/blob/main/app/search_completion_db.py)
- [app/services/search_completion_entity_index.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_completion_entity_index.py)
- [app/services/search_completion_ranker.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_completion_ranker.py)
- [app/services/search_query_log_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_query_log_service.py)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/components/ui/TableFilters.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/TableFilters.tsx)
- [frontend/src/hooks/useInlineSearchCompletion.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useInlineSearchCompletion.ts)
