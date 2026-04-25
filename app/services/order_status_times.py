"""Order status transition time helpers."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence

from sqlmodel import Session, select

from app.core.time_utils import utc_iso_str
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.consumable_order_operation_log import (
    ConsumableOrderOperationAction,
    ConsumableOrderOperationLog,
)
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.reagent_order_operation_log import (
    ReagentOrderOperationAction,
    ReagentOrderOperationLog,
)

OrderStatusTimes = dict[int, dict[str, datetime]]

REAGENT_ACTION_TIME_FIELDS = {
    ReagentOrderOperationAction.APPROVE: "approved_at",
    ReagentOrderOperationAction.REJECT: "rejected_at",
}
CONSUMABLE_ACTION_TIME_FIELDS = {
    ConsumableOrderOperationAction.APPROVE: "approved_at",
    ConsumableOrderOperationAction.REJECT: "rejected_at",
    ConsumableOrderOperationAction.ARRIVAL_COMPLETE: "completed_at",
}


def _order_id(order: ReagentOrder | ConsumableOrder) -> int | None:
    return order.id if order.id is not None else None


def _set_latest_time(
    status_times: OrderStatusTimes,
    *,
    order_id: int,
    field: str,
    created_at: datetime,
) -> None:
    item_times = status_times.setdefault(order_id, {})
    if field not in item_times or created_at > item_times[field]:
        item_times[field] = created_at


def _apply_reagent_current_status_fallbacks(
    status_times: OrderStatusTimes,
    orders: Sequence[ReagentOrder],
) -> None:
    for order in orders:
        order_id = _order_id(order)
        if order_id is None:
            continue

        item_times = status_times.setdefault(order_id, {})
        if order.status == ReagentOrderStatus.APPROVED:
            item_times.setdefault("approved_at", order.updated_at)
        elif order.status == ReagentOrderStatus.REJECTED:
            item_times.setdefault("rejected_at", order.updated_at)
        elif order.status == ReagentOrderStatus.ARRIVED:
            item_times.setdefault("arrived_at", order.updated_at)
        elif order.status == ReagentOrderStatus.STOCKED:
            item_times.setdefault("stocked_at", order.updated_at)


def _apply_consumable_current_status_fallbacks(
    status_times: OrderStatusTimes,
    orders: Sequence[ConsumableOrder],
) -> None:
    for order in orders:
        order_id = _order_id(order)
        if order_id is None:
            continue

        item_times = status_times.setdefault(order_id, {})
        if order.status == ConsumableOrderStatus.APPROVED:
            item_times.setdefault("approved_at", order.updated_at)
        elif order.status == ConsumableOrderStatus.REJECTED:
            item_times.setdefault("rejected_at", order.updated_at)
        elif order.status == ConsumableOrderStatus.COMPLETED:
            item_times.setdefault("completed_at", order.updated_at)


def get_reagent_order_status_times(
    db: Session,
    orders: Sequence[ReagentOrder],
) -> OrderStatusTimes:
    """Return known reagent order status transition times keyed by order id."""

    order_ids = [order_id for order in orders if (order_id := _order_id(order)) is not None]
    status_times: OrderStatusTimes = {order_id: {} for order_id in order_ids}
    if not order_ids:
        return status_times

    logs = db.exec(
        select(ReagentOrderOperationLog).where(
            ReagentOrderOperationLog.order_id.in_(order_ids),
            ReagentOrderOperationLog.action.in_(tuple(REAGENT_ACTION_TIME_FIELDS)),
        )
    ).all()
    for log in logs:
        field = REAGENT_ACTION_TIME_FIELDS.get(log.action)
        if field:
            _set_latest_time(
                status_times,
                order_id=log.order_id,
                field=field,
                created_at=log.created_at,
            )

    _apply_reagent_current_status_fallbacks(status_times, orders)
    return status_times


def get_consumable_order_status_times(
    db: Session,
    orders: Sequence[ConsumableOrder],
) -> OrderStatusTimes:
    """Return known consumable order status transition times keyed by order id."""

    order_ids = [order_id for order in orders if (order_id := _order_id(order)) is not None]
    status_times: OrderStatusTimes = {order_id: {} for order_id in order_ids}
    if not order_ids:
        return status_times

    logs = db.exec(
        select(ConsumableOrderOperationLog).where(
            ConsumableOrderOperationLog.order_id.in_(order_ids),
            ConsumableOrderOperationLog.action.in_(tuple(CONSUMABLE_ACTION_TIME_FIELDS)),
        )
    ).all()
    for log in logs:
        field = CONSUMABLE_ACTION_TIME_FIELDS.get(log.action)
        if field:
            _set_latest_time(
                status_times,
                order_id=log.order_id,
                field=field,
                created_at=log.created_at,
            )

    _apply_consumable_current_status_fallbacks(status_times, orders)
    return status_times


def get_order_status_time_fields(
    status_times: OrderStatusTimes,
    order: ReagentOrder | ConsumableOrder,
) -> dict[str, Any]:
    order_id = _order_id(order)
    if order_id is None:
        return {}
    return {
        field: utc_iso_str(value)
        for field, value in status_times.get(order_id, {}).items()
    }
