"""Dashboard panel item builders."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func
from sqlmodel import Session, select

from app.core.constants import OVERDUE_BORROW_DAYS
from app.core.time_utils import get_display_day_age_cutoff, utc_iso_str
from app.models.chemical_name_map import ChemicalNameMap
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.common_shelf_operation_log import CommonShelfOperationAction, CommonShelfOperationLog
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.consumable_order_operation_log import (
    ConsumableOrderOperationAction,
    ConsumableOrderOperationLog,
)
from app.models.inventory import Inventory, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.reagent_order_operation_log import (
    ReagentOrderOperationAction,
    ReagentOrderOperationLog,
)
from app.models.user import User
from app.models.user_session import UserSession
from app.services.dashboard.common import (
    COMMON_SHELF_ALERT_BOTTLE_THRESHOLD,
    INVENTORY_STOCK_ALERT_PERCENT,
    LIST_LIMIT,
    LONG_PENDING_DAYS,
    LONG_UNARRIVED_APPROVED_DAYS,
    PENDING_STOCKIN_ALERT_DAYS,
    TODO_PENDING_ALERT_DAYS,
    _board_panel_item,
    _build_dashboard_entity,
    _build_dashboard_metrics,
    _consumable_detail,
    _count,
    _count_model_rows,
    _exec_dashboard_limited,
    _inventory_detail,
    _join_dashboard_detail_parts,
    _reagent_detail,
    _with_dashboard_structured,
)
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names

def _load_recent_logs(db: Session, model: Any, condition: Any) -> list[Any]:
    return db.exec(
        select(model).where(condition).order_by(model.created_at.desc()).limit(LIST_LIMIT)
    ).all()


def _collect_recent_log_actor_ids(
    log_groups: list[tuple[list[Any], str]],
) -> set[int]:
    actor_ids: set[int] = set()
    for logs, actor_attr in log_groups:
        for log in logs:
            actor_id = getattr(log, actor_attr, None)
            if actor_id:
                actor_ids.add(actor_id)
    return actor_ids


def _append_recent_actions(
    actions: list[dict[str, Any]],
    logs: list[Any],
    users_map: dict[int, str],
    *,
    actor_attr: str,
    label_suffix: str,
    detail_attr: str,
) -> None:
    for log in logs:
        actor_id = getattr(log, actor_attr, None)
        actor_name = users_map.get(actor_id) or "系统"
        subject_name = getattr(log, detail_attr)
        label_code = "management_action.other"
        entity_type = "unknown"
        entity_id = getattr(log, "id", None)
        if isinstance(log, ReagentOrderOperationLog):
            label_code = "management_action.reagent_order_reviewed"
            entity_type = "reagent_order"
            entity_id = getattr(log, "order_id", entity_id)
        elif isinstance(log, ConsumableOrderOperationLog):
            label_code = "management_action.consumable_order_reviewed"
            entity_type = "consumable_order"
            entity_id = getattr(log, "order_id", entity_id)
        elif isinstance(log, InventoryOperationLog):
            label_code = "management_action.inventory_stocked"
            entity_type = "inventory"
            entity_id = getattr(log, "inventory_id", entity_id)
        elif isinstance(log, CommonShelfOperationLog):
            label_code = "management_action.common_shelf_updated"
            entity_type = "common_shelf"
            entity_id = getattr(log, "common_shelf_id", entity_id)
        actions.append(
            _with_dashboard_structured(
                {
                    "label": f"{actor_name}{label_suffix}",
                    "detail": subject_name,
                    "created_at": utc_iso_str(log.created_at),
                },
                label_code=label_code,
                entity=_build_dashboard_entity(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    name=subject_name,
                    preferred_name=subject_name,
                    preferred_name_source="operation_log",
                    actor_name=actor_name,
                ),
            )
        )


def _get_recent_management_actions(db: Session) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    reagent_logs = _load_recent_logs(
        db,
        ReagentOrderOperationLog,
        ReagentOrderOperationLog.action.in_(
            [
                ReagentOrderOperationAction.APPROVE,
                ReagentOrderOperationAction.REJECT,
            ]
        ),
    )
    consumable_logs = _load_recent_logs(
        db,
        ConsumableOrderOperationLog,
        ConsumableOrderOperationLog.action.in_(
            [
                ConsumableOrderOperationAction.APPROVE,
                ConsumableOrderOperationAction.REJECT,
                ConsumableOrderOperationAction.ARRIVAL_COMPLETE,
            ]
        ),
    )
    inventory_logs = _load_recent_logs(
        db,
        InventoryOperationLog,
        InventoryOperationLog.action == InventoryOperationAction.STOCK_IN,
    )
    common_logs = _load_recent_logs(
        db,
        CommonShelfOperationLog,
        CommonShelfOperationLog.action == CommonShelfOperationAction.STOCK_IN,
    )
    log_groups = [
        (reagent_logs, "actor_user_id", "处理试剂订单", "order_name"),
        (consumable_logs, "actor_user_id", "处理耗材订单", "order_name"),
        (inventory_logs, "operator_id", "完成入库", "item_name"),
        (common_logs, "operator_id", "更新常用货架", "item_name"),
    ]
    users_map = batch_get_user_names(
        db,
        _collect_recent_log_actor_ids(
            [(logs, actor_attr) for logs, actor_attr, _, _ in log_groups]
        ),
    )

    for logs, actor_attr, label_suffix, detail_attr in log_groups:
        _append_recent_actions(
            actions,
            logs,
            users_map,
            actor_attr=actor_attr,
            label_suffix=label_suffix,
            detail_attr=detail_attr,
        )

    return sorted(actions, key=lambda item: item["created_at"], reverse=True)[:LIST_LIMIT]

@dataclass(frozen=True)
class SystemStatusCounts:
    pending_reagent_count: int
    pending_consumable_count: int
    pending_stockin_count: int
    overdue_borrow_count: int
    long_pending_order_count: int


def _get_todo_items(
    db: Session,
    now: datetime,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    overdue_cutoff = get_display_day_age_cutoff(TODO_PENDING_ALERT_DAYS, now)
    reagent_statement = (
        select(ReagentOrder)
        .where(ReagentOrder.status == ReagentOrderStatus.PENDING)
        .order_by(ReagentOrder.created_at.desc())
    )
    if limit is not None:
        reagent_statement = reagent_statement.limit(limit)
    reagent_orders = db.exec(reagent_statement).all()
    consumable_statement = (
        select(ConsumableOrder)
        .where(ConsumableOrder.status == ConsumableOrderStatus.PENDING)
        .order_by(ConsumableOrder.created_at.desc())
    )
    if limit is not None:
        consumable_statement = consumable_statement.limit(limit)
    consumable_orders = db.exec(consumable_statement).all()
    submitter_ids: set[int | None] = set()
    submitter_ids.update(order.applicant_id for order in reagent_orders)
    submitter_ids.update(order.applicant_id for order in consumable_orders)
    users_map = batch_get_user_names(db, submitter_ids)

    items.extend(
        _with_dashboard_structured(
            {
                "label": "待审批试剂订单",
                "detail": f"{order.name} · {order.cas_number}",
                "submitter_name": users_map.get(order.applicant_id) or "-",
                "tab": "reagents",
                "severity": "high" if order.created_at < overdue_cutoff else "medium",
                "is_overdue": order.created_at < overdue_cutoff,
                "created_at": utc_iso_str(order.created_at),
            },
            label_code="todo.reagent_order_pending_approval",
            entity=_build_dashboard_entity(
                entity_type="reagent_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="reagent_order",
                cas_number=order.cas_number,
                specification=format_specification(order.initial_quantity, order.unit) or "-",
                quantity=order.quantity,
                unit=order.unit,
            ),
            metrics=_build_dashboard_metrics(
                threshold_days=TODO_PENDING_ALERT_DAYS,
            ),
        )
        for order in reagent_orders
    )
    items.extend(
        _with_dashboard_structured(
            {
                "label": "待审批耗材订单",
                "detail": f"{order.name} · {order.specification or order.unit or '-'}",
                "submitter_name": users_map.get(order.applicant_id) or "-",
                "tab": "consumables",
                "severity": "high" if order.created_at < overdue_cutoff else "medium",
                "is_overdue": order.created_at < overdue_cutoff,
                "created_at": utc_iso_str(order.created_at),
            },
            label_code="todo.consumable_order_pending_approval",
            entity=_build_dashboard_entity(
                entity_type="consumable_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="consumable_order",
                specification=order.specification or order.unit or "-",
                quantity=order.quantity,
                unit=order.unit,
            ),
            metrics=_build_dashboard_metrics(
                threshold_days=TODO_PENDING_ALERT_DAYS,
            ),
        )
        for order in consumable_orders
    )
    sorted_items = sorted(items, key=lambda item: item["created_at"], reverse=True)
    if limit is None:
        return sorted_items
    return sorted_items[:limit]


def _build_system_status_item(
    label: str,
    value: int,
    tone: str,
    *,
    label_code: str,
) -> dict[str, Any]:
    return _with_dashboard_structured(
        {
            "label": label,
            "value": value,
            "detail": "",
            "tone": tone,
        },
        label_code=label_code,
        metrics=_build_dashboard_metrics(value=value),
    )


def _build_user_activity_system_status(db: Session, now: datetime) -> list[dict[str, Any]]:
    active_since = now - timedelta(days=1)
    active_user_count = _count(
        db,
        select(func.count()).select_from(User).where(User.is_active.is_(True)),
    )
    active_session_count = _count(
        db,
        select(func.count())
        .select_from(UserSession)
        .where(UserSession.expires_at > now),
    )
    recent_active_user_count = _count(
        db,
        select(func.count(func.distinct(UserSession.user_id)))
        .select_from(UserSession)
        .where(UserSession.expires_at > now)
        .where(UserSession.last_active_at >= active_since),
    )
    return [
        _build_system_status_item(
            "启用用户",
            active_user_count,
            "neutral",
            label_code="system_status.active_users",
        ),
        _build_system_status_item(
            "有效会话",
            active_session_count,
            "success" if active_session_count > 0 else "neutral",
            label_code="system_status.active_sessions",
        ),
        _build_system_status_item(
            "今日活跃",
            recent_active_user_count,
            "success" if recent_active_user_count > 0 else "neutral",
            label_code="system_status.active_users_today",
        ),
    ]


def _build_system_status(
    *,
    db: Session,
    now: datetime,
    counts: SystemStatusCounts,
) -> list[dict[str, Any]]:
    return [
        *_build_user_activity_system_status(db, now),
        _build_system_status_item(
            "待审试剂",
            counts.pending_reagent_count,
            "warning" if counts.pending_reagent_count > 0 else "success",
            label_code="system_status.pending_reagent_orders",
        ),
        _build_system_status_item(
            "待审耗材",
            counts.pending_consumable_count,
            "warning" if counts.pending_consumable_count > 0 else "success",
            label_code="system_status.pending_consumable_orders",
        ),
        _build_system_status_item(
            "暂存入库",
            counts.pending_stockin_count,
            "warning" if counts.pending_stockin_count > 0 else "success",
            label_code="system_status.pending_stockin",
        ),
        _build_system_status_item(
            "逾期借用",
            counts.overdue_borrow_count,
            "high" if counts.overdue_borrow_count > 0 else "success",
            label_code="system_status.overdue_borrows",
        ),
        _build_system_status_item(
            "处理积压",
            counts.long_pending_order_count,
            "warning" if counts.long_pending_order_count > 0 else "success",
            label_code="system_status.pending_backlog",
        ),
    ]

BOARD_ORDER_OVERVIEW_REAGENT_STATUSES = (
    ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED, ReagentOrderStatus.REJECTED
)
BOARD_ORDER_OVERVIEW_CONSUMABLE_STATUSES = (
    ConsumableOrderStatus.PENDING, ConsumableOrderStatus.APPROVED, ConsumableOrderStatus.REJECTED
)
BOARD_ORDER_OVERVIEW_STATUS_LABELS = {
    ReagentOrderStatus.PENDING.value: "待审批",
    ReagentOrderStatus.APPROVED.value: "已批准",
    ReagentOrderStatus.REJECTED.value: "已驳回",
}
BOARD_ORDER_OVERVIEW_STATUS_SEVERITIES = {
    ReagentOrderStatus.PENDING.value: "warning",
    ReagentOrderStatus.APPROVED.value: "success",
    ReagentOrderStatus.REJECTED.value: "high",
}


def _get_user_board_overview_reagent_orders(
    db: Session, user_id: int, limit: int | None = LIST_LIMIT
) -> list[ReagentOrder]:
    statement = (
        select(ReagentOrder)
        .where(
            ReagentOrder.applicant_id == user_id,
            ReagentOrder.status.in_(BOARD_ORDER_OVERVIEW_REAGENT_STATUSES),
        )
        .order_by(ReagentOrder.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


def _get_user_board_overview_consumable_orders(
    db: Session, user_id: int, limit: int | None = LIST_LIMIT
) -> list[ConsumableOrder]:
    statement = (
        select(ConsumableOrder)
        .where(
            ConsumableOrder.applicant_id == user_id,
            ConsumableOrder.status.in_(BOARD_ORDER_OVERVIEW_CONSUMABLE_STATUSES),
        )
        .order_by(ConsumableOrder.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


def _count_user_order_overview_items(db: Session, user_id: int) -> int:
    reagent_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.applicant_id == user_id,
        ReagentOrder.status.in_(BOARD_ORDER_OVERVIEW_REAGENT_STATUSES),
    )
    consumable_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.applicant_id == user_id,
        ConsumableOrder.status.in_(BOARD_ORDER_OVERVIEW_CONSUMABLE_STATUSES),
    )
    return reagent_count + consumable_count


def _build_user_order_overview_items(
    db: Session,
    current_user: User,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    items = [
        _board_panel_item(
            "试剂",
            order.name,
            tab="reagents",
            impact=BOARD_ORDER_OVERVIEW_STATUS_LABELS.get(order.status.value, order.status.value),
            severity=BOARD_ORDER_OVERVIEW_STATUS_SEVERITIES.get(order.status.value, "neutral"),
            created_at=order.updated_at,
            label_code="board.order_overview.reagent_order",
            impact_code=f"order_status.{order.status.value}",
            entity=_build_dashboard_entity(
                entity_type="reagent_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="reagent_order",
                cas_number=order.cas_number,
                specification=format_specification(order.initial_quantity, order.unit) or None,
                quantity=order.quantity,
                unit=order.unit,
            ),
        )
        for order in _get_user_board_overview_reagent_orders(db, current_user.id, limit)
    ]
    items.extend(
        _board_panel_item(
            "耗材",
            order.name,
            tab="consumables",
            impact=BOARD_ORDER_OVERVIEW_STATUS_LABELS.get(order.status.value, order.status.value),
            severity=BOARD_ORDER_OVERVIEW_STATUS_SEVERITIES.get(order.status.value, "neutral"),
            created_at=order.updated_at,
            label_code="board.order_overview.consumable_order",
            impact_code=f"order_status.{order.status.value}",
            entity=_build_dashboard_entity(
                entity_type="consumable_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="consumable_order",
                specification=order.specification or order.unit or None,
                quantity=order.quantity,
                unit=order.unit,
            ),
        )
        for order in _get_user_board_overview_consumable_orders(db, current_user.id, limit)
    )
    sorted_items = sorted(items, key=lambda item: item["created_at"] or "", reverse=True)
    return sorted_items if limit is None else sorted_items[:limit]


def _get_user_approved_reagent_orders(
    db: Session, user_id: int, limit: int | None = LIST_LIMIT
) -> list[ReagentOrder]:
    statement = (
        select(ReagentOrder)
        .where(
            ReagentOrder.applicant_id == user_id,
            ReagentOrder.status == ReagentOrderStatus.APPROVED,
        )
        .order_by(ReagentOrder.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


def _get_user_approved_consumable_orders(
    db: Session, user_id: int, limit: int | None = LIST_LIMIT
) -> list[ConsumableOrder]:
    statement = (
        select(ConsumableOrder)
        .where(
            ConsumableOrder.applicant_id == user_id,
            ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
        )
        .order_by(ConsumableOrder.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


def _get_user_overdue_borrowed_items(
    db: Session,
    user_id: int,
    now: datetime,
    limit: int | None = LIST_LIMIT,
) -> list[Inventory]:
    overdue_cutoff = get_display_day_age_cutoff(OVERDUE_BORROW_DAYS, now)
    statement = (
        select(Inventory)
        .where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.borrower_id == user_id,
            Inventory.updated_at < overdue_cutoff,
        )
        .order_by(Inventory.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


def _count_user_board_action_items(
    db: Session,
    user_id: int,
    now: datetime,
) -> int:
    overdue_cutoff = get_display_day_age_cutoff(OVERDUE_BORROW_DAYS, now)
    approved_reagent_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.applicant_id == user_id,
        ReagentOrder.status == ReagentOrderStatus.APPROVED,
    )
    approved_consumable_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.applicant_id == user_id,
        ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
    )
    overdue_borrow_count = _count_model_rows(
        db,
        Inventory,
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.borrower_id == user_id,
        Inventory.updated_at < overdue_cutoff,
    )
    return approved_reagent_count + approved_consumable_count + overdue_borrow_count


def _get_user_board_action_items(
    db: Session,
    current_user: User,
    now: datetime,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    items = [
        _board_panel_item(
            "待确认到货",
            _reagent_detail(order),
            tab="reagents",
            created_at=order.updated_at,
            label_code="board.action.reagent_order_arrived_pending_confirm",
            entity=_build_dashboard_entity(
                entity_type="reagent_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="reagent_order",
                cas_number=order.cas_number,
                specification=format_specification(order.initial_quantity, order.unit) or "-",
                quantity=order.quantity,
                unit=order.unit,
            ),
        )
        for order in _get_user_approved_reagent_orders(db, current_user.id, limit)
    ]
    items.extend(
        _board_panel_item(
            "待确认耗材",
            _consumable_detail(order),
            tab="consumables",
            created_at=order.updated_at,
            label_code="board.action.consumable_order_arrived_pending_confirm",
            entity=_build_dashboard_entity(
                entity_type="consumable_order",
                entity_id=order.id,
                name=order.name,
                preferred_name=order.name,
                preferred_name_source="consumable_order",
                specification=order.specification or order.unit or "-",
                quantity=order.quantity,
                unit=order.unit,
            ),
        )
        for order in _get_user_approved_consumable_orders(db, current_user.id, limit)
    )
    items.extend(
        _board_panel_item(
            "借用超期",
            _inventory_detail(item),
            tab="borrows",
            severity="high",
            created_at=item.updated_at,
            label_code="board.action.borrow_overdue",
            entity=_build_dashboard_entity(
                entity_type="inventory",
                entity_id=item.id,
                name=item.name,
                preferred_name=item.name,
                preferred_name_source="inventory",
                cas_number=item.cas_number,
                specification=format_specification(item.initial_quantity, item.unit) or "-",
                unit=item.unit,
            ),
            metrics=_build_dashboard_metrics(threshold_days=OVERDUE_BORROW_DAYS),
        )
        for item in _get_user_overdue_borrowed_items(db, current_user.id, now, limit)
    )
    sorted_items = sorted(items, key=lambda item: item["created_at"] or "", reverse=True)
    return sorted_items if limit is None else sorted_items[:limit]

def _build_reagent_order_risk_item(
    order: ReagentOrder,
    users_map: dict[int, str],
    *,
    label: str,
    label_code: str,
    threshold_days: int,
    created_at: datetime,
) -> dict[str, Any]:
    specification = format_specification(order.initial_quantity, order.unit) or "-"
    return _with_dashboard_structured(
        {
            "label": label,
            "detail": _join_dashboard_detail_parts(order.name, order.cas_number, specification),
            "submitter_name": users_map.get(order.applicant_id) or "-",
            "severity": "medium",
            "tab": "reagents",
            "created_at": utc_iso_str(created_at),
            "is_overdue": True,
        },
        label_code=label_code,
        entity=_build_dashboard_entity(
            entity_type="reagent_order",
            entity_id=order.id,
            name=order.name,
            preferred_name=order.name,
            preferred_name_source="reagent_order",
            cas_number=order.cas_number,
            specification=specification,
            quantity=order.quantity,
            unit=order.unit,
        ),
        metrics=_build_dashboard_metrics(threshold_days=threshold_days),
    )


def _build_consumable_order_risk_item(
    order: ConsumableOrder,
    users_map: dict[int, str],
    *,
    label: str,
    label_code: str,
    threshold_days: int,
    created_at: datetime,
) -> dict[str, Any]:
    specification = order.specification or order.unit or "-"
    return _with_dashboard_structured(
        {
            "label": label,
            "detail": _join_dashboard_detail_parts(order.name, specification),
            "submitter_name": users_map.get(order.applicant_id) or "-",
            "severity": "medium",
            "tab": "consumables",
            "created_at": utc_iso_str(created_at),
            "is_overdue": True,
        },
        label_code=label_code,
        entity=_build_dashboard_entity(
            entity_type="consumable_order",
            entity_id=order.id,
            name=order.name,
            preferred_name=order.name,
            preferred_name_source="consumable_order",
            specification=specification,
            quantity=order.quantity,
            unit=order.unit,
        ),
        metrics=_build_dashboard_metrics(threshold_days=threshold_days),
    )


def _build_inventory_risk_item(
    item: Inventory,
    users_map: dict[int, str],
    *,
    label: str,
    label_code: str,
    threshold_days: int,
    user_id: int | None,
    severity: str,
    tab: str,
    created_at: datetime,
) -> dict[str, Any]:
    specification = format_specification(item.initial_quantity, item.unit) or "-"
    return _with_dashboard_structured(
        {
            "label": label,
            "detail": _join_dashboard_detail_parts(item.name, item.cas_number, specification),
            "submitter_name": users_map.get(user_id) or "-",
            "severity": severity,
            "tab": tab,
            "created_at": utc_iso_str(created_at),
            "is_overdue": True,
        },
        label_code=label_code,
        entity=_build_dashboard_entity(
            entity_type="inventory",
            entity_id=item.id,
            name=item.name,
            preferred_name=item.name,
            preferred_name_source="inventory",
            cas_number=item.cas_number,
            specification=specification,
            unit=item.unit,
        ),
        metrics=_build_dashboard_metrics(threshold_days=threshold_days),
    )


def _risk_sort_key(item: dict[str, Any]) -> tuple[int, str]:
    severity_rank = 0 if item.get("severity") == "high" else 1
    return (severity_rank, item.get("created_at") or "")


def _get_risk_items(
    db: Session,
    now: datetime,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    long_pending_cutoff = get_display_day_age_cutoff(LONG_PENDING_DAYS, now)
    long_unarrived_cutoff = get_display_day_age_cutoff(
        LONG_UNARRIVED_APPROVED_DAYS,
        now,
    )
    overdue_borrow_cutoff = get_display_day_age_cutoff(OVERDUE_BORROW_DAYS, now)
    pending_stockin_cutoff = get_display_day_age_cutoff(PENDING_STOCKIN_ALERT_DAYS, now)
    reagent_pending_orders = _exec_dashboard_limited(
        db,
        select(ReagentOrder)
        .where(
            ReagentOrder.status == ReagentOrderStatus.PENDING,
            ReagentOrder.created_at < long_pending_cutoff,
        )
        .order_by(ReagentOrder.created_at.asc()),
        limit,
    )
    consumable_pending_orders = _exec_dashboard_limited(
        db,
        select(ConsumableOrder)
        .where(
            ConsumableOrder.status == ConsumableOrderStatus.PENDING,
            ConsumableOrder.created_at < long_pending_cutoff,
        )
        .order_by(ConsumableOrder.created_at.asc()),
        limit,
    )
    reagent_unarrived_orders = _exec_dashboard_limited(
        db,
        select(ReagentOrder)
        .where(
            ReagentOrder.status == ReagentOrderStatus.APPROVED,
            ReagentOrder.updated_at < long_unarrived_cutoff,
        )
        .order_by(ReagentOrder.updated_at.asc()),
        limit,
    )
    consumable_unconfirmed_orders = _exec_dashboard_limited(
        db,
        select(ConsumableOrder)
        .where(
            ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
            ConsumableOrder.updated_at < long_unarrived_cutoff,
        )
        .order_by(ConsumableOrder.updated_at.asc()),
        limit,
    )
    pending_stockin_items = _exec_dashboard_limited(
        db,
        select(Inventory)
        .where(
            Inventory.storage_location.is_(None),
            Inventory.temporary_keeper_id.is_not(None),
            Inventory.created_at < pending_stockin_cutoff,
        )
        .order_by(Inventory.created_at.asc()),
        limit,
    )
    overdue_borrow_items = _exec_dashboard_limited(
        db,
        select(Inventory)
        .where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.updated_at < overdue_borrow_cutoff,
        )
        .order_by(Inventory.updated_at.asc()),
        limit,
    )
    user_ids: set[int | None] = set()
    user_ids.update(order.applicant_id for order in reagent_pending_orders)
    user_ids.update(order.applicant_id for order in consumable_pending_orders)
    user_ids.update(order.applicant_id for order in reagent_unarrived_orders)
    user_ids.update(order.applicant_id for order in consumable_unconfirmed_orders)
    user_ids.update(item.temporary_keeper_id for item in pending_stockin_items)
    user_ids.update(item.borrower_id for item in overdue_borrow_items)
    users_map = batch_get_user_names(db, user_ids)
    risks = [
        _build_reagent_order_risk_item(
            order,
            users_map,
            label="试剂订单审批超时",
            label_code="risk.reagent_order_approval_timeout",
            threshold_days=LONG_PENDING_DAYS,
            created_at=order.created_at,
        )
        for order in reagent_pending_orders
    ]
    risks.extend(
        _build_consumable_order_risk_item(
            order,
            users_map,
            label="耗材订单审批超时",
            label_code="risk.consumable_order_approval_timeout",
            threshold_days=LONG_PENDING_DAYS,
            created_at=order.created_at,
        )
        for order in consumable_pending_orders
    )
    risks.extend(
        _build_reagent_order_risk_item(
            order,
            users_map,
            label="试剂长时间未到货",
            label_code="risk.reagent_order_unarrived",
            threshold_days=LONG_UNARRIVED_APPROVED_DAYS,
            created_at=order.updated_at,
        )
        for order in reagent_unarrived_orders
    )
    risks.extend(
        _build_consumable_order_risk_item(
            order,
            users_map,
            label="耗材长时间未收货",
            label_code="risk.consumable_order_unconfirmed",
            threshold_days=LONG_UNARRIVED_APPROVED_DAYS,
            created_at=order.updated_at,
        )
        for order in consumable_unconfirmed_orders
    )
    risks.extend(
        _build_inventory_risk_item(
            item,
            users_map,
            label="暂存超时",
            label_code="risk.pending_stockin_overdue",
            threshold_days=PENDING_STOCKIN_ALERT_DAYS,
            user_id=item.temporary_keeper_id,
            severity="medium",
            tab="stockin",
            created_at=item.created_at,
        )
        for item in pending_stockin_items
    )
    risks.extend(
        _build_inventory_risk_item(
            item,
            users_map,
            label="借用超时",
            label_code="risk.borrow_overdue",
            threshold_days=OVERDUE_BORROW_DAYS,
            user_id=item.borrower_id,
            severity="high",
            tab="borrows",
            created_at=item.updated_at,
        )
        for item in overdue_borrow_items
    )
    sorted_risks = sorted(risks, key=_risk_sort_key)
    if limit is None:
        return sorted_risks
    return sorted_risks[:limit]

def _common_shelf_item_counts_subquery(name: str):
    # 常用货架告警必须从分组表出发，瓶数为 0 的分组也需要进入统计。
    return (
        select(
            CommonShelf.cas_number.label("cas_number"),
            CommonShelf.brand_normalized.label("brand_normalized"),
            CommonShelf.specification_normalized.label("specification_normalized"),
            func.count(CommonShelf.id).label("bottle_count"),
        )
        .group_by(
            CommonShelf.cas_number,
            CommonShelf.brand_normalized,
            CommonShelf.specification_normalized,
        )
        .subquery(name)
    )


def _common_shelf_group_count_join(item_counts: Any):
    return and_(
        item_counts.c.cas_number == CommonShelfGroup.cas_number,
        item_counts.c.brand_normalized == CommonShelfGroup.brand_normalized,
        item_counts.c.specification_normalized == CommonShelfGroup.specification_normalized,
    )


def _count_common_shelf_alerts(db: Session) -> int:
    item_counts = _common_shelf_item_counts_subquery("dashboard_common_shelf_item_counts")
    bottle_count = func.coalesce(item_counts.c.bottle_count, 0)
    statement = (
        select(func.count())
        .select_from(CommonShelfGroup)
        .join(
            item_counts,
            _common_shelf_group_count_join(item_counts),
            isouter=True,
        )
        .where(CommonShelfGroup.is_deleted.is_(False))
        .where(bottle_count < COMMON_SHELF_ALERT_BOTTLE_THRESHOLD)
    )
    return _count(db, statement)


def _count_inventory_stock_alerts(db: Session) -> int:
    computed_percent = Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    remaining_percent = func.coalesce(Inventory.remaining_percent, computed_percent)
    statement = (
        select(func.count())
        .select_from(Inventory)
        .where(Inventory.status.in_([InventoryStatus.IN_STOCK, InventoryStatus.RUN_SHORT]))
        .where(Inventory.initial_quantity.is_not(None))
        .where(Inventory.initial_quantity > 0)
        .where(Inventory.remaining_quantity.is_not(None))
        .where(remaining_percent < INVENTORY_STOCK_ALERT_PERCENT)
    )
    return _count(db, statement)


def _count_stock_alert_items(db: Session) -> int:
    return _count_inventory_stock_alerts(db) + _count_common_shelf_alerts(db)


def _get_inventory_stock_alerts(
    db: Session,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    computed_percent = Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    remaining_percent = func.coalesce(Inventory.remaining_percent, computed_percent)
    statement = (
        select(Inventory, remaining_percent.label("remaining_percent"))
        .where(Inventory.status.in_([InventoryStatus.IN_STOCK, InventoryStatus.RUN_SHORT]))
        .where(Inventory.initial_quantity.is_not(None))
        .where(Inventory.initial_quantity > 0)
        .where(Inventory.remaining_quantity.is_not(None))
        .where(remaining_percent < INVENTORY_STOCK_ALERT_PERCENT)
        .order_by(remaining_percent.asc(), Inventory.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    rows = db.exec(statement).all()
    return [
        _with_dashboard_structured(
            {
                "label": "库存低量",
                "detail": _join_dashboard_detail_parts(item.name, item.cas_number),
                "alert_kind": "inventory",
                "remaining_quantity": item.remaining_quantity,
                "initial_quantity": item.initial_quantity,
                "unit": item.unit,
                "specification": format_specification(item.initial_quantity, item.unit or "") or None,
                "remaining_percent": percent,
                "severity": "high",
                "created_at": utc_iso_str(item.updated_at),
            },
            label_code="stock_alert.inventory_low",
            entity=_build_dashboard_entity(
                entity_type="inventory",
                entity_id=item.id,
                name=item.name,
                preferred_name=item.name,
                preferred_name_source="inventory",
                cas_number=item.cas_number,
                specification=format_specification(item.initial_quantity, item.unit or "") or None,
                unit=item.unit,
            ),
            metrics=_build_dashboard_metrics(
                remaining_quantity=item.remaining_quantity,
                initial_quantity=item.initial_quantity,
                remaining_percent=percent,
            ),
        )
        for item, percent in rows
    ]


def _get_common_shelf_stock_alerts(
    db: Session,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    item_counts = _common_shelf_item_counts_subquery("dashboard_common_shelf_alert_counts")
    bottle_count = func.coalesce(item_counts.c.bottle_count, 0)
    statement = (
        select(CommonShelfGroup, bottle_count.label("bottle_count"))
        .join(
            item_counts,
            _common_shelf_group_count_join(item_counts),
            isouter=True,
        )
        .where(CommonShelfGroup.is_deleted.is_(False))
        .where(bottle_count < COMMON_SHELF_ALERT_BOTTLE_THRESHOLD)
        .order_by(bottle_count.asc(), CommonShelfGroup.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    rows = db.exec(statement).all()
    cas_numbers = {group.cas_number for group, _count in rows if group.cas_number}
    name_map_rows = (
        db.exec(
            select(ChemicalNameMap.cas_number, ChemicalNameMap.name).where(
                ChemicalNameMap.cas_number.in_(cas_numbers)
            )
        ).all()
        if cas_numbers
        else []
    )
    standard_name_by_cas = {
        cas_number: name
        for cas_number, name in name_map_rows
        if cas_number and name
    }
    return [
        _with_dashboard_structured(
            {
                "label": "常用低量",
                "detail": _join_dashboard_detail_parts(
                    standard_name_by_cas.get(group.cas_number) or group.name_snapshot,
                    group.brand,
                    group.specification_text,
                ),
                "alert_kind": "common_shelf",
                "count": int(count or 0),
                "severity": "high" if int(count or 0) == 0 else "medium",
                "created_at": utc_iso_str(group.updated_at),
            },
            label_code="stock_alert.common_shelf_low",
            entity=_build_dashboard_entity(
                entity_type="common_shelf_group",
                entity_id=group.id,
                name=group.name_snapshot,
                preferred_name=standard_name_by_cas.get(group.cas_number)
                or group.name_snapshot,
                preferred_name_source=(
                    "chemical_name_map"
                    if standard_name_by_cas.get(group.cas_number)
                    else "common_shelf_snapshot"
                ),
                cas_number=group.cas_number,
                brand=group.brand,
                specification=group.specification_text,
            ),
            metrics=_build_dashboard_metrics(count=int(count or 0)),
        )
        for group, count in rows
    ]


def _get_stock_alert_items(
    db: Session,
    limit: int | None = LIST_LIMIT,
) -> list[dict[str, Any]]:
    alerts = _get_inventory_stock_alerts(db, limit) + _get_common_shelf_stock_alerts(db, limit)
    sorted_alerts = sorted(alerts, key=lambda item: item["created_at"], reverse=True)
    if limit is None:
        return sorted_alerts
    return sorted_alerts[:limit]
