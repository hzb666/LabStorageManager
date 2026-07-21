"""Dashboard panel item builders."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.core.constants import LOW_STOCK_PERCENT, OVERDUE_BORROW_DAYS
from app.core.time_utils import get_display_day_age_cutoff, utc_iso_str
from app.models.chemical_name_map import ChemicalNameMap
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.user import User
from app.models.user_operation_log import UserOperationAction, UserOperationLog
from app.models.user_session import UserSession
from app.services.dashboard.common import (
    COMMON_SHELF_ALERT_BOTTLE_THRESHOLD,
    LIST_LIMIT,
    LONG_PENDING_DAYS,
    LONG_UNARRIVED_APPROVED_DAYS,
    PENDING_STOCKIN_ALERT_DAYS,
    TODO_PENDING_ALERT_DAYS,
    _board_panel_item,
    _build_dashboard_codes,
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
from app.services.log_timeline_renderer import render_log_timeline_rows
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names


def _get_timeline_operator_id(row: LogTimeline) -> int | None:
    return row.actor_user_id or row.subject_user_id


def _build_recent_management_action(
    row: LogTimeline,
    rendered: dict[str, object],
    users_map: dict[int, str],
) -> dict[str, Any]:
    operator_id = _get_timeline_operator_id(row)
    operator_name = users_map.get(operator_id) or "系统"
    category = _get_management_action_category(row, rendered)
    return {
        "detail": str(rendered.get("detail") or ""),
        "submitter_name": operator_name,
        "created_at": rendered.get("time"),
        "codes": _build_dashboard_codes(
            label_code=f"operation_category.{category}",
        ),
        "entity": _build_dashboard_entity(
            entity_type="operation_log",
            entity_id=row.id,
            actor_name=operator_name,
        ),
    }


MANAGEMENT_ACTION_CATEGORY_BY_SOURCE: dict[LogTimelineSourceTable, str] = {
    LogTimelineSourceTable.INVENTORY_OPERATION_LOG: "inventory",
    LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG: "reagent_order",
    LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG: "consumable_order",
    LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG: "common_shelf",
    LogTimelineSourceTable.BORROWLOG: "borrow",
}


def _get_management_action_category(
    row: LogTimeline,
    rendered: dict[str, object],
) -> str:
    if row.source_table == LogTimelineSourceTable.USER_OPERATION_LOG:
        return str(rendered.get("type") or "other")
    return MANAGEMENT_ACTION_CATEGORY_BY_SOURCE.get(row.source_table, "other")


def _build_management_action_filter():
    excluded_user_log_ids = select(UserOperationLog.id).where(
        UserOperationLog.action.in_(
            (UserOperationAction.LOGIN, UserOperationAction.LOGOUT)
        )
    )
    return or_(
        LogTimeline.source_table != LogTimelineSourceTable.USER_OPERATION_LOG.value,
        ~LogTimeline.source_log_id.in_(excluded_user_log_ids),
    )


def _count_recent_management_actions(db: Session) -> int:
    return _count(
        db,
        select(func.count()).select_from(LogTimeline).where(_build_management_action_filter()),
    )


def _get_recent_management_actions(
    db: Session,
    *,
    skip: int = 0,
    limit: int = LIST_LIMIT,
) -> list[dict[str, Any]]:
    rows = db.exec(
        select(LogTimeline)
        .where(_build_management_action_filter())
        .order_by(LogTimeline.occurred_at.desc(), LogTimeline.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    users_map = batch_get_user_names(
        db,
        {
            operator_id
            for row in rows
            if (operator_id := _get_timeline_operator_id(row)) is not None
        },
    )
    rendered_rows = render_log_timeline_rows(db, rows, user_id=0)
    return [
        _build_recent_management_action(row, rendered, users_map)
        for row, rendered in rendered_rows
    ]

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
        .order_by(ReagentOrder.updated_at.desc())
    )
    if limit is not None:
        reagent_statement = reagent_statement.limit(limit)
    reagent_orders = db.exec(reagent_statement).all()
    consumable_statement = (
        select(ConsumableOrder)
        .where(ConsumableOrder.status == ConsumableOrderStatus.PENDING)
        .order_by(ConsumableOrder.updated_at.desc())
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
                "detail": f"{order.name} · {order.cas_number}",
                "submitter_name": users_map.get(order.applicant_id) or "-",
                "tab": "reagents",
                "severity": "high" if order.updated_at < overdue_cutoff else "medium",
                "is_overdue": order.updated_at < overdue_cutoff,
                "created_at": utc_iso_str(order.updated_at),
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
                "detail": f"{order.name} · {order.specification or order.unit or '-'}",
                "submitter_name": users_map.get(order.applicant_id) or "-",
                "tab": "consumables",
                "severity": "high" if order.updated_at < overdue_cutoff else "medium",
                "is_overdue": order.updated_at < overdue_cutoff,
                "created_at": utc_iso_str(order.updated_at),
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
    value: int,
    tone: str,
    *,
    label_code: str,
) -> dict[str, Any]:
    return _with_dashboard_structured(
        {
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
            active_user_count,
            "neutral",
            label_code="system_status.active_users",
        ),
        _build_system_status_item(
            active_session_count,
            "success" if active_session_count > 0 else "neutral",
            label_code="system_status.active_sessions",
        ),
        _build_system_status_item(
            recent_active_user_count,
            "success" if recent_active_user_count > 0 else "neutral",
            label_code="system_status.active_users_today",
        ),
    ]


def _build_system_status(
    *,
    db: Session,
    now: datetime,
) -> list[dict[str, Any]]:
    return _build_user_activity_system_status(db, now)

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
    label_code: str,
    threshold_days: int,
    created_at: datetime,
) -> dict[str, Any]:
    specification = format_specification(order.initial_quantity, order.unit) or "-"
    return _with_dashboard_structured(
        {
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
    label_code: str,
    threshold_days: int,
    created_at: datetime,
) -> dict[str, Any]:
    specification = order.specification or order.unit or "-"
    return _with_dashboard_structured(
        {
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
            ReagentOrder.updated_at < long_pending_cutoff,
        )
        .order_by(ReagentOrder.updated_at.desc()),
        limit,
    )
    consumable_pending_orders = _exec_dashboard_limited(
        db,
        select(ConsumableOrder)
        .where(
            ConsumableOrder.status == ConsumableOrderStatus.PENDING,
            ConsumableOrder.updated_at < long_pending_cutoff,
        )
        .order_by(ConsumableOrder.updated_at.desc()),
        limit,
    )
    reagent_unarrived_orders = _exec_dashboard_limited(
        db,
        select(ReagentOrder)
        .where(
            ReagentOrder.status == ReagentOrderStatus.APPROVED,
            ReagentOrder.updated_at < long_unarrived_cutoff,
        )
        .order_by(ReagentOrder.updated_at.desc()),
        limit,
    )
    consumable_unconfirmed_orders = _exec_dashboard_limited(
        db,
        select(ConsumableOrder)
        .where(
            ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
            ConsumableOrder.updated_at < long_unarrived_cutoff,
        )
        .order_by(ConsumableOrder.updated_at.desc()),
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
        .order_by(Inventory.created_at.desc()),
        limit,
    )
    overdue_borrow_items = _exec_dashboard_limited(
        db,
        select(Inventory)
        .where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.updated_at < overdue_borrow_cutoff,
        )
        .order_by(Inventory.updated_at.desc()),
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
            label_code="risk.reagent_order_approval_timeout",
            threshold_days=LONG_PENDING_DAYS,
            created_at=order.updated_at,
        )
        for order in reagent_pending_orders
    ]
    risks.extend(
        _build_consumable_order_risk_item(
            order,
            users_map,
            label_code="risk.consumable_order_approval_timeout",
            threshold_days=LONG_PENDING_DAYS,
            created_at=order.updated_at,
        )
        for order in consumable_pending_orders
    )
    risks.extend(
        _build_reagent_order_risk_item(
            order,
            users_map,
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
            label_code="risk.borrow_overdue",
            threshold_days=OVERDUE_BORROW_DAYS,
            user_id=item.borrower_id,
            severity="high",
            tab="borrows",
            created_at=item.updated_at,
        )
        for item in overdue_borrow_items
    )
    sorted_risks = sorted(risks, key=lambda item: item.get("created_at") or "", reverse=True)
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
        .where(remaining_percent < LOW_STOCK_PERCENT)
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
        .where(remaining_percent < LOW_STOCK_PERCENT)
        .order_by(remaining_percent.asc(), Inventory.updated_at.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    rows = db.exec(statement).all()
    return [
        _with_dashboard_structured(
            {
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
