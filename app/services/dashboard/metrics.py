"""Dashboard counters and recent-window metrics."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.core.constants import OVERDUE_BORROW_DAYS
from app.core.time_utils import get_display_day_age_cutoff
from app.models.common_shelf import CommonShelf
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import BorrowLog, Inventory, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.services.dashboard.common import (
    LONG_PENDING_DAYS,
    LONG_UNARRIVED_APPROVED_DAYS,
    PENDING_STOCKIN_ALERT_DAYS,
    TODO_PENDING_ALERT_DAYS,
    _count_model_rows,
)


def _active_reagent_order_clause(cutoff):
    return or_(
        ReagentOrder.status.in_([ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED]),
        and_(
            ReagentOrder.status == ReagentOrderStatus.REJECTED,
            ReagentOrder.updated_at >= cutoff,
        ),
    )


def _active_consumable_order_clause(cutoff):
    return or_(
        ConsumableOrder.status.in_(
            [ConsumableOrderStatus.PENDING, ConsumableOrderStatus.APPROVED]
        ),
        and_(
            ConsumableOrder.status == ConsumableOrderStatus.REJECTED,
            ConsumableOrder.updated_at >= cutoff,
        ),
    )


def _count_stock_in_activity(db: Session, cutoff: datetime | None) -> int:
    conditions = (Inventory.created_at >= cutoff,) if cutoff is not None else ()
    inventory_count = _count_model_rows(
        db,
        Inventory,
        *conditions,
    )
    conditions = (CommonShelf.created_at >= cutoff,) if cutoff is not None else ()
    common_shelf_count = _count_model_rows(
        db,
        CommonShelf,
        *conditions,
    )
    return inventory_count + common_shelf_count


def _count_reagent_order_delta(db: Session, since: datetime) -> int:
    created_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.created_at >= since,
    )
    resolved_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status.in_([ReagentOrderStatus.ARRIVED, ReagentOrderStatus.STOCKED]),
        ReagentOrder.updated_at >= since,
    )
    return created_count - resolved_count


def _count_consumable_order_delta(db: Session, since: datetime) -> int:
    created_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.created_at >= since,
    )
    completed_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.COMPLETED,
        ConsumableOrder.updated_at >= since,
    )
    return created_count - completed_count


def _count_borrowed_inventory_delta(db: Session, since: datetime) -> int:
    borrowed_count = _count_model_rows(
        db,
        Inventory,
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.updated_at >= since,
    )
    returned_count = _count_model_rows(
        db,
        BorrowLog,
        BorrowLog.return_time.is_not(None),
        BorrowLog.return_time >= since,
    )
    return borrowed_count - returned_count


def _count_pending_stockin_delta(db: Session, since: datetime) -> int:
    created_pending_count = _count_model_rows(
        db,
        Inventory,
        Inventory.storage_location.is_(None),
        Inventory.temporary_keeper_id.is_not(None),
        Inventory.created_at >= since,
    )
    completed_stockin_count = _count_model_rows(
        db,
        InventoryOperationLog,
        InventoryOperationLog.action == InventoryOperationAction.STOCK_IN,
        InventoryOperationLog.created_at >= since,
    )
    return created_pending_count - completed_stockin_count


def _sum_order_total_value(db: Session, cutoff: datetime | None = None) -> float:
    statement = select(
        func.coalesce(func.sum(ReagentOrder.quantity * ReagentOrder.price), 0)
    )
    if cutoff is not None:
        statement = statement.where(ReagentOrder.created_at >= cutoff)
    reagent_total = db.exec(statement).one()
    return float(reagent_total or 0)


def _build_recent_window_stats(
    db: Session,
    *,
    cutoff: datetime | None,
    window_days: int,
    is_all_time: bool = False,
) -> dict[str, Any]:
    reagent_arrival_conditions = [ReagentOrder.status == ReagentOrderStatus.ARRIVED]
    reagent_order_conditions: list[Any] = []
    consumable_order_conditions: list[Any] = []
    if cutoff is not None:
        reagent_arrival_conditions.append(ReagentOrder.updated_at >= cutoff)
        reagent_order_conditions.append(ReagentOrder.created_at >= cutoff)
        consumable_order_conditions.append(ConsumableOrder.created_at >= cutoff)

    return {
        "recent_window_days": window_days,
        "is_all_time": is_all_time,
        "recent_arrival_count": _count_model_rows(
            db,
            ReagentOrder,
            *reagent_arrival_conditions,
        ),
        "recent_reagent_order_count": _count_model_rows(
            db,
            ReagentOrder,
            *reagent_order_conditions,
        ),
        "recent_consumable_order_count": _count_model_rows(
            db,
            ConsumableOrder,
            *consumable_order_conditions,
        ),
        "stock_in_activity_count": _count_stock_in_activity(db, cutoff),
        "order_total_value": _sum_order_total_value(db, cutoff),
    }


def _count_pending_reagent_orders_overdue(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(TODO_PENDING_ALERT_DAYS, now)
    return _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
        ReagentOrder.updated_at < cutoff,
    )


def _count_pending_consumable_orders_overdue(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(TODO_PENDING_ALERT_DAYS, now)
    return _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
        ConsumableOrder.updated_at < cutoff,
    )


def _count_todo_items(db: Session) -> int:
    return _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
    ) + _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
    )

def _count_overdue_borrows(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(OVERDUE_BORROW_DAYS, now)
    return _count_model_rows(
        db,
        Inventory,
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.updated_at < cutoff,
    )


def _count_long_pending_reagent_orders(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(LONG_PENDING_DAYS, now)
    return _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
        ReagentOrder.updated_at < cutoff,
    )


def _count_long_pending_consumable_orders(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(LONG_PENDING_DAYS, now)
    return _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
        ConsumableOrder.updated_at < cutoff,
    )


def _count_long_pending_orders(db: Session, now: datetime) -> int:
    return _count_long_pending_reagent_orders(
        db,
        now,
    ) + _count_long_pending_consumable_orders(db, now)


def _count_pending_stockins_overdue(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(PENDING_STOCKIN_ALERT_DAYS, now)
    return _count_model_rows(
        db,
        Inventory,
        Inventory.storage_location.is_(None),
        Inventory.temporary_keeper_id.is_not(None),
        Inventory.created_at < cutoff,
    )


def _count_long_unarrived_approved_reagent_orders(db: Session, now: datetime) -> int:
    cutoff = get_display_day_age_cutoff(LONG_UNARRIVED_APPROVED_DAYS, now)
    return _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.APPROVED,
        ReagentOrder.updated_at < cutoff,
    )


def _count_long_unconfirmed_approved_consumable_orders(
    db: Session,
    now: datetime,
) -> int:
    cutoff = get_display_day_age_cutoff(LONG_UNARRIVED_APPROVED_DAYS, now)
    return _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
        ConsumableOrder.updated_at < cutoff,
    )


def _count_risk_items(db: Session, now: datetime) -> int:
    return (
        _count_long_pending_reagent_orders(db, now)
        + _count_long_pending_consumable_orders(db, now)
        + _count_long_unarrived_approved_reagent_orders(db, now)
        + _count_long_unconfirmed_approved_consumable_orders(db, now)
        + _count_pending_stockins_overdue(db, now)
        + _count_overdue_borrows(db, now)
    )
