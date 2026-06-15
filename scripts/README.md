# scripts 说明

本目录用于一次性数据修复、迁移导入、结构体检和运维辅助脚本。  

## 统一约定

1. 订单/库存状态、试剂订单原因：统一使用后端 `enum.value`（小写）写入数据库。
2. 当前订单表名：`reagent_order`、`consumable_order`（不是旧表名 `reagentorder`、`consumableorder`）。
3. 拼音字段：优先同时维护全拼和首字母字段（如 `name_pinyin` + `name_pinyin_initials`）。

## 保留脚本（建议继续维护）

| 脚本 | 何时使用 | 说明 |
|---|---|---|
| `check_db_health.py` | 发布前/迁移后自检 | 检查字段、索引、拼音、CAS 等健康状态。 |
| `check_db_schema_consistency.py` | 排查 schema 漂移 | 对比 SQLModel 与 SQLite 实际结构。 |
| `check_index.py` | 快速仅索引核对 | 轻量索引一致性检查。 |
| `backfill_common_shelf_groups.py` | 常用货架组补齐 | 显式补齐历史库缺失的 `common_shelf_group` 记录，默认 dry-run。 |
| `migrate_legacy_tables_with_copy.py` | 从旧表名升级 | 把 `reagentorder/consumableorder` 数据迁移到新表名。 |
| `rebuild_inventory_tables_if_missing_source_order_fk.py` | 旧库存表缺外键 | 仅在 `inventory.source_order_id` 外键缺失时重建库存相关表。 |
| `normalize_legacy_enum_storage.py` | 历史枚举值纠偏 | 将旧 `enum.name` 转为当前 `enum.value`（小写）。 |
| `normalize_legacy_enums.py` | 同上（便捷入口） | 调用 `normalize_legacy_enum_storage.py`。 |
| `regenerate_internal_codes.py` | 内部编码重排 | 重新生成 `internal_code`（支持 dry-run / apply）。 |
| `upgrade_internal_code_width.py` | 历史编码宽度升级 | 把旧宽度编码升级到新格式。 |
| `migration/import_users.py` | 首次导入用户 | 从 `user_mapping.csv` 导入用户并补拼音字段。 |
| `migration/import_reagent_orders.py` | 导入试剂订单 | 使用新表名、小写枚举值、补拼音全拼+首字母。 |
| `migration/import_consumable_orders.py` | 导入耗材订单 | 使用新表名、小写枚举值、补拼音全拼+首字母。 |
| `migration/import_inventory.py` | 导入库存 | 使用当前 `inventory` 字段结构，补拼音全拼+首字母。 |
| `migration/rebuild_pinyin.py` | 历史数据补拼音 | 按表批量重建拼音字段（支持 all/单表）。 |
| `rebuild_order_pinyin.py` | 兼容旧用法 | 兼容入口，内部转调 `migration/rebuild_pinyin.py`。 |

## 一次性/历史脚本（建议归档，不建议日常使用）

| 脚本 | 原用途 | 当前建议 |
|---|---|---|
| `migrate_null_values.py` | 早期 NULL 迁移并重建旧索引 | 不建议再用（索引策略已变化）。 |
| `fix_cas_numbers.py` | 对特定历史库做 CAS 批量修正 | 仅针对当时数据，日常不用。 |
| `verify_cas_numbers.py` | 联网核查 CAS | 依赖旧路径/外部服务，建议按需重写。 |
| `xlsx_fix_cas_numbers.py` | XLSX 内 CAS 批量替换 | 仅做离线清洗，按需使用。 |
| `format_reagent_csv.py` | 旧 CSV 格式转换 | 旧导入链路专用。 |
| `format_consumable_csv.py` | 旧 CSV 格式转换 | 旧导入链路专用。 |
| `scrape_old_system.py` | 旧系统抓取 | 仅迁移阶段可用。 |
| `sse_demo_server.py` / `test_sse_demo.py` | SSE 本地演示 | 功能演示用途，非生产迁移。 |
| `test_legacy_enum_storage.py` | 早期枚举迁移测试 | 与当前主流程耦合弱，按需维护。 |

## 常用命令

```bash
# 结构健康检查
python scripts/check_db_health.py

# 枚举值修复（name -> value）
python scripts/normalize_legacy_enums.py

# 从旧表名迁移到新表名
python scripts/migrate_legacy_tables_with_copy.py

# 导入（示例）
python scripts/migration/import_users.py
python scripts/migration/import_reagent_orders.py <xlsx>
python scripts/migration/import_consumable_orders.py <xlsx>
python scripts/migration/import_inventory.py <xlsx>

# 拼音重建
python scripts/migration/rebuild_pinyin.py all

# 常用货架组补齐
python scripts/backfill_common_shelf_groups.py
python scripts/backfill_common_shelf_groups.py --apply
```
