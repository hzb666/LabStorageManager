"""Backfill log timeline detail search text from source log tables."""
from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, text

from app.services.log_timeline_detail_text import (
    CONSUMABLE_ORDER_ACTION_LABELS,
    REAGENT_ORDER_ACTION_LABELS,
    USER_OPERATION_ACTION_LABELS,
    build_borrow_detail_text,
    build_common_shelf_detail_text,
    build_consumable_order_detail_text,
    build_inventory_detail_text,
    build_reagent_order_detail_text,
    build_user_operation_search_detail_text,
    normalize_action_value,
    with_cli_prefix,
)

PENDING_DETAIL_CONDITION = """
timeline.detail_search_text IS NULL OR TRIM(timeline.detail_search_text) = ''
"""


@dataclass(frozen=True)
class BackfillSourceConfig:
    query: str
    build_detail: Callable[[Mapping[str, Any]], str]


def _load_snapshot(snapshot_json: object) -> dict[str, Any]:
    if not isinstance(snapshot_json, str) or not snapshot_json:
        return {}
    try:
        parsed = json.loads(snapshot_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _as_text(value: object) -> str:
    if value is None:
        return ""
    return str(value)


def _lookup_action_label(
    labels: dict[str, str],
    action: object,
) -> str:
    action_value = normalize_action_value(action)
    return labels.get(action_value, action_value)


def _build_inventory_detail(row: Mapping[str, Any]) -> str:
    return build_inventory_detail_text(
        normalize_action_value(row.get("action")),
        _as_text(row.get("item_name")),
        _load_snapshot(row.get("snapshot_json")),
    )


def _build_reagent_detail(row: Mapping[str, Any]) -> str:
    return build_reagent_order_detail_text(
        _lookup_action_label(REAGENT_ORDER_ACTION_LABELS, row.get("action")),
        _as_text(row.get("order_name")),
        _load_snapshot(row.get("snapshot_json")),
    )


def _build_consumable_detail(row: Mapping[str, Any]) -> str:
    return build_consumable_order_detail_text(
        _lookup_action_label(CONSUMABLE_ORDER_ACTION_LABELS, row.get("action")),
        _as_text(row.get("order_name")),
        _as_text(row.get("specification")),
        _load_snapshot(row.get("snapshot_json")),
    )


def _build_common_shelf_detail(row: Mapping[str, Any]) -> str:
    return build_common_shelf_detail_text(
        normalize_action_value(row.get("action")),
        _as_text(row.get("item_name")),
        _load_snapshot(row.get("snapshot_json")),
    )


def _build_user_detail(row: Mapping[str, Any]) -> str:
    action_label = _lookup_action_label(USER_OPERATION_ACTION_LABELS, row.get("action"))
    return build_user_operation_search_detail_text(action_label)


def _build_borrow_detail(row: Mapping[str, Any]) -> str:
    return build_borrow_detail_text(
        _as_text(row.get("inventory_name")),
        row.get("quantity_borrowed"),
        _as_text(row.get("unit")),
        row.get("return_time") is not None,
        row.get("quantity_returned"),
    )


BACKFILL_SOURCE_CONFIGS: tuple[BackfillSourceConfig, ...] = (
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            source.action AS action,
            source.item_name AS item_name,
            source.snapshot_json AS snapshot_json
        FROM log_timeline AS timeline
        JOIN inventory_operation_log AS source ON source.id = timeline.source_log_id
        WHERE timeline.source_table = 'inventory_operation_log'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_inventory_detail,
    ),
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            source.action AS action,
            source.order_name AS order_name,
            source.snapshot_json AS snapshot_json
        FROM log_timeline AS timeline
        JOIN reagent_order_operation_log AS source ON source.id = timeline.source_log_id
        WHERE timeline.source_table = 'reagent_order_operation_log'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_reagent_detail,
    ),
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            source.action AS action,
            source.order_name AS order_name,
            source.specification AS specification,
            source.snapshot_json AS snapshot_json
        FROM log_timeline AS timeline
        JOIN consumable_order_operation_log AS source ON source.id = timeline.source_log_id
        WHERE timeline.source_table = 'consumable_order_operation_log'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_consumable_detail,
    ),
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            source.action AS action,
            source.item_name AS item_name,
            source.snapshot_json AS snapshot_json
        FROM log_timeline AS timeline
        JOIN common_shelf_operation_log AS source ON source.id = timeline.source_log_id
        WHERE timeline.source_table = 'common_shelf_operation_log'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_common_shelf_detail,
    ),
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            source.action AS action
        FROM log_timeline AS timeline
        JOIN user_operation_log AS source ON source.id = timeline.source_log_id
        WHERE timeline.source_table = 'user_operation_log'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_user_detail,
    ),
    BackfillSourceConfig(
        query=f"""
        SELECT
            timeline.id AS timeline_id,
            timeline.is_cli AS is_cli,
            inventory.name AS inventory_name,
            inventory.unit AS unit,
            source.quantity_borrowed AS quantity_borrowed,
            source.quantity_returned AS quantity_returned,
            source.return_time AS return_time
        FROM log_timeline AS timeline
        JOIN borrowlog AS source ON source.id = timeline.source_log_id
        JOIN inventory ON source.inventory_id = inventory.id
        WHERE timeline.source_table = 'borrowlog'
          AND ({PENDING_DETAIL_CONDITION})
        """,
        build_detail=_build_borrow_detail,
    ),
)


