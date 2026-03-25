# 数据与搜索

## SQLite 是主存储，WAL 是硬约束

后端直接使用 SQLite 作为主数据库，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 会在 Engine 建立时通过 `event.listen(engine, "connect")` 强制执行 `PRAGMA journal_mode=WAL` 与 `PRAGMA foreign_keys=ON`，保证并发写入和外键约束的稳定性。`init_db()` 在 `lifespan` 里被调用，连续执行：

- `SQLModel.metadata.create_all(engine)`；
- `ensure_sqlite_performance_indexes`（数十条 `CREATE INDEX IF NOT EXISTS`，覆盖 `inventory`、`order`、`user_sessions` 等常用查询路径）；
- `ensure_sqlite_inventory_fts`（为 `inventory`、`reagent_order`、`consumable_order`、`users` 建虚拟表、触发器，必要时重新 `INSERT INTO … SELECT` 重建数据）；
- `check_sqlite_schema_consistency`（对比 metadata 和实际列、索引，无法一致时只发警告并提示需要手动 migration）。

这些动作合在一起意味着：每次上线，WAL 与 FTS 表都会被重新校准，必须通过 `reset_db()` 才能清空触发器与虚拟表后再从头重建。

## 拼音预计算

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" /> 在多个模型里被复用：如 `User`、`Inventory`、`ReagentOrder`、`ConsumableOrder` 等在写入时都调用 `compute_pinyin_fields`，它会为 `name`/`brand`/`category`/`storage_location`（以及 `full_name`）生成 `xxx_pinyin` 与 `xxx_pinyin_initials`。`to_pinyin_parts` 里区分汉字（用 `pypinyin` 生成全拼与首字母）与 ASCII token（保留小写原样），便于混合中英文的搜索请求。

这些拼音字段一方面被 `inventory_*` 模型直接索引，另一方面被 `inventory_fts`、`reagent_order_fts` 等 trigram FTS 表记录，确保同时支持拼音/首字母、普通字段和 FTS 查询。

## CAS 标准化与校验

所有涉及 CAS 的输入必须通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/cas_utils.py" /> 统一处理，遵循“去除空格、转大写”的 `normalize_cas` 规则，并通过 `validate_cas_format` 检查 `XXXXX-XX-X` 格式及校验位。特殊业务值 `BIOLOGICAL_REAGENT_CAS` 也在工具里统一接入，`validate_and_normalize_cas` 返回 `(bool, err, normalized)`，便于上层链式校验。`get_cas_prefix` 则为展示或分区提供前缀，例如把 `64-17-5` 显示为 `64`。

## 搜索匹配器与 FTS 智能选路

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py" /> 是普通搜索的控制中心：

- `normalize_field_sql` / `normalize_search_term`（由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sql_utils.py" /> 提供）会显式移除 `-`/空格/Unicode 空白，保持 LIKE 查询和 FTS 查询之间的一致性。  
- `build_cas_search_clause` 根据 `CASSearchMode`（exact/prefix/contains）挑选 `=`、`LIKE` 或 `ILIKE`，便于优先走 B-tree 索引。  
- `build_text_search_clause` 织入 `func.coalesce` 与 `ilike`，再结合 `normalize_field_sql`，适合短词和 fuzzy 逻辑。  
- `should_use_trigram_fts` 要求非模糊模式、长度≥3、字符限制在 ASCII + 常见符号，才会走 trigram FTS。  
- `build_applicant_id_subquery` 先尝试精确匹配 `username`/`full_name`/拼音，再根据 `should_use_trigram_fts` 决定是否合并 `users_fts`，否则退回 `ILIKE`。

`inventory_fts.py` / `order_fts.py` 分别为库存、订单构建 `MATCH` 子句，它们通过 `_collect_target_columns` 组合字段（可按 `search_field` 限定），再以 `bindparam` 生成安全的语句。三方 `build_*_fts_rowid_subquery` 会在 `inventory`/`reagent_order`/`consumable_order` 查询中通过 `IN (SELECT rowid FROM ... WHERE MATCH ...)` 提前筛选 ID，再由 ORM 去拉实体，从而最大限度利用 trigram tokenizer。

## 常用 vs 普通库存

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_queries.py" /> 提供 `regular_inventory_clause` 与 `common_inventory_clause`，让 `is_common` 维度的常用货架和普通库存在同一张表中存储仍然能高效查询：大部分索引、FTS 表都按 `is_common` 上下文构建（例如索引带 `is_common` 前缀），这意味着在写新查询或调优时务必先确认要查询的是常用还是普通库存。

## 开发提示与补充

