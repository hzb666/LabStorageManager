# 数据与搜索

本页总结系统在 SQLite 上的查询和搜索设计。核心思路是把并发基线、标准化、拼音预计算、FTS 和普通索引拆开，各自负责最适合的查询路径。

## 查询基线

SQLite 是主存储。[app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py) 会在连接建立时强制执行 `PRAGMA journal_mode=WAL` 与 `PRAGMA foreign_keys=ON`，`init_db()` 启动阶段还会顺序完成：

- `SQLModel.metadata.create_all(engine)`
- `ensure_sqlite_performance_indexes`
- `ensure_sqlite_inventory_fts`
- `check_sqlite_schema_consistency`
- `ANALYZE` 与 `PRAGMA optimize`

因此，索引、FTS 和一致性检查都属于运行时初始化流程，而不是事后补救步骤。

## 标准化与拼音预计算

系统的搜索先统一输入，再决定查询路径：

- CAS 通过 `cas_utils.py` 做空格清理、大小写归一和格式校验。
- 规格、位置、货架等格式性字段都在后端完成清洗。
- `pinyin_utils.py` 会为用户、库存、试剂订单和耗材订单写入 `*_pinyin` 与 `*_pinyin_initials` 字段。

这些字段不是展示冗余，而是排序、筛选和搜索直接依赖的查询字段。

## FTS 表与触发器

系统维护五张 FTS5 虚拟表：

- `inventory_fts`
- `reagent_order_fts`
- `consumable_order_fts`
- `users_fts`
- `chemical_name_map_fts`

它们都使用 trigram 分词，并通过 `INSERT`、`UPDATE`、`DELETE` 触发器与主表同步。启动时系统会检查触发器是否齐全、FTS 行数是否与主表一致；若发现缺口，会自动执行 rebuild SQL 重建内容。

## 搜索选路

搜索不会强制走同一条路径。[app/services/search_matchers.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py)、[app/services/inventory_fts.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_fts.py) 和 [app/services/order_fts.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/order_fts.py) 会根据查询特征动态选路：

- CAS 精确匹配优先走 `=`，尽量利用 B-Tree 索引。
- CAS 前缀匹配走 `LIKE xxx%`。
- 短关键字或 `fuzzy=true` 场景优先走 `LIKE`。
- 足够长、适合全文召回的关键字才会走 trigram FTS。
- FTS 失败时自动回退到 `LIKE`，优先保证可用性。

对库存和订单类查询，系统通常先拿到候选 rowid 或 id，再回到 ORM 拉实体，避免把全部业务逻辑塞进单条复杂 SQL。

## 普通库存与常用货架

库存和常用货架共用 `Inventory` 模型，但查询路径并不混用。[app/services/inventory_queries.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_queries.py) 提供 `regular_inventory_clause` 与 `common_inventory_clause`，大部分索引和 FTS 查询也都带有 `is_common` 维度。写查询或加索引时，必须先确认场景属于普通库存还是常用货架。

## 已落地的优化点

系统已经落地的查询优化主要包括：

- 复合索引覆盖库存状态、借用记录、用户会话、订单筛选等高频路径。
- 拼音字段和拼音首字母字段直接参与排序与搜索。
- FTS5 与普通索引并存，而不是强行只选一种方案。
- 列表首页在无搜索条件时允许命中后端短 TTL 内存缓存，减少重复查询。
- 搜索或分页请求会绕过首页缓存，避免旧数据误命中。

目标不是把所有查询压到一条最快路径，而是让常见查询稳定、复杂查询可接受、异常时可降级。

## 变更检查

1. 确认新字段是否参与搜索、排序或聚合。
2. 确认是否需要新增标准化逻辑或拼音预计算字段。
3. 同步更新相关 `SQLITE_*_FTS_SETUP`、触发器和 rebuild SQL。
4. 补充必要索引，避免新增全表扫描路径。
5. 验证 FTS 失败回退到 `LIKE` 后的结果正确性。

## 验证建议

- 核对 `PRAGMA journal_mode;` 与 `PRAGMA foreign_keys;`。
- 对比五张 FTS 表与主表 `COUNT(*)` 是否一致。
- 分别用中文、全拼、首字母、CAS 精确值和短关键字测试库存与订单搜索。
- 临时破坏一个 FTS 触发器后重启，确认系统会自动重建。

## 参考代码

- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/cas_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/cas_utils.py)
- [app/services/inventory_queries.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_queries.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/search_matchers.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py)
- [app/services/sql_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sql_utils.py)
