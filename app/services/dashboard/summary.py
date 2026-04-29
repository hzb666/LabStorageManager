"""Dashboard summary builders and section dispatchers."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from app.core.config import settings
from app.core.time_utils import get_utc_now, utc_iso_str
from app.models.announcement import Announcement
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.user import User
from app.services.dashboard.common import (
    ADMIN_SECTION_RISKS,
    ADMIN_SECTION_TODOS,
    BOARD_SECTION_ACTIONS,
    BOARD_SECTION_ORDERS,
    LIST_LIMIT,
    RECENT_WINDOW_DAYS,
    _board_panel_item,
    _build_dashboard_entity,
    _count_model_rows,
    _get_dashboard_section_page,
)
from app.services.dashboard.items import (
    _build_system_status,
    _build_user_order_overview_items,
    _count_common_shelf_alerts,
    _count_stock_alert_items,
    _count_user_board_action_items,
    _count_user_order_overview_items,
    _get_recent_management_actions,
    _get_risk_items,
    _get_stock_alert_items,
    _get_todo_items,
    _get_user_board_action_items,
)
from app.services.dashboard.metrics import (
    _active_consumable_order_clause,
    _active_reagent_order_clause,
    _build_recent_window_stats,
    _count_borrowed_inventory_delta,
    _count_consumable_order_delta,
    _count_long_pending_consumable_orders,
    _count_long_pending_reagent_orders,
    _count_long_unarrived_approved_reagent_orders,
    _count_long_unconfirmed_approved_consumable_orders,
    _count_overdue_borrows,
    _count_pending_consumable_orders_overdue,
    _count_pending_reagent_orders_overdue,
    _count_pending_stockin_delta,
    _count_pending_stockins_overdue,
    _count_reagent_order_delta,
    _count_risk_items,
    _count_todo_items,
)
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names

def _get_admin_section_total(
    db: Session,
    section: str,
    now: datetime,
) -> int:
    if section == ADMIN_SECTION_TODOS:
        return _count_todo_items(db)
    if section == ADMIN_SECTION_RISKS:
        return _count_risk_items(db, now)
    return _count_stock_alert_items(db)


def _get_admin_section_items(
    db: Session,
    section: str,
    now: datetime,
    *,
    skip: int,
    limit: int,
) -> list[dict[str, Any]]:
    if section == ADMIN_SECTION_TODOS:
        return _get_dashboard_section_page(
            lambda fetch_limit: _get_todo_items(db, now, limit=fetch_limit),
            skip=skip,
            limit=limit,
        )
    if section == ADMIN_SECTION_RISKS:
        return _get_dashboard_section_page(
            lambda fetch_limit: _get_risk_items(db, now, limit=fetch_limit),
            skip=skip,
            limit=limit,
        )
    return _get_dashboard_section_page(
        lambda fetch_limit: _get_stock_alert_items(db, limit=fetch_limit),
        skip=skip,
        limit=limit,
    )


def build_dashboard_window_stats(
    db: Session,
    *,
    window_days: int,
    all_time: bool,
) -> dict[str, Any]:
    now = get_utc_now()
    cutoff = None if all_time else now - timedelta(days=window_days)
    return {
        "data": _build_recent_window_stats(
            db,
            cutoff=cutoff,
            window_days=window_days,
            is_all_time=all_time,
        )
    }


def build_admin_dashboard_summary(db: Session) -> dict[str, Any]:
    now = get_utc_now()
    cutoff = now - timedelta(days=RECENT_WINDOW_DAYS)
    yesterday_cutoff = now - timedelta(days=1)
    pending_reagent_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
    )
    pending_consumable_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
    )
    approved_reagent_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.APPROVED,
    )
    reagent_order_count = _count_model_rows(
        db,
        ReagentOrder,
        _active_reagent_order_clause(cutoff),
    )
    consumable_order_count = _count_model_rows(
        db,
        ConsumableOrder,
        _active_consumable_order_clause(cutoff),
    )
    borrowed_inventory_count = _count_model_rows(
        db,
        Inventory,
        Inventory.status == InventoryStatus.BORROWED,
    )
    pending_stockin_count = _count_model_rows(
        db,
        Inventory,
        Inventory.storage_location.is_(None),
        Inventory.temporary_keeper_id.is_not(None),
    )
    recent_window_stats = _build_recent_window_stats(
        db,
        cutoff=cutoff,
        window_days=RECENT_WINDOW_DAYS,
    )
    stock_alert_item_count = _count_stock_alert_items(db)
    stock_alert_items = _get_stock_alert_items(db)
    overdue_borrow_count = _count_overdue_borrows(db, now)
    long_pending_reagent_order_count = _count_long_pending_reagent_orders(db, now)
    long_pending_consumable_order_count = _count_long_pending_consumable_orders(
        db,
        now,
    )
    pending_reagent_overdue_count = _count_pending_reagent_orders_overdue(db, now)
    pending_consumable_overdue_count = _count_pending_consumable_orders_overdue(
        db,
        now,
    )
    pending_stockin_overdue_count = _count_pending_stockins_overdue(db, now)
    long_unarrived_approved_reagent_count = _count_long_unarrived_approved_reagent_orders(
        db, now
    )
    long_unconfirmed_approved_consumable_count = (
        _count_long_unconfirmed_approved_consumable_orders(db, now)
    )
    risk_item_count = (
        long_pending_reagent_order_count
        + long_pending_consumable_order_count
        + long_unarrived_approved_reagent_count
        + long_unconfirmed_approved_consumable_count
        + pending_stockin_overdue_count
        + overdue_borrow_count
    )
    return {
        "data": {
            "reagent_order_count": reagent_order_count,
            "consumable_order_count": consumable_order_count,
            "borrowed_inventory_count": borrowed_inventory_count,
            "pending_stockin_count": pending_stockin_count,
            "reagent_order_delta": _count_reagent_order_delta(db, yesterday_cutoff),
            "consumable_order_delta": _count_consumable_order_delta(
                db, yesterday_cutoff
            ),
            "borrowed_inventory_delta": _count_borrowed_inventory_delta(
                db, yesterday_cutoff
            ),
            "pending_stockin_delta": _count_pending_stockin_delta(
                db, yesterday_cutoff
            ),
            "pending_reagent_count": pending_reagent_count,
            "pending_consumable_count": pending_consumable_count,
            "approved_reagent_count": approved_reagent_count,
            "overdue_borrow_count": overdue_borrow_count,
            "pending_reagent_overdue_count": pending_reagent_overdue_count,
            "pending_consumable_overdue_count": pending_consumable_overdue_count,
            "pending_stockin_overdue_count": pending_stockin_overdue_count,
            "long_unarrived_approved_reagent_count": long_unarrived_approved_reagent_count,
            "long_unconfirmed_approved_consumable_count": (
                long_unconfirmed_approved_consumable_count
            ),
            "common_stock_alert_count": _count_common_shelf_alerts(db),
            **recent_window_stats,
            "todo_items": _get_todo_items(db, now),
            "risk_items": _get_risk_items(db, now),
            "recent_actions": _get_recent_management_actions(db),
            "stock_alert_items": stock_alert_items,
            "item_counts": {
                "todo_items": pending_reagent_count + pending_consumable_count,
                "risk_items": risk_item_count,
                "stock_alert_items": stock_alert_item_count,
            },
            "system_status": _build_system_status(
                db=db,
                now=now,
            ),
            "system_version": settings.app_version,
            "generated_at": utc_iso_str(now),
        }
    }

def _get_recent_completed_consumable_orders(db: Session) -> list[ConsumableOrder]:
    return db.exec(
        select(ConsumableOrder)
        .where(ConsumableOrder.status == ConsumableOrderStatus.COMPLETED)
        .order_by(ConsumableOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_board_recent_items(db: Session) -> list[dict[str, Any]]:
    arrived_orders = db.exec(
        select(ReagentOrder)
        .where(ReagentOrder.status == ReagentOrderStatus.ARRIVED)
        .order_by(ReagentOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    completed_consumable_orders = _get_recent_completed_consumable_orders(db)
    stocked_items = db.exec(
        select(Inventory)
        .where(
            Inventory.source_order_id.is_not(None),
            Inventory.storage_location.is_not(None),
            Inventory.status.in_([InventoryStatus.IN_STOCK, InventoryStatus.RUN_SHORT]),
        )
        .order_by(Inventory.created_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    items = [
        _board_panel_item(
            order.name,
            tab="reagents",
            created_at=order.updated_at,
            label_code="board.recent.reagent_order_arrived",
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
        for order in arrived_orders
    ]
    items.extend(
        _board_panel_item(
            order.name,
            tab="consumables",
            created_at=order.updated_at,
            label_code="board.recent.consumable_order_completed",
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
        for order in completed_consumable_orders
    )
    items.extend(
        _board_panel_item(
            item.name,
            tab="stockin",
            created_at=item.created_at,
            label_code="board.recent.inventory_stocked",
            entity=_build_dashboard_entity(
                entity_type="inventory",
                entity_id=item.id,
                name=item.name,
                preferred_name=item.name,
                preferred_name_source="inventory",
                cas_number=item.cas_number,
                specification=format_specification(item.initial_quantity, item.unit) or None,
                unit=item.unit,
            ),
        )
        for item in stocked_items
    )
    return sorted(items, key=lambda item: item["created_at"] or "", reverse=True)[:LIST_LIMIT]


def _get_board_announcement_items(db: Session) -> list[dict[str, Any]]:
    announcements = db.exec(
        select(Announcement)
        .where(Announcement.is_visible.is_(True))
        .order_by(Announcement.is_pinned.desc(), Announcement.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    creator_ids = {item.created_by for item in announcements if item.created_by}
    users_map = batch_get_user_names(db, creator_ids)
    return [
        _board_panel_item(
            announcement.title,
            impact="置顶" if announcement.is_pinned else "公告",
            severity="medium" if announcement.is_pinned else "success",
            submitter_name=users_map.get(announcement.created_by)
            if announcement.created_by
            else None,
            created_at=announcement.updated_at,
            label_code="board.announcement",
            impact_code="announcement.pinned" if announcement.is_pinned else "announcement.normal",
            entity=_build_dashboard_entity(
                entity_type="announcement",
                entity_id=announcement.id,
                name=announcement.title,
                preferred_name=announcement.title,
                preferred_name_source="announcement",
            ),
        )
        for announcement in announcements
    ]


def _get_board_summary_item_counts(
    db: Session,
    current_user: User,
    now: datetime,
) -> dict[str, int]:
    return {
        "action_items": _count_user_board_action_items(db, current_user.id, now),
        "order_overview_items": _count_user_order_overview_items(db, current_user.id),
        "stock_alert_items": _count_stock_alert_items(db),
    }


def _get_empty_board_summary_item_counts() -> dict[str, int]:
    return {
        "action_items": 0,
        "order_overview_items": 0,
        "stock_alert_items": 0,
    }


def _build_public_board_summary_data(db: Session, now: datetime) -> dict[str, Any]:
    return {
        "action_items": [],
        "order_overview_items": [],
        "recent_items": [],
        "stock_alert_items": [],
        "announcement_items": _get_board_announcement_items(db),
        "system_status": [],
        "item_counts": _get_empty_board_summary_item_counts(),
        "recent_window_days": RECENT_WINDOW_DAYS,
        "system_version": settings.app_version,
        "generated_at": utc_iso_str(now),
    }


def _build_user_board_summary_data(
    db: Session,
    current_user: User,
    now: datetime,
) -> dict[str, Any]:
    return {
        "action_items": _get_user_board_action_items(db, current_user, now),
        "order_overview_items": _build_user_order_overview_items(
            db,
            current_user,
        ),
        "recent_items": _get_board_recent_items(db),
        "stock_alert_items": _get_stock_alert_items(db),
        "announcement_items": _get_board_announcement_items(db),
        "system_status": [],
        "item_counts": _get_board_summary_item_counts(db, current_user, now),
        "recent_window_days": RECENT_WINDOW_DAYS,
        "system_version": settings.app_version,
        "generated_at": utc_iso_str(now),
    }


def _get_board_section_total(
    db: Session,
    section: str,
    current_user: User,
    now: datetime,
) -> int:
    if section == BOARD_SECTION_ACTIONS:
        return _count_user_board_action_items(db, current_user.id, now)
    if section == BOARD_SECTION_ORDERS:
        return _count_user_order_overview_items(db, current_user.id)
    return _count_stock_alert_items(db)


def _get_board_section_items(
    db: Session,
    section: str,
    current_user: User,
    now: datetime,
    *,
    skip: int,
    limit: int,
) -> list[dict[str, Any]]:
    if section == BOARD_SECTION_ACTIONS:
        return _get_dashboard_section_page(
            lambda fetch_limit: _get_user_board_action_items(
                db,
                current_user,
                now,
                limit=fetch_limit,
            ),
            skip=skip,
            limit=limit,
        )
    if section == BOARD_SECTION_ORDERS:
        return _get_dashboard_section_page(
            lambda fetch_limit: _build_user_order_overview_items(
                db,
                current_user,
                limit=fetch_limit,
            ),
            skip=skip,
            limit=limit,
        )
    return _get_dashboard_section_page(
        lambda fetch_limit: _get_stock_alert_items(db, limit=fetch_limit),
        skip=skip,
        limit=limit,
    )
