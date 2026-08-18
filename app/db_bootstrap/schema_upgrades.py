"""SQLite schema upgrades and schema-bound backfills."""
from __future__ import annotations

import logging
import re

from sqlalchemy import Connection, text

from app.core.constants import LOW_STOCK_PERCENT
from app.models.inventory import InventoryStatus
from app.models.reagent_order import ReagentOrderStatus
from app.services import pinyin_utils

logger = logging.getLogger(__name__)

SQLITE_COMMON_SHELF_GROUP_MISSING_COUNT_SQL = """
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

SQLITE_COMMON_SHELF_LOCATION_PINYIN_COLUMN_UPGRADES: tuple[tuple[str, str], ...] = (
    ("storage_location_pinyin", "ALTER TABLE common_shelf ADD COLUMN storage_location_pinyin VARCHAR(200)"),
    (
        "storage_location_pinyin_initials",
        "ALTER TABLE common_shelf ADD COLUMN storage_location_pinyin_initials VARCHAR(200)",
    ),
)

SQLITE_LOG_TIMELINE_DETAIL_SEARCH_COLUMN_UPGRADES: tuple[tuple[str, str], ...] = (
    (
        "detail_search_text",
        "ALTER TABLE log_timeline ADD COLUMN detail_search_text TEXT NOT NULL DEFAULT ''",
    ),
)

SQLITE_COMPOUND_STRUCTURE_CACHE_NAME_COLUMN_UPGRADES: tuple[tuple[str, str], ...] = (
    ("english_name", "ALTER TABLE compound_structure_cache ADD COLUMN english_name VARCHAR(500)"),
    ("chinese_name", "ALTER TABLE compound_structure_cache ADD COLUMN chinese_name VARCHAR(500)"),
    (
        "chinese_name_is_translated",
        "ALTER TABLE compound_structure_cache "
        "ADD COLUMN chinese_name_is_translated BOOLEAN NOT NULL DEFAULT 0",
    ),
    (
        "name_error_message",
        "ALTER TABLE compound_structure_cache ADD COLUMN name_error_message VARCHAR(1000)",
    ),
    (
        "name_last_resolved_at",
        "ALTER TABLE compound_structure_cache ADD COLUMN name_last_resolved_at DATETIME",
    ),
)

SQLITE_INVENTORY_QUANTITY_STATUS_SQL = """
UPDATE inventory
SET status = CASE
    WHEN remaining_quantity IS NOT NULL
         AND remaining_quantity <= 0
        THEN :consumed_status
    WHEN remaining_quantity IS NOT NULL
         AND initial_quantity IS NOT NULL
         AND initial_quantity > 0
         AND remaining_quantity / initial_quantity <= :low_stock_percent
        THEN :run_short_status
    ELSE :in_stock_status
END
WHERE status IN (:in_stock_status, :run_short_status)
  AND status != CASE
      WHEN remaining_quantity IS NOT NULL
           AND remaining_quantity <= 0
          THEN :consumed_status
      WHEN remaining_quantity IS NOT NULL
           AND initial_quantity IS NOT NULL
           AND initial_quantity > 0
           AND remaining_quantity / initial_quantity <= :low_stock_percent
          THEN :run_short_status
      ELSE :in_stock_status
  END
