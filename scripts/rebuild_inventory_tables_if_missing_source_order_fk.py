"""Rebuild inventory-related tables when source_order_id foreign key is missing."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models  # noqa: F401
from app.database import engine


def _copy_shared_columns(connection, source_table: str, target_table: str) -> int:
    """Copy shared columns from source table to target table."""
    source_columns = [
        row[1] for row in connection.execute(text(f"PRAGMA table_info({source_table})"))
    ]
    target_columns = [
        row[1] for row in connection.execute(text(f"PRAGMA table_info({target_table})"))
    ]
    shared_columns = [column for column in target_columns if column in source_columns]

    if not shared_columns:
        return 0

    column_clause = ", ".join(shared_columns)
    result = connection.execute(
        text(
            f"""
            INSERT INTO {target_table} ({column_clause})
            SELECT {column_clause}
            FROM {source_table}
            """
        )
    )
    return result.rowcount or 0


def rebuild_inventory_tables_if_missing_source_order_fk() -> int:
    """Rebuild inventory and borrowlog tables only when inventory.source_order_id FK is absent."""
    with engine.begin() as connection:
        inspector = inspect(connection)
        if not inspector.has_table("inventory"):
            return 0

        fk_rows = connection.execute(text("PRAGMA foreign_key_list(inventory)")).fetchall()
        has_source_order_fk = any(
            row[2] == "reagent_order" and row[3] == "source_order_id" for row in fk_rows
        )
        if has_source_order_fk:
            return 0

        has_borrowlog = inspector.has_table("borrowlog")
        connection.execute(text("CREATE TEMP TABLE _tmp_inventory_data AS SELECT * FROM inventory"))
        if has_borrowlog:
            connection.execute(text("CREATE TEMP TABLE _tmp_borrowlog_data AS SELECT * FROM borrowlog"))

        if has_borrowlog:
            connection.execute(text("DROP TABLE borrowlog"))
        connection.execute(text("DROP TABLE inventory"))

        SQLModel.metadata.tables["inventory"].create(connection)
        if has_borrowlog:
            SQLModel.metadata.tables["borrowlog"].create(connection)

        migrated_rows = _copy_shared_columns(connection, "_tmp_inventory_data", "inventory")
        if has_borrowlog:
            migrated_rows += _copy_shared_columns(connection, "_tmp_borrowlog_data", "borrowlog")

        connection.execute(text("DROP TABLE _tmp_inventory_data"))
        if has_borrowlog:
            connection.execute(text("DROP TABLE _tmp_borrowlog_data"))

    return migrated_rows


def main() -> int:
    """Run conditional inventory rebuild and print restored row count."""
    restored_rows = rebuild_inventory_tables_if_missing_source_order_fk()
    print(f"Restored rows: {restored_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
