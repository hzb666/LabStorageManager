"""Backfill common_shelf_group records from existing common_shelf rows.

Usage:
    python scripts/backfill_common_shelf_groups.py
    python scripts/backfill_common_shelf_groups.py --apply

The script uses the application's configured DATABASE_URL. By default it only
reports how many group records are missing; pass --apply to write changes.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import Connection, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.database import db_path, engine

COMMON_SHELF_GROUP_MISSING_COUNT_SQL = """
SELECT COUNT(*) AS missing_count
FROM (
    SELECT DISTINCT
        common_shelf.cas_number,
        common_shelf.brand_normalized,
        common_shelf.specification_normalized
    FROM common_shelf
) AS shelf_groups
WHERE NOT EXISTS (
    SELECT 1
    FROM common_shelf_group AS existing
    WHERE existing.is_deleted = 0
      AND existing.cas_number = shelf_groups.cas_number
      AND existing.brand_normalized = shelf_groups.brand_normalized
      AND existing.specification_normalized = shelf_groups.specification_normalized
)
"""

COMMON_SHELF_GROUP_BACKFILL_SQL = """
INSERT INTO common_shelf_group (
    cas_number,
    name_snapshot,
    brand,
    brand_normalized,
    purity,
    specification_text,
    spec_quantity,
    spec_unit,
    specification_normalized,
    notes,
    created_by_id,
    is_deleted,
    created_at,
    updated_at,
    deleted_at
)
SELECT
    ranked.cas_number,
    ranked.name_snapshot,
    ranked.brand,
    ranked.brand_normalized,
    NULL,
    ranked.specification_text,
    ranked.spec_quantity,
    ranked.spec_unit,
    ranked.specification_normalized,
    NULL,
    ranked.created_by_id,
    0,
    COALESCE(ranked.group_created_at, CURRENT_TIMESTAMP),
    COALESCE(ranked.group_updated_at, ranked.group_created_at, CURRENT_TIMESTAMP),
    NULL
FROM (
    SELECT
        common_shelf.*,
        MIN(common_shelf.created_at) OVER group_window AS group_created_at,
        MAX(common_shelf.updated_at) OVER group_window AS group_updated_at,
        ROW_NUMBER() OVER (
            PARTITION BY
                common_shelf.cas_number,
                common_shelf.brand_normalized,
                common_shelf.specification_normalized
            ORDER BY
                common_shelf.updated_at DESC,
                common_shelf.created_at DESC,
                common_shelf.id DESC
        ) AS row_number
    FROM common_shelf
    WINDOW group_window AS (
        PARTITION BY
            common_shelf.cas_number,
            common_shelf.brand_normalized,
            common_shelf.specification_normalized
    )
) AS ranked
WHERE ranked.row_number = 1
  AND NOT EXISTS (
      SELECT 1
      FROM common_shelf_group AS existing
      WHERE existing.is_deleted = 0
        AND existing.cas_number = ranked.cas_number
        AND existing.brand_normalized = ranked.brand_normalized
        AND existing.specification_normalized = ranked.specification_normalized
  )
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write missing common_shelf_group rows. Without this flag, only report counts.",
    )
    return parser


def count_missing_groups(connection: Connection) -> int:
    missing_count = connection.execute(
        text(COMMON_SHELF_GROUP_MISSING_COUNT_SQL)
    ).scalar_one()
    return int(missing_count)


def backfill_missing_groups(connection: Connection, missing_before: int) -> int:
    result = connection.execute(text(COMMON_SHELF_GROUP_BACKFILL_SQL))
    if result.rowcount is not None and result.rowcount >= 0:
        return int(result.rowcount)
    return missing_before


def run_backfill(*, apply: bool) -> None:
    with engine.begin() as connection:
        missing_before = count_missing_groups(connection)
        if missing_before <= 0:
            print(f"No missing common shelf group records. database={db_path}")
            return

        if not apply:
            print(
                "Dry run: "
                f"{missing_before} common shelf group records are missing. "
                "Run with --apply to backfill them."
            )
            return

        inserted_count = backfill_missing_groups(connection, missing_before)
        missing_after = count_missing_groups(connection)

    print(
        "Backfilled common shelf group records: "
        f"inserted={inserted_count} missing_before={missing_before} "
        f"missing_after={missing_after} database={db_path}"
    )


def main() -> int:
    args = build_parser().parse_args()
    run_backfill(apply=args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