"""

SQLITE_REAGENT_ORDER_CONSTRAINT_TRIGGERS: tuple[str, ...] = (
    f"""
    CREATE TRIGGER IF NOT EXISTS trg_chemical_name_map_bd_reagent_order
    BEFORE DELETE ON chemical_name_map
    FOR EACH ROW
    WHEN EXISTS (
        SELECT 1
        FROM reagent_order
        WHERE cas_number = OLD.cas_number
          AND status != '{ReagentOrderStatus.STOCKED.value}'
    )
    BEGIN
        SELECT RAISE(
            ABORT,
            'CAS master data is referenced by an unfinished reagent order and cannot be deleted'
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_reagent_order_bi_common_public_master_data
    BEFORE INSERT ON reagent_order
    FOR EACH ROW
    WHEN NEW.order_reason = 'common_public'
         AND NOT EXISTS (
             SELECT 1 FROM chemical_name_map WHERE cas_number = NEW.cas_number
         )
    BEGIN
        SELECT RAISE(ABORT, 'Common-public orders require CAS master data');
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_reagent_order_bu_common_public_master_data
    BEFORE UPDATE OF cas_number, order_reason ON reagent_order
    FOR EACH ROW
    WHEN NEW.order_reason = 'common_public'
         AND NOT EXISTS (
             SELECT 1 FROM chemical_name_map WHERE cas_number = NEW.cas_number
         )
    BEGIN
        SELECT RAISE(ABORT, 'Common-public orders require CAS master data');
    END
    """,
)

SQLITE_REAGENT_ORDER_CATEGORY_PINYIN_COLUMNS = (
    "category_pinyin",
    "category_pinyin_initials",
)


def _quote_sqlite_identifier(identifier: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier) is None:
        raise ValueError(f"Unsupported SQLite identifier: {identifier}")
    return f'"{identifier}"'


def _get_sqlite_table_columns(connection: Connection, table_name: str) -> set[str]:
    table_identifier = _quote_sqlite_identifier(table_name)
    rows = connection.execute(text(f"PRAGMA table_info({table_identifier})")).all()
    return {str(row[1]) for row in rows}


def check_sqlite_common_shelf_groups_consistency(connection: Connection) -> int:
    """Block startup when bottle rows lack active persistent group records."""
    missing_count = int(
        connection.execute(text(SQLITE_COMMON_SHELF_GROUP_MISSING_COUNT_SQL)).scalar_one() or 0
    )
    if missing_count <= 0:
        logger.debug("Common shelf group consistency check passed.")
        return 0

    message = (
        f"Detected {missing_count} common shelf group identities with bottle rows but no active "
        "group record. Run `python scripts/backfill_common_shelf_groups.py --apply` before "
        "starting the backend."
    )
    logger.error(
        "%s",
        message,
    )
    raise RuntimeError(message)


def ensure_sqlite_common_shelf_location_pinyin_columns(connection: Connection) -> None:
    """Ensure common shelf location pinyin fields exist and old rows are backfilled."""
    existing_columns = _get_sqlite_table_columns(connection, "common_shelf")
    for column_name, alter_statement in SQLITE_COMMON_SHELF_LOCATION_PINYIN_COLUMN_UPGRADES:
        if column_name not in existing_columns:
            connection.execute(text(alter_statement))
            logger.info("Added common_shelf.%s column.", column_name)

    rows = connection.execute(
        text(
            """
            SELECT id, storage_location
            FROM common_shelf
            WHERE storage_location IS NOT NULL
              AND TRIM(storage_location) != ''
              AND (
                storage_location_pinyin IS NULL
                OR storage_location_pinyin_initials IS NULL
              )
            """
        )
    ).all()
    updated_rows = 0
    for row in rows:
        row_data = row._mapping
        pinyin_fields = pinyin_utils.compute_pinyin_fields(
            storage_location=str(row_data["storage_location"])
        )
        connection.execute(
            text(
                """
                UPDATE common_shelf
                SET
                  storage_location_pinyin = :storage_location_pinyin,
                  storage_location_pinyin_initials = :storage_location_pinyin_initials
                WHERE id = :id
                """
            ),
            {
                "id": row_data["id"],
                "storage_location_pinyin": pinyin_fields.get("storage_location_pinyin"),
                "storage_location_pinyin_initials": pinyin_fields.get(
                    "storage_location_pinyin_initials"
                ),
            },
        )
        updated_rows += 1

    if updated_rows > 0:
        logger.info("Backfilled %d common shelf location pinyin rows.", updated_rows)


def ensure_sqlite_reagent_order_category_pinyin_columns_removed(connection: Connection) -> None:
    """Remove obsolete reagent-order category pinyin columns and FTS objects."""
    existing_columns = _get_sqlite_table_columns(connection, "reagent_order")
    obsolete_columns = [
        column_name
        for column_name in SQLITE_REAGENT_ORDER_CATEGORY_PINYIN_COLUMNS
        if column_name in existing_columns
    ]
    if not obsolete_columns:
        return

    connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_ai"))
    connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_ad"))
    connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_au"))
    connection.execute(text("DROP TABLE IF EXISTS reagent_order_fts"))
    for index_name in (
        "ix_reagent_order_category_created_at_id",
        "ix_reagent_order_category_pinyin_created_at_id",
        "ix_reagent_order_category_pinyin_initials_created_at_id",
    ):
        connection.execute(text(f"DROP INDEX IF EXISTS {_quote_sqlite_identifier(index_name)}"))

    for column_name in obsolete_columns:
        quoted_column = _quote_sqlite_identifier(column_name)
        connection.execute(text(f"ALTER TABLE reagent_order DROP COLUMN {quoted_column}"))
        logger.info("Removed obsolete reagent_order.%s column.", column_name)


def ensure_sqlite_log_timeline_detail_search_text(connection: Connection) -> None:
    """Ensure timeline detail search text exists and is populated for existing rows."""
    existing_columns = _get_sqlite_table_columns(connection, "log_timeline")
    for column_name, alter_statement in SQLITE_LOG_TIMELINE_DETAIL_SEARCH_COLUMN_UPGRADES:
        if column_name not in existing_columns:
            connection.execute(text(alter_statement))
            logger.info("Added log_timeline.%s column.", column_name)

    from app.services.log_timeline_detail_backfill import (
        backfill_log_timeline_detail_search_text,
    )

    updated_rows = backfill_log_timeline_detail_search_text(connection)
    if updated_rows > 0:
        logger.info("Backfilled %d log timeline detail search rows.", updated_rows)


def ensure_sqlite_compound_structure_cache_name_columns(connection: Connection) -> None:
    """Ensure external name cache fields exist on compound_structure_cache."""
    existing_columns = _get_sqlite_table_columns(connection, "compound_structure_cache")
    for column_name, alter_statement in SQLITE_COMPOUND_STRUCTURE_CACHE_NAME_COLUMN_UPGRADES:
        if column_name not in existing_columns:
            connection.execute(text(alter_statement))
            logger.info("Added compound_structure_cache.%s column.", column_name)


def ensure_sqlite_inventory_quantity_statuses(connection: Connection) -> None:
    """Align legacy automatic statuses with the current quantity thresholds."""

    result = connection.execute(
        text(SQLITE_INVENTORY_QUANTITY_STATUS_SQL),
        {
            "consumed_status": InventoryStatus.CONSUMED.value,
            "in_stock_status": InventoryStatus.IN_STOCK.value,
            "low_stock_percent": LOW_STOCK_PERCENT,
            "run_short_status": InventoryStatus.RUN_SHORT.value,
        },
    )
    if result.rowcount > 0:
        logger.info("Aligned %d inventory quantity status rows.", result.rowcount)


def ensure_sqlite_reagent_order_constraints(connection: Connection) -> None:
    """Ensure CAS master data and reagent order invariants are database-enforced."""
    # Rebuild this trigger so existing SQLite databases receive updated delete semantics.
    connection.execute(text("DROP TRIGGER IF EXISTS trg_chemical_name_map_bd_reagent_order"))
    for statement in SQLITE_REAGENT_ORDER_CONSTRAINT_TRIGGERS:
        connection.execute(text(statement))
