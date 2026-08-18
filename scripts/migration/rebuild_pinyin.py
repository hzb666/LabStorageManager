"""
一次性脚本：重建拼音字段

用于为历史数据重建拼音搜索字段（全拼 + 首字母）。
注意：此脚本只负责重建数据，不负责补列或建索引；请先确保数据库结构已更新。
"""
import sqlite3
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.services.pinyin_utils import compute_pinyin_fields  # noqa: E402


DB_PATH = ROOT_DIR / "lab_inventory.db"
SUPPORTED_TABLES = ("all", "inventory", "reagent_order", "consumable_order", "users")


def _ensure_columns(cursor: sqlite3.Cursor, table_name: str, required_columns: tuple[str, ...]) -> None:
    existing_columns = {
        row[1]
        for row in cursor.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    missing = [column for column in required_columns if column not in existing_columns]
    if missing:
        missing_list = ", ".join(missing)
        raise RuntimeError(
            f"表 {table_name} 缺少列: {missing_list}。"
            "请先运行应用启动补结构逻辑或手动补列/索引后再执行本脚本。"
        )


def _update_inventory(cursor: sqlite3.Cursor) -> int:
    table_name = "inventory"
    _ensure_columns(
        cursor,
        table_name,
        (
            "name_pinyin",
            "name_pinyin_initials",
            "brand_pinyin",
            "brand_pinyin_initials",
            "storage_location_pinyin",
            "storage_location_pinyin_initials",
        ),
    )
    rows = cursor.execute(
        """
        SELECT id, name, category, brand, storage_location, alias
        FROM inventory
        """
    ).fetchall()

    total = len(rows)
    if total == 0:
        print("[inventory] 无记录")
        return 0

    print(f"[inventory] 开始重建，共 {total} 条记录...")
    for index, (row_id, name, category, brand, storage_location, alias) in enumerate(rows, start=1):
        fields = compute_pinyin_fields(
            name=name,
            category=category,
            brand=brand,
            storage_location=storage_location,
            alias=alias,
        )
        cursor.execute(
            """
            UPDATE inventory
            SET name_pinyin = ?,
                name_pinyin_initials = ?,
                category_pinyin = ?,
                category_pinyin_initials = ?,
                brand_pinyin = ?,
                brand_pinyin_initials = ?,
                storage_location_pinyin = ?,
                storage_location_pinyin_initials = ?
            WHERE id = ?
            """,
            (
                fields.get("name_pinyin"),
                fields.get("name_pinyin_initials"),
                fields.get("category_pinyin"),
                fields.get("category_pinyin_initials"),
                fields.get("brand_pinyin"),
                fields.get("brand_pinyin_initials"),
                fields.get("storage_location_pinyin"),
                fields.get("storage_location_pinyin_initials"),
                row_id,
            ),
        )
        if index % 1000 == 0:
            print(f"[inventory] 已处理 {index}/{total} 条...")

    print(f"[inventory] 完成，共更新 {total} 条记录")
    return total


def _update_reagent_orders(cursor: sqlite3.Cursor) -> int:
    table_name = "reagent_order"
    _ensure_columns(
        cursor,
        table_name,
        (
            "name_pinyin",
            "name_pinyin_initials",
            "brand_pinyin",
            "brand_pinyin_initials",
        ),
    )
    rows = cursor.execute(
        """
        SELECT id, name, brand, alias
        FROM reagent_order
        """
    ).fetchall()

    total = len(rows)
    if total == 0:
        print("[reagent_order] 无记录")
        return 0

    print(f"[reagent_order] 开始重建，共 {total} 条记录...")
    for index, (row_id, name, brand, alias) in enumerate(rows, start=1):
        fields = compute_pinyin_fields(
            name=name,
            brand=brand,
            alias=alias,
        )
        cursor.execute(
            """
            UPDATE reagent_order
            SET name_pinyin = ?,
                name_pinyin_initials = ?,
                brand_pinyin = ?,
                brand_pinyin_initials = ?
            WHERE id = ?
            """,
            (
                fields.get("name_pinyin"),
                fields.get("name_pinyin_initials"),
                fields.get("brand_pinyin"),
                fields.get("brand_pinyin_initials"),
                row_id,
            ),
        )
        if index % 1000 == 0:
            print(f"[reagent_order] 已处理 {index}/{total} 条...")

    print(f"[reagent_order] 完成，共更新 {total} 条记录")
    return total


def _update_consumable_orders(cursor: sqlite3.Cursor) -> int:
    table_name = "consumable_order"
    _ensure_columns(
        cursor,
        table_name,
        (
            "name_pinyin",
            "name_pinyin_initials",
        ),
    )
    rows = cursor.execute(
        """
        SELECT id, name
        FROM consumable_order
        """
    ).fetchall()

    total = len(rows)
    if total == 0:
        print("[consumable_order] 无记录")
        return 0

    print(f"[consumable_order] 开始重建，共 {total} 条记录...")
    for index, (row_id, name) in enumerate(rows, start=1):
        fields = compute_pinyin_fields(name=name)
        cursor.execute(
            """
            UPDATE consumable_order
            SET name_pinyin = ?,
                name_pinyin_initials = ?
            WHERE id = ?
            """,
            (
                fields.get("name_pinyin"),
                fields.get("name_pinyin_initials"),
                row_id,
            ),
        )
        if index % 1000 == 0:
            print(f"[consumable_order] 已处理 {index}/{total} 条...")

    print(f"[consumable_order] 完成，共更新 {total} 条记录")
    return total


def _update_users(cursor: sqlite3.Cursor) -> int:
    table_name = "users"
    _ensure_columns(
        cursor,
        table_name,
        (
            "full_name_pinyin",
            "full_name_pinyin_initials",
        ),
    )
    rows = cursor.execute(
        """
        SELECT id, full_name
        FROM users
        """
    ).fetchall()

    total = len(rows)
    if total == 0:
        print("[users] 无记录")
        return 0

    print(f"[users] 开始重建，共 {total} 条记录...")
    for index, (row_id, full_name) in enumerate(rows, start=1):
        fields = compute_pinyin_fields(full_name=full_name)
        cursor.execute(
            """
            UPDATE users
            SET full_name_pinyin = ?,
                full_name_pinyin_initials = ?
            WHERE id = ?
            """,
            (
                fields.get("full_name_pinyin"),
                fields.get("full_name_pinyin_initials"),
                row_id,
            ),
        )
        if index % 1000 == 0:
            print(f"[users] 已处理 {index}/{total} 条...")

    print(f"[users] 完成，共更新 {total} 条记录")
    return total


TABLE_HANDLERS = {
    "inventory": _update_inventory,
    "reagent_order": _update_reagent_orders,
    "consumable_order": _update_consumable_orders,
    "users": _update_users,
}


def rebuild_pinyin(table: str = "all") -> None:
    """重建指定表的拼音字段。"""
    if not DB_PATH.exists():
        raise FileNotFoundError(f"数据库文件不存在: {DB_PATH}")

    with sqlite3.connect(str(DB_PATH)) as conn:
        cursor = conn.cursor()

        print(f"数据库路径: {DB_PATH}")
        print(f"处理模式: {table}")
        print("-" * 40)

        if table == "all":
            for table_name, handler in TABLE_HANDLERS.items():
                handler(cursor)
                conn.commit()
        elif table in TABLE_HANDLERS:
            TABLE_HANDLERS[table](cursor)
            conn.commit()
        else:
            valid = ", ".join(SUPPORTED_TABLES)
            raise ValueError(f"未知表名: {table}。支持的参数: {valid}")

        print("-" * 40)
        print("全部完成！")


if __name__ == "__main__":
    table_arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    if table_arg not in SUPPORTED_TABLES:
        print(f"用法: python scripts/migration/rebuild_pinyin.py [{'|'.join(SUPPORTED_TABLES)}]")
        sys.exit(1)

    rebuild_pinyin(table_arg)
