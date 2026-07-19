"""Authenticated user's lightweight dashboard count snapshot."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, case, func
from sqlmodel import Session, select

from app.core.constants import OVERDUE_BORROW_DAYS
from app.core.time_utils import get_display_day_age_cutoff, get_utc_now
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.services.dashboard.common import LONG_UNARRIVED_APPROVED_DAYS

PERSONAL_REAGENT_ORDER_STATUSES = (
    ReagentOrderStatus.PENDING,
    ReagentOrderStatus.APPROVED,
    ReagentOrderStatus.REJECTED,
)
PERSONAL_CONSUMABLE_ORDER_STATUSES = (
    ConsumableOrderStatus.PENDING,
    ConsumableOrderStatus.APPROVED,
    ConsumableOrderStatus.REJECTED,
)


def _count_reagent_orders(
    db: Session,
    *,
    user_id: int,
    approved_cutoff: datetime,
) -> tuple[int, int]:
    statement = (
        select(
            func.count(ReagentOrder.id),
            func.sum(
                case(
                    (
                        and_(
                            ReagentOrder.status == ReagentOrderStatus.APPROVED,
                            ReagentOrder.updated_at < approved_cutoff,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
        )
        .select_from(ReagentOrder)
        .where(
            ReagentOrder.applicant_id == user_id,
            ReagentOrder.status.in_(PERSONAL_REAGENT_ORDER_STATUSES),
        )
    )
    total, overdue = db.exec(statement).one()
    return int(total or 0), int(overdue or 0)


def _count_consumable_orders(
    db: Session,
    *,
    user_id: int,
    approved_cutoff: datetime,
) -> tuple[int, int]:
    statement = (
        select(
            func.count(ConsumableOrder.id),
            func.sum(
                case(
                    (
                        and_(
                            ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
                            ConsumableOrder.updated_at < approved_cutoff,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
        )
        .select_from(ConsumableOrder)
        .where(
            ConsumableOrder.applicant_id == user_id,
            ConsumableOrder.status.in_(PERSONAL_CONSUMABLE_ORDER_STATUSES),
        )
    )
    total, overdue = db.exec(statement).one()
    return int(total or 0), int(overdue or 0)


def _count_borrowed_inventory(
    db: Session,
    *,
    user_id: int,
    overdue_cutoff: datetime,
) -> tuple[int, int]:
    statement = (
        select(
            func.count(Inventory.id),
            func.sum(case((Inventory.updated_at < overdue_cutoff, 1), else_=0)),
        )
        .select_from(Inventory)
        .where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.borrower_id == user_id,
        )
    )
    total, overdue = db.exec(statement).one()
    return int(total or 0), int(overdue or 0)


def _count_pending_stockin(db: Session, *, user_id: int) -> int:
    statement = (
        select(func.count(Inventory.id))
        .select_from(Inventory)
        .where(
            Inventory.storage_location.is_(None),
            Inventory.temporary_keeper_id == user_id,
        )
    )
    return int(db.exec(statement).one() or 0)


def build_personal_dashboard_summary(
    db: Session,
    *,
    user_id: int,
    now: datetime | None = None,
) -> dict[str, int]:
    """Return the seven personal card counts without materializing list rows."""

    current_time = now or get_utc_now()
    approved_cutoff = get_display_day_age_cutoff(
        LONG_UNARRIVED_APPROVED_DAYS,
        current_time,
    )
    borrow_cutoff = get_display_day_age_cutoff(OVERDUE_BORROW_DAYS, current_time)
    reagent_count, reagent_overdue_count = _count_reagent_orders(
        db,
        user_id=user_id,
        approved_cutoff=approved_cutoff,
    )
    consumable_count, consumable_overdue_count = _count_consumable_orders(
        db,
        user_id=user_id,
        approved_cutoff=approved_cutoff,
    )
    borrow_count, borrow_overdue_count = _count_borrowed_inventory(
        db,
        user_id=user_id,
        overdue_cutoff=borrow_cutoff,
    )

    return {
        "reagent_count": reagent_count,
        "reagent_arrival_overdue_count": reagent_overdue_count,
        "consumable_count": consumable_count,
        "consumable_receipt_overdue_count": consumable_overdue_count,
        "borrow_count": borrow_count,
        "borrow_overdue_count": borrow_overdue_count,
        "stockin_count": _count_pending_stockin(db, user_id=user_id),
    }
