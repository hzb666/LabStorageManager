"""Helpers for projecting source logs into the timeline read model."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Session, select

from app.models.common_shelf_operation_log import (
    CommonShelfOperationLog,
)
from app.models.consumable_order_operation_log import ConsumableOrderOperationLog
from app.models.inventory import BorrowLog, Inventory
from app.models.inventory_operation_log import InventoryOperationLog
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.reagent_order_operation_log import ReagentOrderOperationLog
from app.models.user_operation_log import UserOperationLog
from app.services.cas_utils import is_special_cas_value
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
from app.services.pinyin_utils import to_pinyin

LOG_TIMELINE_MUTABLE_COLUMNS = (
    "occurred_at",
    "is_cli",
    "actor_user_id",
    "subject_user_id",
    "search_text",
    "search_text_pinyin",
    "detail_search_text",
)


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def _load_snapshot(snapshot_json: str) -> dict[str, Any]:
    try:
        parsed = json.loads(snapshot_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _build_material_search_text(*, cas_number: str | None, name: str | None) -> str:
    normalized_name = _normalize_text(name)
    normalized_cas = _normalize_text(cas_number)
    if not normalized_name:
        return normalized_cas
    if not normalized_cas or is_special_cas_value(normalized_cas):
        return normalized_name
    return f"{normalized_cas} {normalized_name}".strip()


def _build_search_text_pinyin(name: str | None) -> str:
    normalized_name = _normalize_text(name)
    if not normalized_name:
        return ""
    return to_pinyin(normalized_name)


def _require_source_log_id(source_log_id: int | None) -> int:
    if source_log_id is None or source_log_id <= 0:
        raise ValueError("log timeline projection requires a persisted source log id")
    return source_log_id


def _upsert_log_timeline(
    db: Session,
    *,
    occurred_at,
    is_cli: bool,
    actor_user_id: int | None,
    subject_user_id: int | None,
    source_table: LogTimelineSourceTable,
    source_log_id: int,
    search_text: str,
    search_text_pinyin: str,
    detail_search_text: str,
) -> LogTimeline:
    persisted_source_log_id = _require_source_log_id(source_log_id)
    values = {
        "occurred_at": occurred_at,
        "is_cli": is_cli,
        "actor_user_id": actor_user_id,
        "subject_user_id": subject_user_id,
        "source_table": source_table.value,
        "source_log_id": persisted_source_log_id,
        "search_text": search_text,
        "search_text_pinyin": search_text_pinyin,
        "detail_search_text": with_cli_prefix(detail_search_text, is_cli),
    }
    insert_statement = sqlite_insert(LogTimeline).values(**values)
    update_values = {
        column_name: getattr(insert_statement.excluded, column_name)
        for column_name in LOG_TIMELINE_MUTABLE_COLUMNS
    }
    db.exec(
        insert_statement.on_conflict_do_update(
            index_elements=["source_table", "source_log_id"],
            set_=update_values,
        )
    )
    return db.exec(
        select(LogTimeline).where(
            LogTimeline.source_table == source_table,
            LogTimeline.source_log_id == persisted_source_log_id,
        )
    ).one()


def project_inventory_operation_log(
    db: Session,
    *,
    log: InventoryOperationLog,
    is_cli: bool,
) -> LogTimeline:
    snapshot = _load_snapshot(log.snapshot_json)
    action_value = normalize_action_value(log.action)
    return _upsert_log_timeline(
        db,
        occurred_at=log.created_at,
        is_cli=is_cli,
        actor_user_id=log.operator_id,
        subject_user_id=log.operator_id,
        source_table=LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
        source_log_id=log.id,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.item_name),
        search_text_pinyin=_build_search_text_pinyin(log.item_name),
        detail_search_text=build_inventory_detail_text(
            action_value,
            log.item_name,
            snapshot,
        ),
    )


def project_reagent_order_operation_log(
    db: Session,
    *,
    log: ReagentOrderOperationLog,
    is_cli: bool,
) -> LogTimeline:
    action_value = normalize_action_value(log.action)
    action_label = REAGENT_ORDER_ACTION_LABELS.get(action_value, action_value)
    snapshot = _load_snapshot(log.snapshot_json)
    return _upsert_log_timeline(
        db,
        occurred_at=log.created_at,
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.applicant_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,
        source_log_id=log.id,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.order_name),
        search_text_pinyin=_build_search_text_pinyin(log.order_name),
        detail_search_text=build_reagent_order_detail_text(
            action_label,
            log.order_name,
            snapshot,
        ),
    )


def project_consumable_order_operation_log(
    db: Session,
    *,
    log: ConsumableOrderOperationLog,
    is_cli: bool,
) -> LogTimeline:
    action_value = normalize_action_value(log.action)
    action_label = CONSUMABLE_ORDER_ACTION_LABELS.get(action_value, action_value)
    snapshot = _load_snapshot(log.snapshot_json)
    return _upsert_log_timeline(
        db,
        occurred_at=log.created_at,
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.applicant_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,
        source_log_id=log.id,
        search_text=_normalize_text(log.order_name),
        search_text_pinyin=_build_search_text_pinyin(log.order_name),
        detail_search_text=build_consumable_order_detail_text(
            action_label,
            log.order_name,
            log.specification,
            snapshot,
        ),
    )


def project_common_shelf_operation_log(
    db: Session,
    *,
    log: CommonShelfOperationLog,
    is_cli: bool,
) -> LogTimeline:
    action_value = normalize_action_value(log.action)
    snapshot = _load_snapshot(log.snapshot_json)
    return _upsert_log_timeline(
        db,
        occurred_at=log.created_at,
        is_cli=is_cli,
        actor_user_id=log.operator_id,
        subject_user_id=log.operator_id,
        source_table=LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG,
        source_log_id=log.id,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.item_name),
        search_text_pinyin=_build_search_text_pinyin(log.item_name),
        detail_search_text=build_common_shelf_detail_text(
            action_value,
            log.item_name,
            snapshot,
        ),
    )


def project_user_operation_log(
    db: Session,
    *,
    log: UserOperationLog,
    is_cli: bool,
) -> LogTimeline:
    action_value = normalize_action_value(log.action)
    action_label = USER_OPERATION_ACTION_LABELS.get(action_value, action_value)
    return _upsert_log_timeline(
        db,
        occurred_at=log.created_at,
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.target_user_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.USER_OPERATION_LOG,
        source_log_id=log.id,
        search_text="",
        search_text_pinyin="",
        detail_search_text=build_user_operation_search_detail_text(action_label),
    )


def project_borrow_log(
    db: Session,
    *,
    log: BorrowLog,
    inventory: Inventory,
    is_cli: bool,
) -> LogTimeline:
    is_returned = log.return_time is not None
    return _upsert_log_timeline(
        db,
        occurred_at=log.borrow_time,
        is_cli=is_cli,
        actor_user_id=log.borrower_id,
        subject_user_id=log.borrower_id,
        source_table=LogTimelineSourceTable.BORROWLOG,
        source_log_id=log.id,
        search_text=_build_material_search_text(
            cas_number=inventory.cas_number,
            name=inventory.name,
        ),
        search_text_pinyin=_build_search_text_pinyin(inventory.name),
        detail_search_text=build_borrow_detail_text(
            inventory.name,
            log.quantity_borrowed,
            inventory.unit,
            is_returned,
            log.quantity_returned,
        ),
    )
