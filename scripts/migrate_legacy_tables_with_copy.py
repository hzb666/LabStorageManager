"""Migrate legacy table names to snake_case tables by copying shared columns."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import engine

LEGACY_TABLE_MIGRATIONS: tuple[tuple[str, str], ...] = (
    ("reagentorder", "reagent_order"),
    ("consumableorder", "consumable_order"),
)


def migrate_legacy_tables_with_copy() -> int:
    """Copy data from old table names into new table names and drop old tables when possible."""
    migrated_rows = 0

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        for old_table, new_table in LEGACY_TABLE_MIGRATIONS:
            if old_table not in table_names or new_table not in table_names:
                continue

            old_columns = [column["name"] for column in inspector.get_columns(old_table)]
            new_columns = [column["name"] for column in inspector.get_columns(new_table)]
            shared_columns = [column for column in new_columns if column in old_columns]
            if not shared_columns:
                continue

            column_clause = ", ".join(shared_columns)
            if "id" in shared_columns:
                insert_sql = text(
                    f"""
                    INSERT INTO {new_table} ({column_clause})
                    SELECT {column_clause}
                    FROM {old_table}
                    WHERE id NOT IN (SELECT id FROM {new_table})
                    """
                )
            else:
                insert_sql = text(
                    f"""
                    INSERT INTO {new_table} ({column_clause})
                    SELECT {column_clause}
                    FROM {old_table}
                    """
                )

            result = connection.execute(insert_sql)
            migrated_rows += result.rowcount or 0

            try:
                connection.execute(text(f"DROP TABLE {old_table}"))
                table_names.remove(old_table)
            except Exception as exc:  # noqa: BLE001
                print(f"WARN: copied {old_table} -> {new_table}, but drop failed: {exc}")

    return migrated_rows


def main() -> int:
    """Run legacy table migration and print migrated row count."""
    migrated_rows = migrate_legacy_tables_with_copy()
    print(f"Migrated rows: {migrated_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
