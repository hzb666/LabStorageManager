"""SQLite consistency checks and runtime constraint setup."""
from __future__ import annotations

import logging

from sqlalchemy import Connection, text

from app.models.reagent_order import ReagentOrderStatus

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
    logger.error("%s", message)
    raise RuntimeError(message)


def ensure_sqlite_reagent_order_constraints(connection: Connection) -> None:
    """Ensure CAS master data and reagent order invariants are database-enforced."""
    connection.execute(text("DROP TRIGGER IF EXISTS trg_chemical_name_map_bd_reagent_order"))
    for statement in SQLITE_REAGENT_ORDER_CONSTRAINT_TRIGGERS:
        connection.execute(text(statement))