## 索引与 FTS 细节（按启动顺序）
- 性能索引：`ensure_sqlite_performance_indexes` 在启动时批量创建复合索引，覆盖 `inventory` 借用/状态/更新时间、`borrowlog` 借用记录、用户会话、订单等（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L52-L118" />）。
- FTS5 表：`inventory_fts` / `reagent_order_fts` / `consumable_order_fts` / `users_fts` 均使用 `tokenize='trigram'`，并带 `INSERT/UPDATE/DELETE` 触发器同步（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L120-L207" />）。
- 重建条件：启动时比对源表行数与 FTS 行数，不一致则执行 rebuild SQL；触发器缺失同样会重建（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L725-L768" />）。
- ANALYZE/PRAGMA optimize：`init_db()` 末尾统一执行，确保查询计划稳定（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L784-L867" />）。

## FTS 选路与降级
- 搜索入口（库存/订单/用户）调用 `search_matchers` 按条件选择 FTS 或 LIKE；当 FTS 抛错或 DB 不支持 trigram 时自动降级到 LIKE（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py#L120-L207" />）。
- 拼音字段和 trigram FTS 组合，保证中英文与模糊子串可检索；若新增字段需同步 FTS schema 和触发器字段映射。
- 缓存：无搜索条件且第一页会命中内存缓存（LIST_CACHE_PREFIX），搜索或分页会绕过缓存（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py#L22-L69" />）。

## CAS/规格/拼音流水线（下单与入库）
- 试剂下单：CAS 规范化、校验、规格解析、拼音预计算在创建/更新接口内完成（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py#L185-L340" />）。
- 库存入库：从订单复制到库存时复用拼音字段、internal_code 生成、source_order_id 追溯（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L213-L520" />）。
- FTS 触发器确保上述字段变更自动同步到 FTS 表，无需手动写入。

## 边界与风险
- 新字段若未加入 FTS schema/触发器，会导致搜索缺失；修改模型需同步 `SQLITE_*_FTS_SETUP` 和 rebuild SQL。
- 关闭 WAL 或缺失 `PRAGMA foreign_keys=ON` 将影响并发与约束，务必保留 `on_connect` 回调。
- Trigram FTS 依赖 SQLite >= 3.34（内置 pysqlite3），替换 SQLite 时需确认 FTS5/tri-gram 支持。

## 验证建议
- 启动日志应打印 “WAL enabled”/“FTS initialized”；若 FTS 重建会出现对应 rebuild log。
- 连接数据库执行只读核对：`PRAGMA journal_mode;`、`PRAGMA foreign_keys;` 以及四张 FTS 表与源表的 `COUNT(*)` 对比应一致。
- 搜索回退测试：故意删除 `inventory_fts` 触发器后启动应自动重建；模拟 FTS 异常时应降级为 LIKE 且请求成功。

- 每当新增需要搜索的字段（比如新的 `alias`、`specification`），务必更新 `SQLITE_PERFORMANCE_SEARCH_INDEX_UPGRADES` 中对应表的 `CREATE INDEX`，并在 `ensure_sqlite_inventory_fts` 的 `setup_statements` 添加对应列，避免触发器只插入部分字段。  
- 变更模型字段后，使用 `reset_db()` 或手动 `DELETE FROM <fts_table>` + `INSERT INTO ... SELECT` 保证 `inventory_fts` 与 `order_fts` 数据同步。`SQLITE_SAFE_DELETE_STATEMENTS`、`SQLITE_SAFE_DROP_TRIGGER_STATEMENTS` 提供了安全工具。  
- CAS 相关输入必须通过 `normalize_cas`/`validate_and_normalize_cas`，客户端可以复用这些规则以减少回传错误。  
- 新增搜索路径时优先考虑 `should_use_trigram_fts` 的判断：少于 3 个字符的 term 或 fuzzy 模式都应该回退到 `ILIKE`，否则 trigram 反而会扫全表。  
- 拼音字段长度通过 `compute_pinyin_fields(..., max_length=200)` 截断，修改字段时不要随意改小或改大而不通知数据库迁移脚本，否则 FTS rebuild 会出错。  

## 搜索行为验证矩阵

| 场景 | 期望行为 | 重点检查 |
| --- | --- | --- |
| CAS 精确匹配 | 优先走索引匹配 | 结果唯一性、性能 |
| 中文关键词 | 命中原文字段与拼音字段 | 中英文混搜一致性 |
| 全拼/首字母 | 能命中拼音预计算字段 | `*_pinyin` 与 `*_initials` |
| 短词搜索 | 允许退回 LIKE | 不应强行走 FTS |
| FTS 异常 | 自动降级 LIKE | 接口可用性优先 |

建议每次改动搜索逻辑后，至少跑一遍库存、试剂订单、耗材订单三类列表的以上五个场景。

## 参考代码
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)（行213）
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)（行185）
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)（行52，120，725，784）
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)（行22）
- [app/services/cas_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/cas_utils.py)
- [app/services/inventory_queries.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_queries.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/search_matchers.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py)（行120）
- [app/services/sql_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sql_utils.py)


