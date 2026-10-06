# 搜索补全建议

本文档说明搜索补全建议在后端、补全索引、搜索记忆和前端表格输入之间的协作方式。

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

`inline` 请求只读取已有索引，不负责重建。后台线程每 5 秒检查 endpoint 级 stale 标记；常规单条写操作仍直接同步对应实体的候选行。数据库暂时不可用时，补全返回空结果，并暂停尝试 5 秒。

## 数据库与表

补全相关数据保存在 `QUERY_LOG_DIR/search_completion.db`，由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/search_completion_db.py" /> 初始化和读写。原始搜索日志继续保存在 `query_logs.db`，避免日志写入与补全维护争用同一个 SQLite 写锁。补全库包含以下表：

| 表 | 作用 |
| --- | --- |
| `search_query_memory` | 用户或全局搜索记忆，按 endpoint、field、规范化 query 去重 |
| `entity_completion_index` | 从主库实体抽取出的补全候选索引 |
| `user_search_preferences` | 用户级个性化开关 |
| `search_completion_meta` | endpoint 级 stale 标记、变更版本和迁移标记 |

`search_query_memory` 使用非空哨兵值保存全局用户和全部字段，避免 SQLite `NULL` 唯一索引无法去重的问题。重复搜索会增加 `frequency` 并更新 `last_used_at`，相同作用域和规范化查询保持一条记录。

`entity_completion_index` 属于可重建的派生索引，主业务表保留事实数据。全量重建先在主库读取并构造候选，再在一个事务中完成版本检查、删除旧行、插入新行和清除 stale。读取方只能看到旧索引或新索引，不会看到中间的空索引。单条同步按 `endpoint + entity_type + entity_id` 替换对应候选。

## 实体索引来源

实体索引构建逻辑在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_completion_entity_index.py" />。

每个 endpoint 只抽取与列表搜索相关的字段：

| Endpoint | 来源模型 | 字段 |
| --- | --- | --- |
| `/inventory/` | `Inventory` | `name`、`cas_number`、`storage_location`、`brand`、`category` |
| `/reagent-orders/` | `ReagentOrder` | `name`、`cas_number`、`brand`、`category`、`applicant` |
| `/consumable-orders/` | `ConsumableOrder` | `name`、`specification`、`communication`、`applicant` |

索引维护支持三种模式：

- `rebuild_completion_entity_index(db)`：启动时或维护任务重建全部 endpoint。
- `rebuild_completion_entity_index(db, endpoint)`：运行期只重建指定 endpoint。
- `sync_*_entity_completions(...)` / `delete_*_entity_completions(...)`：业务写入后替换或删除单条实体候选。

运行期 stale 标记按 endpoint 保存。初始化和重建由独立后台线程执行，不阻塞应用启动。每次启动会标记全部 endpoint 待重建，以恢复上次进程退出期间遗漏的更新。批量写入无法安全逐条同步时标记对应 endpoint，单条创建、编辑、状态变化和删除直接维护实体候选。

后台重建使用非阻塞文件锁，在同一个本地数据目录内跨进程互斥，进程退出后由操作系统释放。拿到锁后再次检查 stale，避免重复重建。失败按 5、10、20、40、60 秒退避，不会因用户继续输入而增加重建任务。

增量写入和失效标记都会在同一事务中推进 endpoint 版本。重建提交时若发现版本变化，放弃该快照并保留 stale，下轮重新读取主库，避免旧快照覆盖新数据。失效标记写入也失败时，后台线程保留待重试 endpoint。

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
- 将 AbortSignal 传入 HTTP 客户端，在输入变化或卸载时取消旧请求；请求超时为 2 秒
- 本地缓存按用户、endpoint 和字段隔离，有效期为 60 秒；退出或切换账户时清空，并拒绝旧请求回写。缓存与当前显示的建议使用同一有效期，不缓存空结果
- 接受建议后提交正反馈
- 隐藏建议后提交负反馈

前端同样只在 `searchField === "all"` 时启用补全配置。单字段搜索时 `FilterTable` 不会传递内联建议到 `TableFilters`。包含半角空格的分词查询不会请求补全，避免把组合查询误当成一个候选前缀。

## 写操作刷新规则

常规写路径按实体增量维护候选索引，避免每次写入后扫描整个 endpoint。

变更入口主要包括：

- 库存 CRUD、借用和归还：替换或删除 `/inventory/` 对应实体候选。
- 试剂订单创建、编辑、审批、到货和删除：替换或删除 `/reagent-orders/` 对应实体候选。
- 试剂订单正式入库：同步试剂订单候选和生成的库存候选。
- 耗材订单创建、编辑、审批、完成、拒绝和删除：替换或删除 `/consumable-orders/` 对应实体候选。
- 批量导入等批量路径：批量同步实体；无法确认单条覆盖范围时标记 `/inventory/` stale。