def _build_updates_for_source(
    connection: Connection,
    config: BackfillSourceConfig,
) -> list[dict[str, object]]:
    rows = connection.execute(text(config.query)).mappings().all()
    updates: list[dict[str, object]] = []
    for row in rows:
        detail_search_text = with_cli_prefix(
            config.build_detail(row),
            bool(row.get("is_cli")),
        )
        if not detail_search_text:
            continue
        updates.append(
            {
                "id": row["timeline_id"],
                "detail_search_text": detail_search_text,
            }
        )
    return updates


def _update_detail_search_rows(
    connection: Connection,
    updates: list[dict[str, object]],
) -> int:
    if not updates:
        return 0
    connection.execute(
        text(
            """
            UPDATE log_timeline
            SET detail_search_text = :detail_search_text
            WHERE id = :id
            """
        ),
        updates,
    )
    return len(updates)


def _build_user_operation_search_cleanup_updates(connection: Connection) -> list[dict[str, object]]:
    rows = connection.execute(
        text(
            """
            SELECT
                timeline.id AS timeline_id,
                timeline.is_cli AS is_cli,
                source.action AS action
            FROM log_timeline AS timeline
            JOIN user_operation_log AS source ON source.id = timeline.source_log_id
            WHERE timeline.source_table = 'user_operation_log'
              AND (
                TRIM(COALESCE(timeline.search_text, '')) != ''
                OR TRIM(COALESCE(timeline.search_text_pinyin, '')) != ''
                OR TRIM(COALESCE(timeline.detail_search_text, '')) = ''
                OR timeline.detail_search_text LIKE '%(%'
                OR timeline.detail_search_text LIKE '%username=%'
                OR timeline.detail_search_text LIKE '%full_name=%'
              )
            """
        )
    ).mappings().all()

    updates: list[dict[str, object]] = []
    for row in rows:
        updates.append(
            {
                "id": row["timeline_id"],
                "detail_search_text": with_cli_prefix(
                    _build_user_detail(row),
                    bool(row.get("is_cli")),
                ),
            }
        )
    return updates


def clear_log_timeline_user_operation_search_text(connection: Connection) -> int:
    """Remove dynamic user identifiers from timeline search columns."""

    updates = _build_user_operation_search_cleanup_updates(connection)
    if not updates:
        return 0
    connection.execute(
        text(
            """
            UPDATE log_timeline
            SET search_text = '',
                search_text_pinyin = '',
                detail_search_text = :detail_search_text
            WHERE id = :id
            """
        ),
        updates,
    )
    return len(updates)


def backfill_log_timeline_detail_search_text(connection: Connection) -> int:
    updated_rows = 0
    for config in BACKFILL_SOURCE_CONFIGS:
        updated_rows += _update_detail_search_rows(
            connection,
            _build_updates_for_source(connection, config),
        )
    return updated_rows
