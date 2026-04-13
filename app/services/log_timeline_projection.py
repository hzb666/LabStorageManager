"""Helpers for projecting source logs into the timeline read model."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from app.models.common_shelf_operation_log import (
    CommonShelfOperationAction,
    CommonShelfOperationLog,
)
from app.models.consumable_order_operation_log import ConsumableOrderOperationLog
from app.models.inventory import BorrowLog, Inventory
from app.models.inventory_operation_log import (
    InventoryOperationAction,
    InventoryOperationLog,
)
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.reagent_order_operation_log import ReagentOrderOperationLog
from app.models.user import User
from app.models.user_operation_log import UserOperationLog
from app.services.cas_utils import is_special_cas_value
from app.services.pinyin_utils import to_pinyin


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


def _create_log_timeline(
    db: Session,
    *,
    occurred_at,
    log_type: str,
    is_cli: bool,
    actor_user_id: int | None,
    subject_user_id: int | None,
    source_table: LogTimelineSourceTable,
    source_log_id: int,
    search_text: str,
    search_text_pinyin: str,
) -> LogTimeline:
    timeline = LogTimeline(
        occurred_at=occurred_at,
        log_type=log_type,
        is_cli=is_cli,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        source_table=source_table,
        source_log_id=source_log_id,
        search_text=search_text,
        search_text_pinyin=search_text_pinyin,
    )
    db.add(timeline)
    return timeline


def _inventory_log_type(action: InventoryOperationAction) -> str:
    if action == InventoryOperationAction.INVENTORY_UPDATE:
        return "update"
    if action == InventoryOperationAction.INVENTORY_DELETE:
        return "delete"
    if action == InventoryOperationAction.INVENTORY_EXPORT:
        return "export"
    return "inventory"


def project_inventory_operation_log(
    db: Session,
    *,
    log: InventoryOperationLog,
    is_cli: bool,
) -> LogTimeline:
    return _create_log_timeline(
        db,
        occurred_at=log.created_at,
        log_type=_inventory_log_type(log.action),
        is_cli=is_cli,
        actor_user_id=log.operator_id,
        subject_user_id=log.operator_id,
        source_table=LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
        source_log_id=log.id or 0,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.item_name),
        search_text_pinyin=_build_search_text_pinyin(log.item_name),
    )


def project_reagent_order_operation_log(
    db: Session,
    *,
    log: ReagentOrderOperationLog,
    is_cli: bool,
) -> LogTimeline:
    return _create_log_timeline(
        db,
        occurred_at=log.created_at,
        log_type="reagent_order",
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.applicant_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,
        source_log_id=log.id or 0,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.order_name),
        search_text_pinyin=_build_search_text_pinyin(log.order_name),
    )


def project_consumable_order_operation_log(
    db: Session,
    *,
    log: ConsumableOrderOperationLog,
    is_cli: bool,
) -> LogTimeline:
    return _create_log_timeline(
        db,
        occurred_at=log.created_at,
        log_type="consumable_order",
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.applicant_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,
        source_log_id=log.id or 0,
        search_text=_normalize_text(log.order_name),
        search_text_pinyin=_build_search_text_pinyin(log.order_name),
    )


def _common_shelf_log_type(action: CommonShelfOperationAction) -> str:
    if action == CommonShelfOperationAction.EXPORT:
        return "export"
    return "common_shelf"


def project_common_shelf_operation_log(
    db: Session,
    *,
    log: CommonShelfOperationLog,
    is_cli: bool,
) -> LogTimeline:
    return _create_log_timeline(
        db,
        occurred_at=log.created_at,
        log_type=_common_shelf_log_type(log.action),
        is_cli=is_cli,
        actor_user_id=log.operator_id,
        subject_user_id=log.operator_id,
        source_table=LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG,
        source_log_id=log.id or 0,
        search_text=_build_material_search_text(cas_number=log.cas_number, name=log.item_name),
        search_text_pinyin=_build_search_text_pinyin(log.item_name),
    )


def _extract_snapshot_username(snapshot: dict[str, Any]) -> str:
    direct_username = _normalize_text(snapshot.get("un"))
    if direct_username:
        return direct_username

    for key in ("af", "bf"):
        nested = snapshot.get(key)
        if isinstance(nested, dict):
            username = _normalize_text(nested.get("un"))
            if username:
                return username
    return ""


def _resolve_user_log_username(db: Session, log: UserOperationLog) -> str:
    snapshot_username = _extract_snapshot_username(_load_snapshot(log.snapshot_json))
    if snapshot_username:
        return snapshot_username

    for user_id in (log.target_user_id, log.actor_user_id):
        if user_id is None:
            continue
        user = db.get(User, user_id)
        if user and user.username:
            return user.username.strip()
    return ""


def project_user_operation_log(
    db: Session,
    *,
    log: UserOperationLog,
    is_cli: bool,
) -> LogTimeline:
    username = _resolve_user_log_username(db, log)
    return _create_log_timeline(
        db,
        occurred_at=log.created_at,
        log_type="user",
        is_cli=is_cli,
        actor_user_id=log.actor_user_id,
        subject_user_id=log.target_user_id or log.actor_user_id,
        source_table=LogTimelineSourceTable.USER_OPERATION_LOG,
        source_log_id=log.id or 0,
        search_text=username,
        search_text_pinyin=_build_search_text_pinyin(username),
    )


def project_borrow_log(
    db: Session,
    *,
    log: BorrowLog,
    inventory: Inventory,
    is_cli: bool,
) -> LogTimeline:
    return _create_log_timeline(
        db,
        occurred_at=log.borrow_time,
        log_type="borrow",
        is_cli=is_cli,
        actor_user_id=log.borrower_id,
        subject_user_id=log.borrower_id,
        source_table=LogTimelineSourceTable.BORROWLOG,
        source_log_id=log.id or 0,
        search_text=_build_material_search_text(
            cas_number=inventory.cas_number,
            name=inventory.name,
        ),
        search_text_pinyin=_build_search_text_pinyin(inventory.name),
    )