写路径调用 `run_completion_index_update` 时，补全索引异常只记录日志，不回滚已经成功的业务事务。维护代码需要覆盖实体创建、字段变更、状态变更和删除四类路径，并保留 endpoint 重建作为恢复手段。

请求内每次辅助索引写入最多等待写锁 100 毫秒，失败后的 stale 标记也使用该上限；两次都失败时交给后台重试。此设置只作用于当前调用上下文，不改变后台维护的 3 秒锁等待。全量重建与增量更新共用各实体的字段构造函数。

## 性能与容量

一次补全复用一个只读连接，在同一读取快照中查询偏好、搜索记忆和实体候选；各实体字段合并查询并分别限制候选数量。读取连接的锁等待上限为 100 毫秒，WAL 只在数据库初始化时设置。取消浏览器请求不能保证终止已经执行的服务端同步函数，因此后端仍独立限制工作量。

`entity_completion_index` 是可重建缓存，大小跟主库实体数和索引字段数相关。例如一个订单可能生成多行候选，因为名称、CAS、品牌和申请人分别是不同候选。endpoint 级重建一般比全库重建更可控。

`search_query_memory` 会按不同规范化搜索词增长，并由跨进程节流的裁剪任务限制容量：

- 每小时最多执行一次裁剪检查。
- 频次不高于 2 且 180 天未使用的记录会被清理。
- 每个用户、endpoint 和字段作用域最多保留 1000 条。
- 全局 endpoint 和字段作用域最多保留 5000 条。
- 全表最多保留 100000 条。

裁剪按频次、最近使用时间和 id 保留优先级较高的记录。实体索引容量由主库实体数量和索引字段数量决定，通过单条替换、单条删除和 endpoint 重建保持边界。

## 维护约束

搜索补全的契约由 endpoint、实体索引字段、stale 标记、前端接入和前后端规范化共同组成。新增 endpoint 时，`TARGET_ENDPOINTS`、实体索引构建函数、写路径 stale 标记和前端 `inlineCompletionEndpoint` 需要保持一致。

补全建议只在 `field=all` 场景启用。单字段搜索不返回建议，这是前后端共同维护的语义边界。

搜索词和候选值的匹配语义以 `normalize_search_term(...).casefold()` 为准。调整规范化逻辑时，需要同步评估搜索记忆、实体索引和前端 suffix 计算。

## 升级与故障恢复

部署时先停止旧版本进程，再启动新版本，避免新旧版本同时写入不同的补全数据库。首次启动在后台迁移旧库的搜索偏好和查询记忆，迁移与完成标记一起提交，失败可重试，完成后不会重复导入。旧数据库和旧表保留；实体索引从主库重建。备份时保留整个 `QUERY_LOG_DIR`，不要手动删除正在使用的 SQLite WAL、SHM 或重建锁文件。

迁移入口在 `app/search_completion_db.py`：`init_search_completion_db()` 先调用 `is_search_completion_db_current()`，用只读连接检查表、索引、版本及 `legacy_completion_migrated=1` 标记。通过后直接返回，不进入升级事务，也不访问旧库；仅检查未通过时运行 `_upgrade_search_completion_db()`，取得写锁后再次检查，实际旧库复制由 `_migrate_legacy_completion_data()` 完成。

数据迁移与实体索引重建是两件事。正常模式仍保留启动时的一次后台索引重建，用来恢复主库已提交、辅助索引尚未同步时进程退出造成的遗漏；它不会重新导入旧库数据。`MAINTENANCE_MODE=on` 时两者均暂停，搜索建议只读取已有数据，也不写日志、记忆或反馈。

日志中的 `Completion initialization failed`、`Completion rebuild failed`、`Completion unavailable` 分别对应初始化、后台重建和请求读取故障。恢复期间仍可登录和使用业务功能，补全暂时为空或继续使用旧索引。

前端认证快照只保存上次用户信息。`/users/me` 成功后才允许进入业务页面；401 清除认证状态，服务异常或超时进入 `degraded` 并显示登录页，允许重试验证。需要直接切换账户时访问 `/login?switch=1`，该入口清除本地认证状态并显示普通登录表单，不依赖退出接口成功。

回归测试：

```powershell
poetry run pytest tests/unit/test_search_completion_resilience.py tests/unit/test_search_completion_entity_index_cleanup.py tests/unit/test_search_completion_memory_pruning.py tests/unit/test_search_completions.py tests/unit/test_search_query_log_service.py -q
cd frontend
node --test tests/authRecovery.test.mjs tests/announcementPopup.test.ts
npx tsc -b
```

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
