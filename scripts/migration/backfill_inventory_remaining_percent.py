"""
回填 inventory.remaining_percent 脚本。

规则：
- initial_quantity > 0 且 remaining_quantity 不为空时：remaining_percent = remaining_quantity / initial_quantity
- 其他情况：remaining_percent = NULL

用法：
    python scripts/migration/backfill_inventory_remaining_percent.py
    python scripts/migration/backfill_inventory_remaining_percent.py --db d:/Code/LabStorageManager/lab_inventory.db
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DEFAULT_DB = "d:/Code/LabStorageManager/lab_inventory.db"


def backfill_remaining_percent(db_path: str) -> None:
    db_file = Path(db_path)
    if not db_file.exists():
        raise FileNotFoundError(f"数据库文件不存在: {db_path}")

    conn = sqlite3.connect(str(db_file))
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM inventory")
    total_before = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM inventory WHERE remaining_percent IS NULL")
    null_before = cursor.fetchone()[0]

    update_sql = """
    UPDATE inventory
    SET remaining_percent = CASE
        WHEN initial_quantity IS NOT NULL
             AND initial_quantity > 0
             AND remaining_quantity IS NOT NULL
        THEN remaining_quantity * 1.0 / initial_quantity
        ELSE NULL
    END
    """
    cursor.execute(update_sql)
    affected = cursor.rowcount

    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM inventory WHERE remaining_percent IS NULL")
    null_after = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT COUNT(*)
        FROM inventory
        WHERE remaining_percent IS NOT NULL
          AND (remaining_percent < 0 OR remaining_percent > 1)
        """
    )
    out_of_range = cursor.fetchone()[0]

    conn.close()

    print("回填完成")
    print(f"数据库: {db_path}")
    print(f"总记录: {total_before}")
    print(f"回填前 remaining_percent 为空: {null_before}")
    print(f"UPDATE 影响行数: {affected}")
    print(f"回填后 remaining_percent 为空: {null_after}")
    print(f"范围异常(<0 或 >1)记录数: {out_of_range}")


def main() -> None:
    parser = argparse.ArgumentParser(description="回填 inventory.remaining_percent")
    parser.add_argument("--db", default=DEFAULT_DB, help="SQLite 数据库路径")
    args = parser.parse_args()

    backfill_remaining_percent(args.db)


if __name__ == "__main__":
    main()
