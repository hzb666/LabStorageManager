"""
数据库健康检查脚本

检查项目：
1. CAS号字段校验码、格式检查
2. 拼音字段检查（与源字段一致性）
3. 索引检查（单列索引和复合索引与代码定义一致性）
4. 字段检查（数据库字段与模型定义一致性）
5. 以数据表分组输出内容

用法:
    python scripts/check_db_health.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

# 添加项目根目录到模块搜索路径
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# noqa: E402 - 模块导入必须在路径设置之后
from sqlalchemy import inspect, text  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

import app.models  # noqa: F401, E402
from app.database import engine  # noqa: E402
from app.models.consumable_order import ConsumableOrderStatus  # noqa: E402
from app.models.inventory import InventoryStatus  # noqa: E402
from app.models.reagent_order import ReagentOrderReason, ReagentOrderStatus  # noqa: E402
from app.models.user import UserRole  # noqa: E402
from app.services.pinyin_utils import PINYIN_FIELD_MAX_LENGTH, to_pinyin_parts  # noqa: E402


# ============== 配置 ==============

# 含有CAS号字段的表
CAS_TABLES = {
    "inventory": ("cas_number", "name"),
    "reagent_order": ("cas_number", "name"),
    "common_shelf": ("cas_number", "name_snapshot"),
}

# 拼音字段映射表: {表名: {(源字段, 拼音字段, 首字母字段)}}
PINYIN_MAPPINGS = {
    "inventory": [
        ("name", "name_pinyin", "name_pinyin_initials"),
        ("category", "category_pinyin", "category_pinyin_initials"),
        ("brand", "brand_pinyin", "brand_pinyin_initials"),
        ("storage_location", "storage_location_pinyin", "storage_location_pinyin_initials"),
    ],
    "reagent_order": [
        ("name", "name_pinyin", "name_pinyin_initials"),
        ("brand", "brand_pinyin", "brand_pinyin_initials"),
    ],
    "consumable_order": [
        ("name", "name_pinyin", "name_pinyin_initials"),
    ],
    "users": [
        ("full_name", "full_name_pinyin", "full_name_pinyin_initials"),
    ],
}

# 枚举字段映射：用于检查数据库里是 enum.name 还是 enum.value，是否存在脏值
ENUM_FIELD_MAPPINGS = {
    "inventory": [("status", InventoryStatus)],
    "reagent_order": [
        ("status", ReagentOrderStatus),
        ("order_reason", ReagentOrderReason),
    ],
    "consumable_order": [("status", ConsumableOrderStatus)],
    "users": [("role", UserRole)],
}

# FTS健康检查配置
FTS_MAPPINGS = {
    "inventory": ("inventory_fts", ("trg_inventory_fts_ai", "trg_inventory_fts_ad", "trg_inventory_fts_au")),
    "reagent_order": (
        "reagent_order_fts",
        ("trg_reagent_order_fts_ai", "trg_reagent_order_fts_ad", "trg_reagent_order_fts_au"),
    ),
    "consumable_order": (
        "consumable_order_fts",
        ("trg_consumable_order_fts_ai", "trg_consumable_order_fts_ad", "trg_consumable_order_fts_au"),
    ),
    "users": ("users_fts", ("trg_users_fts_ai", "trg_users_fts_ad", "trg_users_fts_au")),
    "chemical_name_map": (
        "chemical_name_map_fts",
        ("trg_chemical_name_map_fts_ai", "trg_chemical_name_map_fts_ad", "trg_chemical_name_map_fts_au"),
    ),
}


# ============== CAS号校验 ==============

def validate_cas_format(cas: str) -> tuple[bool, str]:
    """
    验证CAS号格式和校验码
    返回: (是否合法, 错误信息)
    """
    if not cas or not isinstance(cas, str):
        return False, "为空或非字符串"

    cas = cas.strip()

    # 1. 检查基本格式: 三段数字用连字符分隔
    pattern = r"^(\d{2,7})-(\d{2})-(\d)$"
    match = re.match(pattern, cas)
    if not match:
        parts = cas.split("-")
        if len(parts) != 3:
            return False, f"格式错误: 应为 '数字-数字-数字'，实际为 '{cas}'"
        if not all(p.isdigit() for p in parts):
            return False, f"格式错误: 包含非数字字符 '{cas}'"
        if not (2 <= len(parts[0]) <= 7):
            return False, f"第一段长度错误: 应为 2-7 位，实际为 {len(parts[0])} 位"
        if len(parts[1]) != 2:
            return False, f"第二段长度错误: 应为 2 位，实际为 {len(parts[1])} 位"
        if len(parts[2]) != 1:
            return False, f"第三段长度错误: 应为 1 位，实际为 {len(parts[2])} 位"
        return False, f"格式不匹配 '{cas}'"

    part1, part2, check_digit = match.groups()

    # 2. 计算校验码（标准递增权重算法）
    digits = list(part1 + part2)
    digits.reverse()

    total = 0
    for i, digit in enumerate(digits, start=1):
        total += int(digit) * i

    calculated_check = total % 10

    if int(check_digit) != calculated_check:
        return False, f"校验码错误: 输入 '{check_digit}'，应为 '{calculated_check}' (总和={total})"

    return True, "合法"


def check_cas_numbers(insp: inspect) -> dict[str, Any]:
    """检查CAS号字段"""
    results: dict[str, Any] = {}

    for table_name, (cas_field, name_field) in CAS_TABLES.items():
        table_results: dict[str, Any] = {
            "total": 0,
            "valid": 0,
            "invalid": 0,
            "empty": 0,
            "invalid_cas": [],
            "empty_cas": [],
        }

        # 获取表的所有行
        try:
            with engine.connect() as conn:
                result = conn.execute(
                    text(f"SELECT id, {name_field}, {cas_field} FROM {table_name}")
                )
                rows = result.fetchall()
        except Exception as e:
            table_results["error"] = str(e)
            results[table_name] = table_results
            continue

        table_results["total"] = len(rows)

        for row in rows:
            row_id, name, cas_value = row[0], row[1], row[2]

            if not cas_value or not str(cas_value).strip():
                table_results["empty"] += 1
                table_results["empty_cas"].append({
                    "id": row_id,
                    "name": name,
                    "cas_number": repr(cas_value),
                })
                continue

            is_valid, msg = validate_cas_format(cas_value)
            if is_valid:
                table_results["valid"] += 1
            else:
                table_results["invalid"] += 1
                table_results["invalid_cas"].append({
                    "id": row_id,
                    "name": name,
                    "cas_number": cas_value,
                    "reason": msg,
                })

        results[table_name] = table_results

    return results


# ============== 拼音字段检查 ==============

def check_pinyin_fields(insp: inspect) -> dict[str, Any]:
    """检查拼音字段与源字段的一致性"""
    results: dict[str, Any] = {}

    for table_name, mappings in PINYIN_MAPPINGS.items():
        table_results: dict[str, Any] = {
            "total": 0,
            "mismatch": [],
        }

        # 构建查询字段列表
        fields = ["id"]
        for source_field, pinyin_field, initials_field in mappings:
            fields.extend([source_field, pinyin_field, initials_field])
        fields_str = ", ".join(fields)

        try:
            with engine.connect() as conn:
                result = conn.execute(text(f"SELECT {fields_str} FROM {table_name}"))
                rows = result.fetchall()
        except Exception as e:
            table_results["error"] = str(e)
            results[table_name] = table_results
            continue

        table_results["total"] = len(rows)

        # 获取字段索引
        field_indices = {}
        for i, f in enumerate(fields):
            field_indices[f] = i

        for row in rows:
            row_id = row[0]

            for source_field, pinyin_field, initials_field in mappings:
                source_idx = field_indices[source_field]
                pinyin_idx = field_indices[pinyin_field]
                initials_idx = field_indices[initials_field]

                source_value = row[source_idx]
                pinyin_value = row[pinyin_idx]
                initials_value = row[initials_idx]

                # 如果源字段为空，跳过检查
                if not source_value:
                    continue

                # 计算期望的拼音值
                expected_pinyin, expected_initials = to_pinyin_parts(source_value)
                expected_pinyin = expected_pinyin[:PINYIN_FIELD_MAX_LENGTH]
                expected_initials = expected_initials[:PINYIN_FIELD_MAX_LENGTH]

                # 比较
                if pinyin_value != expected_pinyin:
                    table_results["mismatch"].append({
                        "id": row_id,
                        "source_field": source_field,
                        "source_value": source_value,
                        "pinyin_field": pinyin_field,
                        "expected": expected_pinyin,
                        "actual": pinyin_value,
                        "type": "pinyin",
                    })

                if initials_value != expected_initials:
                    table_results["mismatch"].append({
                        "id": row_id,
                        "source_field": source_field,
                        "source_value": source_value,
                        "initials_field": initials_field,
                        "expected": expected_initials,
                        "actual": initials_value,
                        "type": "initials",
                    })

        results[table_name] = table_results

    return results


# ============== 索引检查 ==============

def check_indexes(insp: inspect) -> dict[str, Any]:
    """检查索引与模型定义的一致性"""
    results: dict[str, Any] = {}
    meta = SQLModel.metadata

    db_tables = set(insp.get_table_names())

    for table_name, table in meta.tables.items():
        if table_name not in db_tables:
            results[table_name] = {"missing_table": True}
            continue

        # 从模型获取期望索引
        model_indexes: dict[str, list[str]] = {}
        # 单列索引 (Field(index=True))
        for col in table.columns:
            if col.index and not any(idx.name for idx in table.indexes if col.name in [c.name for c in idx.columns]):
                # 跳过已在复合索引中定义的列
                pass
        # 复合索引 (__table_args__ 中的 Index)
        for idx in table.indexes:
            if idx.name:
                model_indexes[idx.name] = [c.name for c in idx.columns]

        # 获取数据库实际索引
        db_indexes: dict[str, list[str]] = {}
        for idx in insp.get_indexes(table_name):
            idx_name = idx.get("name")
            if idx_name and not idx_name.startswith("sqlite_autoindex_"):
                db_indexes[idx_name] = idx.get("column_names") or []

        # 比较
        missing = sorted(set(model_indexes) - set(db_indexes))
        extra = sorted(set(db_indexes) - set(model_indexes))
        mismatches = []

        for idx_name in sorted(set(model_indexes) & set(db_indexes)):
            if model_indexes[idx_name] != db_indexes[idx_name]:
                mismatches.append({
                    "index": idx_name,
                    "expected": model_indexes[idx_name],
                    "actual": db_indexes[idx_name],
                })

        results[table_name] = {
            "model_indexes": model_indexes,
            "db_indexes": db_indexes,
            "missing_indexes": missing,
            "extra_indexes": extra,
            "mismatch_indexes": mismatches,
        }

    return results


# ============== 字段检查 ==============

def check_columns(insp: inspect) -> dict[str, Any]:
    """检查数据库字段与模型定义的一致性"""
    results: dict[str, Any] = {}
    meta = SQLModel.metadata

    db_tables = set(insp.get_table_names())

    for table_name, table in meta.tables.items():
        if table_name not in db_tables:
            results[table_name] = {"missing_table": True}
            continue

        # 获取模型字段
        model_cols = {col.name: col for col in table.columns}

        # 获取数据库字段
        db_cols = {col["name"]: col for col in insp.get_columns(table_name)}

        missing = sorted(set(model_cols) - set(db_cols))
        extra = sorted(set(db_cols) - set(model_cols))

        type_mismatches = []
        for col_name in sorted(set(model_cols) & set(db_cols)):
            model_type = str(model_cols[col_name].type).upper()
            db_type = str(db_cols[col_name]["type"]).upper()
            if model_type != db_type:
                type_mismatches.append({
                    "column": col_name,
                    "model_type": model_type,
                    "db_type": db_type,
                })

        results[table_name] = {
            "model_columns": list(model_cols.keys()),
            "db_columns": list(db_cols.keys()),
            "missing_columns": missing,
            "extra_columns": extra,
            "type_mismatches": type_mismatches,
        }

    return results


# ============== 枚举值检查 ==============

def check_enum_values(insp: inspect) -> dict[str, Any]:
    """检查枚举字段存储值是否一致（name/value/脏值/混用）。"""
    results: dict[str, Any] = {}
    db_tables = set(insp.get_table_names())

    for table_name, field_mappings in ENUM_FIELD_MAPPINGS.items():
        table_results: dict[str, Any] = {}
        if table_name not in db_tables:
            table_results["missing_table"] = True
            results[table_name] = table_results
            continue

        for field_name, enum_cls in field_mappings:
            expected_names = {member.name for member in enum_cls}
            expected_values = {str(member.value) for member in enum_cls}

            with engine.connect() as conn:
                rows = conn.execute(
                    text(
                        f"""
                        SELECT {field_name}, COUNT(*)
                        FROM {table_name}
                        GROUP BY {field_name}
                        """
                    )
                ).fetchall()

            names_found: dict[str, int] = {}
            values_found: dict[str, int] = {}
            invalid_found: dict[str, int] = {}

            for raw_value, count in rows:
                value = str(raw_value) if raw_value is not None else "NULL"
                if value in expected_names:
                    names_found[value] = count
                elif value in expected_values:
                    values_found[value] = count
                else:
                    invalid_found[value] = count

            storage_mode = "empty"
            if names_found and not values_found:
                storage_mode = "enum.name(大写)"
            elif values_found and not names_found:
                storage_mode = "enum.value(小写)"
            elif names_found and values_found:
                storage_mode = "mixed(混用)"

            table_results[field_name] = {
                "storage_mode": storage_mode,
                "names_found": names_found,
                "values_found": values_found,
                "invalid_found": invalid_found,
            }

        results[table_name] = table_results

    return results


# ============== FTS检查 ==============

def check_fts_health(insp: inspect) -> dict[str, Any]:
    """检查 FTS 虚拟表/触发器是否存在，行数是否与源表一致。"""
    results: dict[str, Any] = {}
    db_tables = set(insp.get_table_names())

    for source_table, (fts_table, trigger_names) in FTS_MAPPINGS.items():
        item: dict[str, Any] = {
            "source_table_exists": source_table in db_tables,
            "fts_table_exists": fts_table in db_tables,
            "missing_triggers": [],
            "source_count": None,
            "fts_count": None,
            "count_match": None,
            "missing_in_fts": None,
            "orphan_in_fts": None,
            "rowid_sync": None,
        }

        with engine.connect() as conn:
            for trigger_name in trigger_names:
                trigger_exists = conn.execute(
                    text(
                        """
                        SELECT 1
                        FROM sqlite_master
                        WHERE type = 'trigger' AND name = :trigger_name
                        """
                    ),
                    {"trigger_name": trigger_name},
                ).first() is not None
                if not trigger_exists:
                    item["missing_triggers"].append(trigger_name)

            if item["source_table_exists"]:
                item["source_count"] = conn.execute(
                    text(f"SELECT COUNT(*) FROM {source_table}")
                ).scalar_one()
            if item["fts_table_exists"]:
                item["fts_count"] = conn.execute(
                    text(f"SELECT COUNT(*) FROM {fts_table}")
                ).scalar_one()
            if item["source_table_exists"] and item["fts_table_exists"]:
                item["missing_in_fts"] = conn.execute(
                    text(
                        f"""
                        SELECT COUNT(*)
                        FROM {source_table} AS source
                        LEFT JOIN {fts_table} AS fts
                            ON fts.rowid = source.id
                        WHERE fts.rowid IS NULL
                        """
                    )
                ).scalar_one()
                item["orphan_in_fts"] = conn.execute(
                    text(
                        f"""
                        SELECT COUNT(*)
                        FROM {fts_table} AS fts
                        LEFT JOIN {source_table} AS source
                            ON source.id = fts.rowid
                        WHERE source.id IS NULL
                        """
                    )
                ).scalar_one()

        if item["source_count"] is not None and item["fts_count"] is not None:
            item["count_match"] = (item["source_count"] == item["fts_count"])
        if item["missing_in_fts"] is not None and item["orphan_in_fts"] is not None:
            item["rowid_sync"] = (item["missing_in_fts"] == 0 and item["orphan_in_fts"] == 0)

        results[source_table] = item

    return results


# ============== 外键完整性检查 ==============

def check_foreign_key_integrity() -> dict[str, Any]:
    """检查 SQLite 外键完整性（PRAGMA foreign_key_check）。"""
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA foreign_key_check")).fetchall()

    violations = []
    for row in rows:
        # sqlite 返回: (table, rowid, parent, fkid)
        violations.append({
            "table": row[0],
            "rowid": row[1],
            "parent": row[2],
            "fkid": row[3],
        })

    return {
        "violation_count": len(violations),
        "violations": violations,
    }


def check_sqlite_runtime_health() -> dict[str, Any]:
    """检查 SQLite 运行时关键健康项。"""
    with engine.connect() as conn:
        journal_mode = conn.execute(text("PRAGMA journal_mode")).scalar()
        foreign_keys = conn.execute(text("PRAGMA foreign_keys")).scalar()
        quick_check_rows = conn.execute(text("PRAGMA quick_check")).fetchall()

    quick_check_messages = [str(row[0]) for row in quick_check_rows]
    quick_check_ok = len(quick_check_messages) == 1 and quick_check_messages[0].lower() == "ok"

    return {
        "journal_mode": str(journal_mode).lower() if journal_mode is not None else None,
        "foreign_keys_enabled": bool(foreign_keys),
        "quick_check_ok": quick_check_ok,
        "quick_check_messages": quick_check_messages,
    }


# ============== 主函数 ==============

def main() -> int:
    """运行所有检查并输出报告"""
    print("=" * 70)
    print("数据库健康检查报告")
    print("=" * 70)

    insp = inspect(engine)

    # 1. CAS号检查
    print("\n" + "=" * 70)
    print("[1] CAS号字段检查 (格式和校验码)")
    print("-" * 70)
    cas_results = check_cas_numbers(insp)

    for table_name, result in cas_results.items():
        print(f"\n--- 表: {table_name} ---")
        if "error" in result:
            print(f"  错误: {result['error']}")
            continue

        print(f"  总数: {result['total']}")
        print(f"  合法: {result['valid']}")
        print(f"  非法: {result['invalid']}")
        print(f"  空值: {result['empty']}")

        if result.get("invalid_cas"):
            print("\n  非法CAS号 (前10条):")
            for item in result["invalid_cas"][:10]:
                print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}")
                print(f"    原因: {item['reason']}")

        if result.get("empty_cas"):
            print("\n  空CAS号 (前10条):")
            for item in result["empty_cas"][:10]:
                print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}")

    # 2. 拼音字段检查
    print("\n" + "=" * 70)
    print("[2] 拼音字段检查 (与源字段一致性)")
    print("-" * 70)
    pinyin_results = check_pinyin_fields(insp)

    for table_name, result in pinyin_results.items():
        print(f"\n--- 表: {table_name} ---")
        if "error" in result:
            print(f"  错误: {result['error']}")
            continue

        print(f"  总记录数: {result['total']}")
        mismatch_count = len(result.get("mismatch", []))
        print(f"  不匹配数: {mismatch_count}")

        if result.get("mismatch"):
            print("\n  不匹配记录 (前10条):")
            for item in result["mismatch"][:10]:
                if item["type"] == "pinyin":
                    print(f"    ID={item['id']}, 字段={item['source_field']}, 值={item['source_value']}")
                    print(f"      拼音字段: 期望='{item['expected']}', 实际='{item['actual']}'")
                else:
                    print(f"    ID={item['id']}, 字段={item['source_field']}, 值={item['source_value']}")
                    print(f"      首字母字段: 期望='{item['expected']}', 实际='{item['actual']}'")

    # 3. 索引检查
    print("\n" + "=" * 70)
    print("[3] 索引检查 (与模型定义一致性)")
    print("-" * 70)
    index_results = check_indexes(insp)

    for table_name, result in index_results.items():
        print(f"\n--- 表: {table_name} ---")
        if result.get("missing_table"):
            print("  表不存在")
            continue

        if result.get("missing_indexes"):
            print(f"  缺失索引: {result['missing_indexes']}")

        if result.get("extra_indexes"):
            print(f"  多余索引: {result['extra_indexes']}")

        if result.get("mismatch_indexes"):
            print("  索引列不匹配:")
            for item in result["mismatch_indexes"]:
                print(f"    索引={item['index']}, 期望={item['expected']}, 实际={item['actual']}")

        if not result.get("missing_indexes") and not result.get("extra_indexes") and not result.get("mismatch_indexes"):
            print("  ✓ 索引检查通过")

    # 4. 字段检查
    print("\n" + "=" * 70)
    print("[4] 字段检查 (与模型定义一致性)")
    print("-" * 70)
    column_results = check_columns(insp)

    for table_name, result in column_results.items():
        print(f"\n--- 表: {table_name} ---")
        if result.get("missing_table"):
            print("  表不存在")
            continue

        if result.get("missing_columns"):
            print(f"  缺失字段: {result['missing_columns']}")

        if result.get("extra_columns"):
            print(f"  多余字段: {result['extra_columns']}")

        if result.get("type_mismatches"):
            print("  类型不匹配:")
            for item in result["type_mismatches"]:
                print(f"    字段={item['column']}, 模型={item['model_type']}, 数据库={item['db_type']}")

        if not result.get("missing_columns") and not result.get("extra_columns") and not result.get("type_mismatches"):
            print("  ✓ 字段检查通过")

    # 5. 枚举值检查
    print("\n" + "=" * 70)
    print("[5] 枚举值检查 (name/value/脏值/混用)")
    print("-" * 70)
    enum_results = check_enum_values(insp)

    for table_name, result in enum_results.items():
        print(f"\n--- 表: {table_name} ---")
        if result.get("missing_table"):
            print("  表不存在")
            continue

        for field_name, field_result in result.items():
            if not isinstance(field_result, dict):
                continue
            print(f"  字段: {field_name}")
            print(f"    存储模式: {field_result['storage_mode']}")
            if field_result.get("names_found"):
                print(f"    enum.name 命中: {field_result['names_found']}")
            if field_result.get("values_found"):
                print(f"    enum.value 命中: {field_result['values_found']}")
            if field_result.get("invalid_found"):
                print(f"    非法值: {field_result['invalid_found']}")

    # 6. FTS健康检查
    print("\n" + "=" * 70)
    print("[6] FTS健康检查 (表/触发器/行数同步)")
    print("-" * 70)
    fts_results = check_fts_health(insp)

    for source_table, result in fts_results.items():
        print(f"\n--- 源表: {source_table} ---")
        print(f"  源表存在: {result['source_table_exists']}")
        print(f"  FTS表存在: {result['fts_table_exists']}")
        print(f"  源表行数: {result['source_count']}")
        print(f"  FTS行数: {result['fts_count']}")
        if result['count_match'] is not None:
            print(f"  行数同步: {result['count_match']}")
        if result['missing_in_fts'] is not None:
            print(f"  源表缺失到FTS: {result['missing_in_fts']}")
        if result['orphan_in_fts'] is not None:
            print(f"  FTS孤儿行: {result['orphan_in_fts']}")
        if result['rowid_sync'] is not None:
            print(f"  rowid映射同步: {result['rowid_sync']}")
        if result['missing_triggers']:
            print(f"  缺失触发器: {result['missing_triggers']}")
        elif result['source_table_exists'] and result['fts_table_exists']:
            print("  ✓ 触发器检查通过")

    # 7. 外键完整性检查
    print("\n" + "=" * 70)
    print("[7] 外键完整性检查 (PRAGMA foreign_key_check)")
    print("-" * 70)
    fk_result = check_foreign_key_integrity()
    print(f"外键违规总数: {fk_result['violation_count']}")
    if fk_result["violations"]:
        print("违规记录 (前20条):")
        for item in fk_result["violations"][:20]:
            print(
                f"  表={item['table']}, rowid={item['rowid']}, parent={item['parent']}, fkid={item['fkid']}"
            )
    else:
        print("✓ 外键完整性检查通过")

    # 8. SQLite 运行时健康检查
    print("\n" + "=" * 70)
    print("[8] SQLite运行时健康检查 (WAL/外键/quick_check)")
    print("-" * 70)
    runtime_health = check_sqlite_runtime_health()
    print(f"journal_mode: {runtime_health['journal_mode']}")
    print(f"foreign_keys: {runtime_health['foreign_keys_enabled']}")
    print(f"quick_check: {runtime_health['quick_check_ok']}")
    if not runtime_health["quick_check_ok"]:
        print(f"quick_check详情: {runtime_health['quick_check_messages']}")

    # 总结
    print("\n" + "=" * 70)
    print("检查完成")
    print("=" * 70)

    # 统计问题数量
    total_issues = 0

    # CAS号问题
    for table_name, result in cas_results.items():
        if "error" not in result:
            total_issues += result.get("invalid", 0) + result.get("empty", 0)

    # 拼音问题
    for table_name, result in pinyin_results.items():
        if "error" not in result:
            total_issues += len(result.get("mismatch", []))

    # 索引问题
    for table_name, result in index_results.items():
        if not result.get("missing_table"):
            total_issues += len(result.get("missing_indexes", []))
            total_issues += len(result.get("extra_indexes", []))
            total_issues += len(result.get("mismatch_indexes", []))

    # 字段问题
    for table_name, result in column_results.items():
        if not result.get("missing_table"):
            total_issues += len(result.get("missing_columns", []))
            total_issues += len(result.get("extra_columns", []))

    # 枚举问题
    for table_name, result in enum_results.items():
        if result.get("missing_table"):
            continue
        for field_name, field_result in result.items():
            if not isinstance(field_result, dict):
                continue
            if field_result.get("storage_mode") == "mixed(混用)":
                total_issues += 1
            total_issues += len(field_result.get("invalid_found", {}))

    # FTS问题
    for source_table, result in fts_results.items():
        if not result["source_table_exists"] or not result["fts_table_exists"]:
            total_issues += 1
        if result.get("count_match") is False:
            total_issues += 1
        if result.get("rowid_sync") is False:
            total_issues += 1
        total_issues += len(result.get("missing_triggers", []))

    # 外键问题
    total_issues += fk_result.get("violation_count", 0)

    # SQLite 运行时问题
    if runtime_health.get("journal_mode") != "wal":
        total_issues += 1
    if not runtime_health.get("foreign_keys_enabled"):
        total_issues += 1
    if not runtime_health.get("quick_check_ok"):
        total_issues += 1

    print(f"发现问题总数: {total_issues}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
