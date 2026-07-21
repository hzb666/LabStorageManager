"""Render log timeline rows into API payload candidates."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sqlmodel import select

from app.core.time_utils import utc_iso_str
from app.database import DBSession
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
from app.models.user_operation_log import UserOperationAction, UserOperationLog
from app.services.common_shelf_operation_logger import parse_common_shelf_snapshot
from app.services.inventory_operation_logger import parse_inventory_snapshot
from app.services.log_timeline_detail_text import (
    COMMON_SHELF_ACTION_LABELS,
    CONSUMABLE_ORDER_ACTION_LABELS,
    REAGENT_ORDER_ACTION_LABELS,
    USER_OPERATION_ACTION_LABELS,
    build_consumable_order_detail_text,
    build_reagent_order_detail_text,
    build_user_operation_detail_text,
    normalize_action_value,
)
from app.services.order_operation_logger import (
    parse_consumable_order_snapshot,
    parse_reagent_order_snapshot,
)
from app.services.user_operation_logger import parse_user_operation_snapshot
from app.services.user_utils import batch_get_user_names


OTHER_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    UserOperationAction.CREATE_REAGENT_BRAND.value,
    UserOperationAction.UPDATE_REAGENT_BRAND.value,
    UserOperationAction.DELETE_REAGENT_BRAND.value,
    UserOperationAction.CREATE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.UPDATE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.DELETE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.CREATE_ANNOUNCEMENT.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT.value,
    UserOperationAction.DELETE_ANNOUNCEMENT.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT_PIN.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT_VISIBILITY.value,
    UserOperationAction.UPLOAD_ANNOUNCEMENT_IMAGE.value,
    UserOperationAction.DELETE_ANNOUNCEMENT_IMAGE.value,
)
SESSION_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    UserOperationAction.DELETE_SESSION.value,
    UserOperationAction.DELETE_OTHER_SESSIONS.value,
    UserOperationAction.REFRESH_SESSION.value,
    UserOperationAction.UPDATE_SESSION.value,
)
NON_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    *OTHER_USER_OPERATION_ACTION_VALUES,
    *SESSION_USER_OPERATION_ACTION_VALUES,
)
ORDER_EXPORT_SCOPE_LABELS: dict[str, str] = {
    "reagent_orders": "试剂订单",
    "consumable_orders": "耗材订单",
}


@dataclass(frozen=True)
class TimelineSourceBundle:
    reagent_logs: dict[int, ReagentOrderOperationLog]
    consumable_logs: dict[int, ConsumableOrderOperationLog]
    inventory_logs: dict[int, InventoryOperationLog]
    common_shelf_logs: dict[int, CommonShelfOperationLog]
    user_logs: dict[int, UserOperationLog]
    borrow_logs: dict[int, tuple[BorrowLog, Inventory]]
    user_names: dict[int, str]


@dataclass(frozen=True)
class TimelineSourceIds:
    reagent_ids: list[int]
    consumable_ids: list[int]
    inventory_ids: list[int]
    common_shelf_ids: list[int]
    user_log_ids: list[int]
    borrow_ids: list[int]


@dataclass(frozen=True)
class TimelineRenderContext:
    user_id: int
    user_names: dict[int, str]


def get_user_operation_log_type(action_value: str) -> str:
    if action_value in SESSION_USER_OPERATION_ACTION_VALUES:
        return "session"
    if action_value in OTHER_USER_OPERATION_ACTION_VALUES:
        return "other"
    return "user"


def render_log_timeline_candidates(
    db: DBSession,
    rows: list[LogTimeline],
    *,
    user_id: int,
) -> list[dict[str, object]]:
    return [
        _wrap_rendered_candidate(rendered)
        for _, rendered in render_log_timeline_rows(db, rows, user_id=user_id)
    ]


def render_log_timeline_rows(
    db: DBSession,
    rows: list[LogTimeline],
    *,
    user_id: int,
) -> list[tuple[LogTimeline, dict[str, object]]]:
    """Render timeline rows while preserving their source timeline metadata."""

    if not rows:
        return []

    bundle = _load_timeline_source_bundle(db, rows)
    render_context = TimelineRenderContext(
        user_id=user_id,
        user_names=bundle.user_names,
    )
    rendered_rows: list[tuple[LogTimeline, dict[str, object]]] = []
    for row in rows:
        rendered = _render_timeline_candidate(row, bundle=bundle, context=render_context)
        if rendered is not None:
            rendered_rows.append((row, rendered))
    return rendered_rows


def _read_export_count(snapshot: dict[str, object]) -> object:
    return snapshot.get("count", snapshot.get("ct", 0)) or 0


def _build_log_summary_target(
    *,
    target_type: str | None = None,
    target_id: int | str | None = None,
    target_name: str | None = None,
    cas_number: str | None = None,
    specification: str | None = None,
    quantity: float | int | None = None,
    unit: str | None = None,
) -> dict[str, object]:
    return {
        "target_type": target_type,
        "target_id": target_id,
        "target_name": target_name,
        "cas_number": cas_number,
        "specification": specification,
        "quantity": quantity,
        "unit": unit,
    }


def _build_log_summary_metrics(
    *,
    count: int | None = None,
    result_count: int | None = None,
    quantity_borrowed: float | int | None = None,
    quantity_returned: float | int | None = None,
) -> dict[str, object]:
    return {
        "count": count,
        "result_count": result_count,
        "quantity_borrowed": quantity_borrowed,
        "quantity_returned": quantity_returned,
    }


def _build_log_source_meta(
    *,
    source: str | None = None,
    endpoint: str | None = None,
    query_text: str | None = None,
    device_name: str | None = None,
    ip_address: str | None = None,
    export_scope: str | None = None,
) -> dict[str, object]:
    return {
        "source": source,
        "endpoint": endpoint,
        "query_text": query_text,
        "device_name": device_name,
        "ip_address": ip_address,
        "export_scope": export_scope,
    }


def _build_order_export_row(
    *,
    created_at: str,
    export_scope: str,
    log_id: int | None,
    actor_user_id: int | None,
    action_value: str,
    snapshot: dict[str, object],
    is_cli: bool,
) -> dict[str, object]:
    export_count = _read_export_count(snapshot)
    return {
        "time": created_at,
        "type": "export",
        "detail": (
            f"导出{ORDER_EXPORT_SCOPE_LABELS.get(export_scope, '订单')} "
            f"{export_count} 条"
        ),
        "summary": {
            "kind": "order_export",
            "action_code": action_value,
            "target": _build_log_summary_target(target_type="order_export"),
            "metrics": _build_log_summary_metrics(
                count=int(export_count) if isinstance(export_count, int) else None,
            ),
            "source_meta": _build_log_source_meta(export_scope=export_scope),
        },
        "full_data": {
            "id": log_id,
            "actor_user_id": actor_user_id,
            "action": action_value,
            "export_scope": export_scope,
            "count": export_count,
            "snapshot": snapshot,
            "created_at": created_at,
            "is_cli": is_cli,
        },
    }


def _collect_timeline_source_ids(rows: list[LogTimeline]) -> TimelineSourceIds:
    source_ids = TimelineSourceIds([], [], [], [], [], [])
    source_id_lists = {
        LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG: source_ids.reagent_ids,
        LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG: source_ids.consumable_ids,
        LogTimelineSourceTable.INVENTORY_OPERATION_LOG: source_ids.inventory_ids,
        LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG: source_ids.common_shelf_ids,
        LogTimelineSourceTable.USER_OPERATION_LOG: source_ids.user_log_ids,
        LogTimelineSourceTable.BORROWLOG: source_ids.borrow_ids,
    }
    for row in rows:
        source_table = _normalize_source_table(row)
        source_id_list = source_id_lists.get(source_table)
        if source_id_list is not None:
            source_id_list.append(row.source_log_id)
    return source_ids


def _normalize_source_table(row: LogTimeline) -> LogTimelineSourceTable | None:
    source_table = row.source_table
    if isinstance(source_table, LogTimelineSourceTable):
        return source_table
    try:
        return LogTimelineSourceTable(str(source_table))
    except ValueError:
        return None


def _load_logs_by_ids(db: DBSession, model_cls, ids: list[int]) -> dict[int, object]:
    if not ids:
        return {}
    return {
        log.id: log
        for log in db.exec(select(model_cls).where(model_cls.id.in_(ids))).all()
        if log.id is not None
    }


def _load_borrow_logs_by_ids(db: DBSession, ids: list[int]) -> dict[int, tuple[BorrowLog, Inventory]]:
    if not ids:
        return {}
    borrow_rows = db.exec(
        select(BorrowLog, Inventory)
        .join(Inventory, BorrowLog.inventory_id == Inventory.id)
        .where(BorrowLog.id.in_(ids))
    ).all()
    return {
        borrow_log.id: (borrow_log, inventory)
        for borrow_log, inventory in borrow_rows
        if borrow_log.id is not None
    }


def _load_timeline_source_bundle(db: DBSession, rows: list[LogTimeline]) -> TimelineSourceBundle:
    source_ids = _collect_timeline_source_ids(rows)
    reagent_logs = _load_logs_by_ids(db, ReagentOrderOperationLog, source_ids.reagent_ids)
    consumable_logs = _load_logs_by_ids(db, ConsumableOrderOperationLog, source_ids.consumable_ids)
    inventory_logs = _load_logs_by_ids(db, InventoryOperationLog, source_ids.inventory_ids)
    common_shelf_logs = _load_logs_by_ids(db, CommonShelfOperationLog, source_ids.common_shelf_ids)
    user_logs = _load_logs_by_ids(db, UserOperationLog, source_ids.user_log_ids)
    borrow_logs = _load_borrow_logs_by_ids(db, source_ids.borrow_ids)

    user_ids: set[int] = set()
    for log in reagent_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.applicant_id:
            user_ids.add(log.applicant_id)
    for log in consumable_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.applicant_id:
            user_ids.add(log.applicant_id)
    for log in user_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.target_user_id:
            user_ids.add(log.target_user_id)

    return TimelineSourceBundle(
        reagent_logs=reagent_logs,
        consumable_logs=consumable_logs,
        inventory_logs=inventory_logs,
        common_shelf_logs=common_shelf_logs,
        user_logs=user_logs,
        borrow_logs=borrow_logs,
        user_names=batch_get_user_names(db, user_ids) if user_ids else {},
    )


def _wrap_rendered_candidate(rendered: dict[str, object]) -> dict[str, object]:
    return {
        "time": rendered["time"],
        "builder": lambda rendered=rendered: rendered,
    }


def _render_reagent_timeline_row(
    timeline_row: LogTimeline,
    log: ReagentOrderOperationLog,
    context: TimelineRenderContext,
) -> dict[str, object]:
    snapshot = parse_reagent_order_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = normalize_action_value(log.action)
    action_label = REAGENT_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = context.user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if log.applicant_id == context.user_id and log.actor_user_id and log.actor_user_id != context.user_id:
        detail_prefix = f"{actor_name or '管理员'}{action_label}"
    if action_value == "export":
        return _build_order_export_row(
            created_at=created_at,
            export_scope="reagent_orders",
            log_id=log.id,
            actor_user_id=log.actor_user_id,
            action_value=action_value,
            snapshot=snapshot,
            is_cli=timeline_row.is_cli,
        )

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    quantity = display_snapshot.get("quantity")
    return {
        "time": created_at,
        "type": "reagent_order",
        "detail": build_reagent_order_detail_text(detail_prefix, log.order_name, snapshot),
        "summary": {
            "kind": "reagent_order_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.applicant_id == context.user_id
                and log.actor_user_id
                and log.actor_user_id != context.user_id
            ),
            "target": _build_log_summary_target(
                target_type="reagent_order",
                target_id=log.order_id,
                target_name=log.order_name,
                cas_number=log.cas_number,
                specification=(
                    f"{display_snapshot.get('initial_quantity') or ''} "
                    f"{display_snapshot.get('unit') or ''}"
                ).strip()
                or None,
                quantity=quantity,
                unit=display_snapshot.get("unit"),
            ),
        },
        "full_data": {
            "id": log.id,
            "order_id": log.order_id,
            "actor_user_id": log.actor_user_id,
            "applicant_id": log.applicant_id,
            "action": action_value,
            "order_name": log.order_name,
            "cas_number": log.cas_number,
            "snapshot": snapshot,
            "before": before_snapshot,
            "after": after_snapshot,
            "name": display_snapshot.get("name") or log.order_name,
            "specification": f"{display_snapshot.get('initial_quantity') or ''} {display_snapshot.get('unit') or ''}".strip(),
            "quantity": quantity,
            "brand": display_snapshot.get("brand"),
            "purity": display_snapshot.get("purity"),
            "price": display_snapshot.get("price"),
            "order_reason": display_snapshot.get("order_reason"),
            "status": display_snapshot.get("status"),
            "category": display_snapshot.get("category"),
            "notes": log.notes,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_consumable_timeline_row(
    timeline_row: LogTimeline,
    log: ConsumableOrderOperationLog,
    context: TimelineRenderContext,
) -> dict[str, object]:
    snapshot = parse_consumable_order_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = normalize_action_value(log.action)
    action_label = CONSUMABLE_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = context.user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if log.applicant_id == context.user_id and log.actor_user_id and log.actor_user_id != context.user_id:
        detail_prefix = f"{actor_name or '管理员'}{action_label}"
    if action_value == "export":
        return _build_order_export_row(
            created_at=created_at,
            export_scope="consumable_orders",
            log_id=log.id,
            actor_user_id=log.actor_user_id,
            action_value=action_value,
            snapshot=snapshot,
            is_cli=timeline_row.is_cli,
        )

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    return {
        "time": created_at,
        "type": "consumable_order",
        "detail": build_consumable_order_detail_text(
            detail_prefix,
            log.order_name,
            log.specification,
            snapshot,
        ),
        "summary": {
            "kind": "consumable_order_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.applicant_id == context.user_id
                and log.actor_user_id
                and log.actor_user_id != context.user_id
            ),
            "target": _build_log_summary_target(
                target_type="consumable_order",
                target_id=log.order_id,
                target_name=log.order_name,
                specification=log.specification,
                quantity=display_snapshot.get("quantity"),
                unit=display_snapshot.get("unit"),
            ),
        },
        "full_data": {
            "id": log.id,
            "order_id": log.order_id,
            "actor_user_id": log.actor_user_id,
            "applicant_id": log.applicant_id,
            "action": action_value,
            "order_name": log.order_name,
            "specification": log.specification,
            "snapshot": snapshot,
            "before": before_snapshot,
            "after": after_snapshot,
            "notes": log.notes,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_user_timeline_row(
    timeline_row: LogTimeline,
    log: UserOperationLog,
    context: TimelineRenderContext,
) -> dict[str, object]:
    snapshot = parse_user_operation_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = normalize_action_value(log.action)
    action_label = USER_OPERATION_ACTION_LABELS.get(action_value, action_value)
    actor_name = context.user_names.get(log.actor_user_id)
    detail = action_label
    if log.target_user_id == context.user_id and log.actor_user_id and log.actor_user_id != context.user_id:
        detail = f"{actor_name or '管理员'}对你执行: {action_label}"
    detail = build_user_operation_detail_text(detail, log.detail)
    return {
        "time": created_at,
        "type": get_user_operation_log_type(action_value),
        "detail": detail,
        "summary": {
            "kind": "user_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.target_user_id == context.user_id
                and log.actor_user_id
                and log.actor_user_id != context.user_id
            ),
            "targets_viewer": bool(log.target_user_id == context.user_id),
            "target": _build_log_summary_target(
                target_type="user",
                target_id=log.target_user_id,
            ),
            "extra_detail": log.detail,
        },
        "full_data": {
            "id": log.id,
            "action": action_value,
            "actor_user_id": log.actor_user_id,
            "target_user_id": log.target_user_id,
            "outcome": log.outcome,
            "client_ip": log.client_ip,
            "request_id": log.request_id,
            "detail": log.detail,
            "snapshot": snapshot,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_inventory_timeline_row(
    timeline_row: LogTimeline,
    log: InventoryOperationLog,
    _context: TimelineRenderContext,
) -> dict[str, object]:
    snapshot = parse_inventory_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = normalize_action_value(log.action)
    if action_value == InventoryOperationAction.INVENTORY_UPDATE.value:
        before_snapshot = snapshot.get("before", {})
        after_snapshot = snapshot.get("after", {})
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"更新库存 {log.item_name}",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "target": _build_log_summary_target(
                    target_type="inventory",
                    target_id=log.inventory_id,
                    target_name=log.item_name,
                    cas_number=log.cas_number,
                ),
            },
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "action": action_value,
                "name": log.item_name,
                "cas_number": log.cas_number,
                "before": before_snapshot,
                "after": after_snapshot,
                "purity": after_snapshot.get("purity"),
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }
    if action_value == InventoryOperationAction.INVENTORY_DELETE.value:
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"删除库存 {log.item_name}",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "target": _build_log_summary_target(
                    target_type="inventory",
                    target_id=log.inventory_id,
                    target_name=log.item_name,
                    cas_number=log.cas_number,
                ),
            },
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "action": action_value,
                "cas_number": log.cas_number,
                "name": log.item_name,
                "english_name": snapshot.get("english_name"),
                "alias": snapshot.get("alias"),
                "category": snapshot.get("category"),
                "brand": snapshot.get("brand"),
                "purity": snapshot.get("purity"),
                "storage_location": snapshot.get("storage_location"),
                "initial_quantity": snapshot.get("initial_quantity"),
                "remaining_quantity": snapshot.get("remaining_quantity"),
                "unit": snapshot.get("unit"),
                "is_hazardous": snapshot.get("is_hazardous"),
                "notes": snapshot.get("notes"),
                "internal_code": snapshot.get("internal_code"),
                "status": snapshot.get("status"),
                "created_at": created_at,
                "updated_at": snapshot.get("updated_at"),
                "is_cli": timeline_row.is_cli,
            },
        }
    if action_value == InventoryOperationAction.INVENTORY_EXPORT.value:
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"导出库存 {export_count} 条",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "metrics": _build_log_summary_metrics(
                    count=int(export_count) if isinstance(export_count, int) else None,
                ),
                "source_meta": _build_log_source_meta(export_scope="inventory"),
            },
            "full_data": {
                "id": log.id,
                "action": action_value,
                "export_scope": "inventory",
                "count": export_count,
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    return {
        "time": created_at,
        "type": "inventory",
        "detail": f"入库 {log.item_name} {snapshot.get('initial_quantity') or ''}{snapshot.get('unit') or ''}",
        "summary": {
            "kind": "inventory_action",
            "action_code": action_value,
            "target": _build_log_summary_target(
                target_type="inventory",
                target_id=log.inventory_id,
                target_name=log.item_name,
                cas_number=log.cas_number,
                quantity=snapshot.get("initial_quantity"),
                unit=snapshot.get("unit"),
            ),
        },
        "full_data": {
            "id": log.id,
            "inventory_id": log.inventory_id,
            "action": action_value,
            "cas_number": log.cas_number,
            "name": log.item_name,
            "english_name": snapshot.get("english_name"),
            "alias": snapshot.get("alias"),
            "category": snapshot.get("category"),
            "brand": snapshot.get("brand"),
            "purity": snapshot.get("purity"),
            "storage_location": snapshot.get("storage_location"),
            "initial_quantity": snapshot.get("initial_quantity"),
            "remaining_quantity": snapshot.get("remaining_quantity"),
            "unit": snapshot.get("unit"),
            "is_hazardous": snapshot.get("is_hazardous"),
            "notes": snapshot.get("notes"),
            "internal_code": snapshot.get("internal_code"),
            "status": snapshot.get("status"),
            "source": snapshot.get("source"),
            "created_at": created_at,
            "updated_at": snapshot.get("updated_at"),
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_common_shelf_timeline_row(
    timeline_row: LogTimeline,
    log: CommonShelfOperationLog,
    _context: TimelineRenderContext,
) -> dict[str, object]:
    snapshot = parse_common_shelf_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = normalize_action_value(log.action)
    if action_value == CommonShelfOperationAction.EXPORT.value:
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "common_shelf",
            "detail": f"导出常用货架 {export_count} 条",
            "summary": {
                "kind": "common_shelf_action",
                "action_code": action_value,
                "metrics": _build_log_summary_metrics(
                    count=int(export_count) if isinstance(export_count, int) else None,
                ),
                "source_meta": _build_log_source_meta(export_scope="common_shelf"),
            },
            "full_data": {
                "id": log.id,
                "action": action_value,
                "export_scope": "common_shelf",
                "count": export_count,
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    action_label = COMMON_SHELF_ACTION_LABELS.get(action_value, action_value)
    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    return {
        "time": created_at,
        "type": "common_shelf",
        "detail": f"{action_label} {log.item_name}",
        "summary": {
            "kind": "common_shelf_action",
            "action_code": action_value,
            "target": _build_log_summary_target(
                target_type="common_shelf",
                target_id=log.common_shelf_id,
                target_name=log.item_name,
                cas_number=log.cas_number,
                specification=display_snapshot.get("specification_text"),
            ),
        },
        "full_data": {
            "id": log.id,
            "common_shelf_id": log.common_shelf_id,
            "action": action_value,
            "cas_number": log.cas_number,
            "name": log.item_name,
            "brand": display_snapshot.get("brand"),
            "purity": display_snapshot.get("purity"),
            "specification_text": display_snapshot.get("specification_text"),
            "storage_location": display_snapshot.get("storage_location"),
            "count": snapshot.get("count"),
            "location": snapshot.get("location"),
            "notes": display_snapshot.get("notes"),
            "before": before_snapshot,
            "after": after_snapshot,
            "snapshot": snapshot,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_borrow_timeline_row(
    timeline_row: LogTimeline,
    borrow_row: tuple[BorrowLog, Inventory],
    _context: TimelineRenderContext,
) -> dict[str, object]:
    borrow_log, inventory = borrow_row
    is_returned = borrow_log.return_time is not None
    return_info = f", 已归还 {borrow_log.quantity_returned} {inventory.unit or ''}" if is_returned else ", 未归还"
    borrow_time = utc_iso_str(borrow_log.borrow_time)
    return {
        "time": borrow_time,
        "type": "borrow",
        "detail": f"借用 {inventory.name} {borrow_log.quantity_borrowed} {inventory.unit or ''}{return_info}",
        "summary": {
            "kind": "borrow_action",
            "action_code": "borrow",
            "target": _build_log_summary_target(
                target_type="inventory",
                target_id=borrow_log.inventory_id,
                target_name=inventory.name,
                cas_number=inventory.cas_number,
                unit=inventory.unit,
            ),
            "metrics": _build_log_summary_metrics(
                quantity_borrowed=borrow_log.quantity_borrowed,
                quantity_returned=borrow_log.quantity_returned,
            ),
            "is_returned": is_returned,
        },
        "full_data": {
            "id": borrow_log.id,
            "inventory_id": borrow_log.inventory_id,
            "inventory_name": inventory.name,
            "cas_number": inventory.cas_number,
            "borrow_time": borrow_time,
            "return_time": utc_iso_str(borrow_log.return_time),
            "quantity_borrowed": borrow_log.quantity_borrowed,
            "quantity_returned": borrow_log.quantity_returned,
            "unit": inventory.unit,
            "notes": borrow_log.notes,
            "is_returned": is_returned,
            "created_at": utc_iso_str(borrow_log.created_at),
            "is_cli": timeline_row.is_cli,
        },
    }


def _get_source_row(
    bundle: TimelineSourceBundle,
    source_table: LogTimelineSourceTable,
    source_log_id: int,
):
    source_getters = {
        LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG: bundle.reagent_logs.get,
        LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG: bundle.consumable_logs.get,
        LogTimelineSourceTable.INVENTORY_OPERATION_LOG: bundle.inventory_logs.get,
        LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG: bundle.common_shelf_logs.get,
        LogTimelineSourceTable.USER_OPERATION_LOG: bundle.user_logs.get,
        LogTimelineSourceTable.BORROWLOG: bundle.borrow_logs.get,
    }
    getter = source_getters.get(source_table)
    return getter(source_log_id) if getter is not None else None


def _render_timeline_candidate(
    timeline_row: LogTimeline,
    *,
    bundle: TimelineSourceBundle,
    context: TimelineRenderContext,
) -> dict[str, object] | None:
    source_table = _normalize_source_table(timeline_row)
    if source_table is None:
        return None
    source_row = _get_source_row(bundle, source_table, timeline_row.source_log_id)
    if source_row is None:
        return None

    renderers: dict[
        LogTimelineSourceTable,
        Callable[[LogTimeline, object, TimelineRenderContext], dict[str, object]],
    ] = {
        LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG: _render_reagent_timeline_row,
        LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG: _render_consumable_timeline_row,
        LogTimelineSourceTable.INVENTORY_OPERATION_LOG: _render_inventory_timeline_row,
        LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG: _render_common_shelf_timeline_row,
        LogTimelineSourceTable.USER_OPERATION_LOG: _render_user_timeline_row,
        LogTimelineSourceTable.BORROWLOG: _render_borrow_timeline_row,
    }
    renderer = renderers.get(source_table)
    return renderer(timeline_row, source_row, context) if renderer is not None else None
