# 数据与搜索

## SQLite 是主存储

当前后端把 SQLite 当作主数据库，而不是开发环境替身。为了让它扛住日常列表、排序和搜索，项目在数据库初始化阶段做了大量索引和 FTS 配置。

## WAL 是硬约束

数据库连接建立时会显式执行：

- `PRAGMA journal_mode=WAL`
- `PRAGMA foreign_keys=ON`

这也是项目规则里反复强调的基础约束。

## 搜索不是单一模糊匹配

当前实现把搜索拆成几层：

- 普通字段匹配
- 拼音字段匹配
- SQLite FTS5 trigram
- 对 CAS 等特殊字段做标准化处理

这就是为什么模型里会保留大量拼音字段，数据库初始化里也会批量创建索引和 FTS trigger。

## 为什么有 `is_common`

库存模型中存在 `is_common` 维度，用来把常用货架和普通库存逻辑放在同一张表上区分。这也影响索引设计，因为查询通常要按是否常用来切分。

## 数据层阅读建议

如果你要理解性能和搜索相关问题，建议按这个顺序看：

1. `app/models/*.py`
2. `app/database.py`
3. `app/services/*fts*.py`
4. 具体列表 API

## 参考代码

- `app/database.py:32`
- `app/database.py:52`
- `app/database.py:120`
- `app/models/user.py:67`
- `app/models/reagent_order.py:127`
- `app/models/consumable_order.py:79`
