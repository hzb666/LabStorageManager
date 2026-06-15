"""Normalize legacy enum values from enum.name to enum.value in SQLite tables."""
# ruff: noqa: E402

from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LEGACY_ENUM_VALUE_MAP: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "inventory",
        "status",
        (
            ("NOT_IN_STOCK", "not_in_stock"),
            ("IN_STOCK", "in_stock"),
            ("RUN_SHORT", "run_short"),
            ("BORROWED", "borrowed"),
            ("CONSUMED", "consumed"),
        ),
    ),
    (
        "reagent_order",
        "status",
        (
            ("PENDING", "pending"),
            ("APPROVED", "approved"),
            ("ARRIVED", "arrived"),
            ("STOCKED", "stocked"),
            ("REJECTED", "rejected"),
        ),
    ),
    (
        "reagent_order",
        "order_reason",
        (
            ("RUNNING_OUT", "running_out"),
            ("NOT_STOCKED", "not_stocked"),
            ("COMMON_PUBLIC", "common_public"),
            ("NOT_FOUND", "not_found"),
            ("REORDER", "reorder"),
            ("HIGH_USAGE", "high_usage"),
            ("DEGRADED", "degraded"),
            ("OTHERS", "others"),
        ),
    ),
    (
        "consumable_order",
        "status",
        (
            ("PENDING", "pending"),
            ("APPROVED", "approved"),
            ("REJECTED", "rejected"),
            ("COMPLETED", "completed"),
        ),
    ),
    (
        "users",
        "role",
        (
            ("ADMIN", "admin"),
            ("USER", "user"),
            ("PUBLIC", "public"),
        ),
    ),
)


def normalize_legacy_enum_storage() -> int:
    """Update legacy enum-name values to canonical enum.value and return updated row count."""
    updated_rows = 0
    db_path = ROOT / "lab_inventory.db"

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        for table_name, column_name, value_mappings in LEGACY_ENUM_VALUE_MAP:
            for legacy_value, canonical_value in value_mappings:
                cursor = connection.execute(
                    f"""
                    UPDATE {table_name}
                    SET {column_name} = ?
                    WHERE {column_name} = ?
                    """,
                    (canonical_value, legacy_value),
                )
                updated_rows += cursor.rowcount or 0

        connection.commit()

    return updated_rows


def main() -> int:
    """Run enum normalization and print updated row count."""
    updated_rows = normalize_legacy_enum_storage()
    print(f"Updated rows: {updated_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
