"""Order operation logging helpers."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from app.core.time_utils import utc_iso_str
from app.models.consumable_order import ConsumableOrder
from app.models.consumable_order_operation_log import (
    ConsumableOrderOperationAction,
    ConsumableOrderOperationLog,
)
from app.models.reagent_order import ReagentOrder
from app.models.reagent_order_operation_log import (
    ReagentOrderOperationAction,
    ReagentOrderOperationLog,
)
from app.services.log_timeline_projection import (
    project_consumable_order_operation_log,
    project_reagent_order_operation_log,
)

REAGENT_SNAPSHOT_KEY_MAP = {
    "id": "id",
    "ca": "cas_number",
    "na": "name",
    "en": "english_name",
    "al": "alias",
    "cg": "category",
    "br": "brand",
    "pu": "purity",
    "iq": "initial_quantity",
    "un": "unit",
    "qt": "quantity",
    "pr": "price",
    "or": "order_reason",
    "hz": "is_hazardous",
    "nt": "notes",
    "ap": "applicant_id",
    "st": "status",
    "cr": "created_at",
    "up": "updated_at",
    "bf": "before",
    "af": "after",
    "ct": "count",
}

CONSUMABLE_SNAPSHOT_KEY_MAP = {
    "id": "id",
    "na": "name",
    "en": "english_name",
    "pn": "product_number",
    "sp": "specification",
    "un": "unit",
    "qt": "quantity",
    "pr": "price",
    "cm": "communication",
    "nt": "notes",
    "ap": "applicant_id",
    "st": "status",
    "cr": "created_at",
    "up": "updated_at",
    "bf": "before",
    "af": "after",
    "ct": "count",
}


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def build_reagent_order_snapshot(order: ReagentOrder) -> dict[str, Any]:
    """Build a compact reagent order snapshot payload."""

    return {
        "id": order.id,
        "ca": order.cas_number,
        "na": order.name,
        "en": order.english_name,
        "al": order.alias,
        "cg": order.category,
        "br": order.brand,
        "pu": order.purity,
        "iq": order.initial_quantity,
        "un": order.unit,
        "qt": order.quantity,
        "pr": order.price,
        "or": _enum_value(order.order_reason),
        "hz": order.is_hazardous,
        "nt": order.notes,
        "ap": order.applicant_id,
        "st": _enum_value(order.status),
        "cr": utc_iso_str(order.created_at),
        "up": utc_iso_str(order.updated_at),
    }


def build_consumable_order_snapshot(order: ConsumableOrder) -> dict[str, Any]:
    """Build a compact consumable order snapshot payload."""

    return {
        "id": order.id,
        "na": order.name,
        "en": order.english_name,
        "pn": order.product_number,
        "sp": order.specification,
        "un": order.unit,
        "qt": order.quantity,
        "pr": order.price,
        "cm": order.communication,
        "nt": order.notes,
        "ap": order.applicant_id,
        "st": _enum_value(order.status),
        "cr": utc_iso_str(order.created_at),
        "up": utc_iso_str(order.updated_at),
    }


def _parse_snapshot(snapshot_json: str, key_map: dict[str, str]) -> dict[str, Any]:
    try:
        parsed = json.loads(snapshot_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    normalized: dict[str, Any] = {}
    for key, value in parsed.items():
        if key in {"bf", "af"} and isinstance(value, dict):
            nested: dict[str, Any] = {}
            for nested_key, nested_value in value.items():
                nested[key_map.get(nested_key, nested_key)] = nested_value
            normalized[key_map.get(key, key)] = nested
            continue
        normalized[key_map.get(key, key)] = value
    return normalized


def parse_reagent_order_snapshot(snapshot_json: str) -> dict[str, Any]:
    """Parse persisted reagent order snapshot JSON safely."""

    return _parse_snapshot(snapshot_json, REAGENT_SNAPSHOT_KEY_MAP)


def parse_consumable_order_snapshot(snapshot_json: str) -> dict[str, Any]:
    """Parse persisted consumable order snapshot JSON safely."""

    return _parse_snapshot(snapshot_json, CONSUMABLE_SNAPSHOT_KEY_MAP)


def _create_reagent_order_operation_log(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    applicant_id: int | None,
    action: ReagentOrderOperationAction,
    order_name: str,
    cas_number: str,
    snapshot: dict[str, Any],
    notes: str | None = None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    log = ReagentOrderOperationLog(
        order_id=order_id,
        actor_user_id=actor_user_id,
        applicant_id=applicant_id,
        action=action,
        order_name=order_name,
        cas_number=cas_number,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
        notes=notes,
    )
    db.add(log)
    db.flush([log])
    project_reagent_order_operation_log(db, log=log, is_cli=is_cli)
    return log


def _create_consumable_order_operation_log(
    db: Session,
    *,
    order_id: int,
    actor_user_id: int | None,
    applicant_id: int | None,
    action: ConsumableOrderOperationAction,
    order_name: str,
    specification: str,
    snapshot: dict[str, Any],
    notes: str | None = None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    log = ConsumableOrderOperationLog(
        order_id=order_id,
        actor_user_id=actor_user_id,
        applicant_id=applicant_id,
        action=action,
        order_name=order_name,
        specification=specification,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
        notes=notes,
    )
    db.add(log)
    db.flush([log])
    project_consumable_order_operation_log(db, log=log, is_cli=is_cli)
    return log


def log_reagent_order_create(
    db: Session,
    *,
    order: ReagentOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    snapshot = build_reagent_order_snapshot(order)
    return _create_reagent_order_operation_log(
        db,
        order_id=order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=order.applicant_id,
        action=ReagentOrderOperationAction.CREATE,
        order_name=order.name,
        cas_number=order.cas_number,
        snapshot=snapshot,
        notes=order.notes,
        is_cli=is_cli,
    )


def log_reagent_order_update(
    db: Session,
    *,
    before_order: ReagentOrder,
    after_order: ReagentOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    snapshot = {
        "bf": build_reagent_order_snapshot(before_order),
        "af": build_reagent_order_snapshot(after_order),
    }
    return _create_reagent_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ReagentOrderOperationAction.UPDATE,
        order_name=after_order.name,
        cas_number=after_order.cas_number,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_reagent_order_delete(
    db: Session,
    *,
    order: ReagentOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    snapshot = build_reagent_order_snapshot(order)
    return _create_reagent_order_operation_log(
        db,
        order_id=order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=order.applicant_id,
        action=ReagentOrderOperationAction.DELETE,
        order_name=order.name,
        cas_number=order.cas_number,
        snapshot=snapshot,
        notes=order.notes,
        is_cli=is_cli,
    )


def log_reagent_order_approve(
    db: Session,
    *,
    before_order: ReagentOrder,
    after_order: ReagentOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    snapshot = {
        "bf": build_reagent_order_snapshot(before_order),
        "af": build_reagent_order_snapshot(after_order),
    }
    return _create_reagent_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ReagentOrderOperationAction.APPROVE,
        order_name=after_order.name,
        cas_number=after_order.cas_number,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_reagent_order_reject(
    db: Session,
    *,
    before_order: ReagentOrder,
    after_order: ReagentOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    snapshot = {
        "bf": build_reagent_order_snapshot(before_order),
        "af": build_reagent_order_snapshot(after_order),
    }
    return _create_reagent_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ReagentOrderOperationAction.REJECT,
        order_name=after_order.name,
        cas_number=after_order.cas_number,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_reagent_order_export(
    db: Session,
    *,
    exported_count: int,
    actor_user_id: int | None,
    is_cli: bool,
) -> ReagentOrderOperationLog:
    return _create_reagent_order_operation_log(
        db,
        order_id=0,
        actor_user_id=actor_user_id,
        applicant_id=None,
        action=ReagentOrderOperationAction.EXPORT,
        order_name="试剂订单导出",
        cas_number="",
        snapshot={"ct": exported_count},
        notes=None,
        is_cli=is_cli,
    )


def log_consumable_order_create(
    db: Session,
    *,
    order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = build_consumable_order_snapshot(order)
    return _create_consumable_order_operation_log(
        db,
        order_id=order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=order.applicant_id,
        action=ConsumableOrderOperationAction.CREATE,
        order_name=order.name,
        specification=order.specification,
        snapshot=snapshot,
        notes=order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_update(
    db: Session,
    *,
    before_order: ConsumableOrder,
    after_order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = {
        "bf": build_consumable_order_snapshot(before_order),
        "af": build_consumable_order_snapshot(after_order),
    }
    return _create_consumable_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ConsumableOrderOperationAction.UPDATE,
        order_name=after_order.name,
        specification=after_order.specification,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_delete(
    db: Session,
    *,
    order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = build_consumable_order_snapshot(order)
    return _create_consumable_order_operation_log(
        db,
        order_id=order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=order.applicant_id,
        action=ConsumableOrderOperationAction.DELETE,
        order_name=order.name,
        specification=order.specification,
        snapshot=snapshot,
        notes=order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_approve(
    db: Session,
    *,
    before_order: ConsumableOrder,
    after_order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = {
        "bf": build_consumable_order_snapshot(before_order),
        "af": build_consumable_order_snapshot(after_order),
    }
    return _create_consumable_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ConsumableOrderOperationAction.APPROVE,
        order_name=after_order.name,
        specification=after_order.specification,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_reject(
    db: Session,
    *,
    before_order: ConsumableOrder,
    after_order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = {
        "bf": build_consumable_order_snapshot(before_order),
        "af": build_consumable_order_snapshot(after_order),
    }
    return _create_consumable_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ConsumableOrderOperationAction.REJECT,
        order_name=after_order.name,
        specification=after_order.specification,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_arrival_complete(
    db: Session,
    *,
    before_order: ConsumableOrder,
    after_order: ConsumableOrder,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    snapshot = {
        "bf": build_consumable_order_snapshot(before_order),
        "af": build_consumable_order_snapshot(after_order),
    }
    return _create_consumable_order_operation_log(
        db,
        order_id=after_order.id or before_order.id or 0,
        actor_user_id=actor_user_id,
        applicant_id=after_order.applicant_id,
        action=ConsumableOrderOperationAction.ARRIVAL_COMPLETE,
        order_name=after_order.name,
        specification=after_order.specification,
        snapshot=snapshot,
        notes=after_order.notes,
        is_cli=is_cli,
    )


def log_consumable_order_export(
    db: Session,
    *,
    exported_count: int,
    actor_user_id: int | None,
    is_cli: bool,
) -> ConsumableOrderOperationLog:
    return _create_consumable_order_operation_log(
        db,
        order_id=0,
        actor_user_id=actor_user_id,
        applicant_id=None,
        action=ConsumableOrderOperationAction.EXPORT,
        order_name="耗材订单导出",
        specification="",
        snapshot={"ct": exported_count},
        notes=None,
        is_cli=is_cli,
    )
