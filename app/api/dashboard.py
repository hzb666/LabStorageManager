"""Administrator dashboard aggregate routes."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.core.auth import require_admin
from app.core.time_utils import get_utc_now, utc_iso_str
from app.database import DBSession
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.common_shelf_operation_log import (
    CommonShelfOperationAction,
    CommonShelfOperationLog,
)
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(require_admin)],
)

RECENT_WINDOW_DAYS = 7
COMMON_SHELF_ALERT_BOTTLE_THRESHOLD = 1


def _count(db: Session, statement) -> int:
    return int(db.exec(statement).one() or 0)


def _active_reagent_order_clause(cutoff):
    return or_(
        ReagentOrder.status.in_(
            [ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED]
        ),
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


def _count_common_shelf_alerts(db: Session) -> int:
    item_counts = (
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
        .subquery("dashboard_common_shelf_item_counts")
    )
    statement = (
        select(func.count())
        .select_from(CommonShelfGroup)
        .join(
            item_counts,
            and_(
                item_counts.c.cas_number == CommonShelfGroup.cas_number,
                item_counts.c.brand_normalized == CommonShelfGroup.brand_normalized,
                item_counts.c.specification_normalized
                == CommonShelfGroup.specification_normalized,
            ),
            isouter=True,
        )
        .where(CommonShelfGroup.is_deleted.is_(False))
        .where(
            func.coalesce(item_counts.c.bottle_count, 0)
            <= COMMON_SHELF_ALERT_BOTTLE_THRESHOLD
        )
    )
    return _count(db, statement)


def _count_stock_in_activity(db: Session, cutoff) -> int:
    inventory_count = _count(
        db,
        select(func.count())
        .select_from(InventoryOperationLog)
        .where(InventoryOperationLog.action == InventoryOperationAction.STOCK_IN)
        .where(InventoryOperationLog.created_at >= cutoff),
    )
    common_shelf_count = _count(
        db,
        select(func.count())
        .select_from(CommonShelfOperationLog)
        .where(CommonShelfOperationLog.action == CommonShelfOperationAction.STOCK_IN)
        .where(CommonShelfOperationLog.created_at >= cutoff),
    )
    return inventory_count + common_shelf_count


@router.get("/admin/summary")
def get_admin_dashboard_summary(db: DBSession) -> dict[str, Any]:
    """Return high-level administrator dashboard counts."""

    now = get_utc_now()
    cutoff = now - timedelta(days=RECENT_WINDOW_DAYS)
    reagent_order_count = _count(
        db,
        select(func.count())
        .select_from(ReagentOrder)
        .where(_active_reagent_order_clause(cutoff)),
    )
    consumable_order_count = _count(
        db,
        select(func.count())
        .select_from(ConsumableOrder)
        .where(_active_consumable_order_clause(cutoff)),
    )
    borrowed_inventory_count = _count(
        db,
        select(func.count())
        .select_from(Inventory)
        .where(Inventory.status == InventoryStatus.BORROWED),
    )
    pending_stockin_count = _count(
        db,
        select(func.count())
        .select_from(Inventory)
        .where(Inventory.storage_location.is_(None))
        .where(Inventory.temporary_keeper_id.is_not(None)),
    )
    recent_arrival_count = _count(
        db,
        select(func.count())
        .select_from(ReagentOrder)
        .where(ReagentOrder.status == ReagentOrderStatus.ARRIVED)
        .where(ReagentOrder.updated_at >= cutoff),
    )

    return {
        "data": {
            "reagent_order_count": reagent_order_count,
            "consumable_order_count": consumable_order_count,
            "borrowed_inventory_count": borrowed_inventory_count,
            "pending_stockin_count": pending_stockin_count,
            "common_stock_alert_count": _count_common_shelf_alerts(db),
            "recent_arrival_count": recent_arrival_count,
            "stock_in_activity_count": _count_stock_in_activity(db, cutoff),
            "recent_window_days": RECENT_WINDOW_DAYS,
            "generated_at": utc_iso_str(now),
        }
    }
