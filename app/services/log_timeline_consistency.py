"""Consistency repair helpers for the log timeline read model."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import Connection, text

from app.models.log_timeline import LogTimelineSourceTable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LogTimelineSourceConfig:
    source_table: LogTimelineSourceTable
    table_name: str
    delete_trigger_name: str


LOG_TIMELINE_SOURCE_CONFIGS: tuple[LogTimelineSourceConfig, ...] = (
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
        table_name="inventory_operation_log",
        delete_trigger_name="trg_log_timeline_inventory_operation_log_ad",
    ),
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,
        table_name="reagent_order_operation_log",
        delete_trigger_name="trg_log_timeline_reagent_order_operation_log_ad",
    ),
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,
        table_name="consumable_order_operation_log",
        delete_trigger_name="trg_log_timeline_consumable_order_operation_log_ad",
    ),
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG,
        table_name="common_shelf_operation_log",
        delete_trigger_name="trg_log_timeline_common_shelf_operation_log_ad",
    ),
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.USER_OPERATION_LOG,
        table_name="user_operation_log",
        delete_trigger_name="trg_log_timeline_user_operation_log_ad",
    ),
    LogTimelineSourceConfig(
        source_table=LogTimelineSourceTable.BORROWLOG,
        table_name="borrowlog",
        delete_trigger_name="trg_log_timeline_borrowlog_ad",
    ),
)

SUPPORTED_SOURCE_TABLES_SQL = ", ".join(
    f"'{config.source_table.value}'" for config in LOG_TIMELINE_SOURCE_CONFIGS
)


def _deleted_row_count(rowcount: int | None) -> int:
    if rowcount is None or rowcount < 0:
        return 0
    return rowcount


def ensure_log_timeline_source_delete_triggers(connection: Connection) -> None:
    """Cascade source-log deletes into the polymorphic timeline read model."""

    for config in LOG_TIMELINE_SOURCE_CONFIGS:
        connection.execute(
            text(
                f"""
                CREATE TRIGGER IF NOT EXISTS {config.delete_trigger_name}
                AFTER DELETE ON {config.table_name}
                BEGIN
                    DELETE FROM log_timeline
                    WHERE source_table = '{config.source_table.value}'
                      AND source_log_id = OLD.id;
                END
                """
            )
        )


def cleanup_orphan_log_timeline_rows(connection: Connection) -> int:
    """Remove timeline rows that no longer have an existing source log row."""

    deleted_total = _deleted_row_count(
        connection.execute(
            text(
                f"""
                DELETE FROM log_timeline
                WHERE source_log_id <= 0
                   OR source_table NOT IN ({SUPPORTED_SOURCE_TABLES_SQL})
                """
            )
        ).rowcount
    )

    for config in LOG_TIMELINE_SOURCE_CONFIGS:
        result = connection.execute(
            text(
                f"""
                DELETE FROM log_timeline
                WHERE source_table = :source_table
                  AND NOT EXISTS (
                      SELECT 1
                      FROM {config.table_name}
                      WHERE {config.table_name}.id = log_timeline.source_log_id
                  )
                """
            ),
            {"source_table": config.source_table.value},
        )
        deleted_total += _deleted_row_count(result.rowcount)

    if deleted_total:
        logger.warning("Removed %d orphan log_timeline rows.", deleted_total)
    return deleted_total
