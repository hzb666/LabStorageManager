"""Administrator dashboard aggregate routes."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.core.constants import OVERDUE_BORROW_DAYS
from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.core.time_utils import get_utc_now, utc_iso_str
from app.database import DBSession
from app.models.chemical_name_map import ChemicalNameMap
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.common_shelf_operation_log import (
    CommonShelfOperationAction,
    CommonShelfOperationLog,
)
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.consumable_order_operation_log import (
    ConsumableOrderOperationAction,
    ConsumableOrderOperationLog,
)
from app.models.inventory import BorrowLog, Inventory, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.announcement import Announcement
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.reagent_order_operation_log import (
    ReagentOrderOperationAction,
    ReagentOrderOperationLog,
)
from app.models.user import User
from app.models.user_session import UserSession
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
)

RECENT_WINDOW_DAYS = 7
DASHBOARD_WINDOW_MIN_DAYS = 3
DASHBOARD_WINDOW_MAX_DAYS = 365
COMMON_SHELF_ALERT_BOTTLE_THRESHOLD = 3
INVENTORY_STOCK_ALERT_PERCENT = 0.10
LONG_PENDING_DAYS = 1
TODO_PENDING_ALERT_DAYS = 2
LONG_UNARRIVED_APPROVED_DAYS = 3
PENDING_STOCKIN_ALERT_DAYS = 7
LIST_LIMIT = 5
BOARD_ORDER_OVERVIEW_REAGENT_STATUSES = (
    ReagentOrderStatus.PENDING,
    ReagentOrderStatus.APPROVED,
    ReagentOrderStatus.REJECTED,
)
BOARD_ORDER_OVERVIEW_CONSUMABLE_STATUSES = (
    ConsumableOrderStatus.PENDING,
    ConsumableOrderStatus.APPROVED,
    ConsumableOrderStatus.REJECTED,
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

DashboardSeverity = Literal["high", "medium", "low", "neutral", "success", "warning"]
DashboardTone = Literal["neutral", "success", "warning", "high"]
DashboardTab = Literal["reagents", "consumables", "borrows", "stockin"]
DashboardAlertKind = Literal["inventory", "common_shelf"]


class DashboardPanelCodes(BaseModel):
    label_code: str | None = None
    impact_code: str | None = None


class DashboardPanelEntity(BaseModel):
    entity_type: str | None = None
    entity_id: int | str | None = None
    name: str | None = None
    preferred_name: str | None = None
    preferred_name_source: str | None = None
    cas_number: str | None = None
    brand: str | None = None
    specification: str | None = None
    quantity: float | int | None = None
    unit: str | None = None
    actor_name: str | None = None


class DashboardPanelMetrics(BaseModel):
    count: int | None = None
    value: float | int | None = None
    remaining_quantity: float | None = None
    initial_quantity: float | None = None
    remaining_percent: float | None = None
    threshold_days: int | None = None


class DashboardPanelItemResponse(BaseModel):
    label: str
    detail: str
    submitter_name: str | None = None
    count: int | None = None
    impact: str | None = None
    value: int | None = None
    alert_kind: DashboardAlertKind | None = None
    remaining_quantity: float | None = None
    initial_quantity: float | None = None
    unit: str | None = None
    specification: str | None = None
    remaining_percent: float | None = None
    severity: DashboardSeverity | None = None
    tone: DashboardTone | None = None
    tab: DashboardTab | None = None
    created_at: str | None = None
    is_overdue: bool | None = None
    codes: DashboardPanelCodes = Field(default_factory=DashboardPanelCodes)
    entity: DashboardPanelEntity = Field(default_factory=DashboardPanelEntity)
    metrics: DashboardPanelMetrics = Field(default_factory=DashboardPanelMetrics)


class DashboardWindowStatsResponse(BaseModel):
    recent_window_days: int
    is_all_time: bool
    recent_arrival_count: int
    recent_reagent_order_count: int
    recent_consumable_order_count: int
    stock_in_activity_count: int
    order_total_value: float


class DashboardBoardSummaryDataResponse(BaseModel):
    action_items: list[DashboardPanelItemResponse]
    order_overview_items: list[DashboardPanelItemResponse]
    recent_items: list[DashboardPanelItemResponse]
    stock_alert_items: list[DashboardPanelItemResponse]
    announcement_items: list[DashboardPanelItemResponse]
    system_status: list[DashboardPanelItemResponse]
    recent_window_days: int
    system_version: str | None = None
    generated_at: str


class DashboardBoardSummaryEnvelope(BaseModel):
    data: DashboardBoardSummaryDataResponse


class DashboardWindowStatsEnvelope(BaseModel):
    data: DashboardWindowStatsResponse


class DashboardAdminSummaryDataResponse(BaseModel):
    reagent_order_count: int
    consumable_order_count: int
    borrowed_inventory_count: int
    pending_stockin_count: int
    reagent_order_delta: int
    consumable_order_delta: int
    borrowed_inventory_delta: int
    pending_stockin_delta: int
    pending_reagent_count: int
    pending_consumable_count: int
    approved_reagent_count: int
    overdue_borrow_count: int
    pending_reagent_overdue_count: int
    pending_consumable_overdue_count: int
    pending_stockin_overdue_count: int
    long_pending_order_count: int
    common_stock_alert_count: int
    recent_window_days: int
    is_all_time: bool
    recent_arrival_count: int
    recent_reagent_order_count: int
    recent_consumable_order_count: int
    stock_in_activity_count: int
    order_total_value: float
    todo_items: list[DashboardPanelItemResponse]
    risk_items: list[DashboardPanelItemResponse]
    recent_actions: list[DashboardPanelItemResponse]
    stock_alert_items: list[DashboardPanelItemResponse]
    system_status: list[DashboardPanelItemResponse]
    system_version: str | None = None
    generated_at: str


class DashboardAdminSummaryEnvelope(BaseModel):
    data: DashboardAdminSummaryDataResponse


@dataclass(frozen=True)
class SystemStatusCounts:
    pending_reagent_count: int
    pending_consumable_count: int
    pending_stockin_count: int
    overdue_borrow_count: int
    long_pending_order_count: int


def _count(db: Session, statement) -> int:
    return int(db.exec(statement).one() or 0)


def _join_dashboard_detail_parts(*parts: str | None) -> str:
    return " · ".join(part.strip() for part in parts if part and part.strip())


def _build_dashboard_codes(
    *,
    label_code: str | None = None,
    impact_code: str | None = None,
) -> dict[str, str | None]:
    return {
        "label_code": label_code,
        "impact_code": impact_code,
    }


def _build_dashboard_entity(
    *,
    entity_type: str | None = None,
    entity_id: int | str | None = None,
    name: str | None = None,
    preferred_name: str | None = None,
    preferred_name_source: str | None = None,
    cas_number: str | None = None,
    brand: str | None = None,
    specification: str | None = None,
    quantity: float | int | None = None,
    unit: str | None = None,
    actor_name: str | None = None,
) -> dict[str, Any]:
    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "name": name,
        "preferred_name": preferred_name,
        "preferred_name_source": preferred_name_source,
        "cas_number": cas_number,
        "brand": brand,
        "specification": specification,
        "quantity": quantity,
        "unit": unit,
        "actor_name": actor_name,
    }


def _build_dashboard_metrics(
    *,
    count: int | None = None,
    value: float | int | None = None,
    remaining_quantity: float | None = None,
    initial_quantity: float | None = None,
    remaining_percent: float | None = None,
    threshold_days: int | None = None,
) -> dict[str, Any]:
    return {
        "count": count,
        "value": value,
        "remaining_quantity": remaining_quantity,
        "initial_quantity": initial_quantity,
        "remaining_percent": remaining_percent,
        "threshold_days": threshold_days,
    }


def _with_dashboard_structured(
    item: dict[str, Any],
    *,
    label_code: str | None = None,
    impact_code: str | None = None,
    entity: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        **item,
        "codes": _build_dashboard_codes(
            label_code=label_code,
            impact_code=impact_code,
        ),
        "entity": entity or _build_dashboard_entity(),
        "metrics": metrics
        or _build_dashboard_metrics(
            count=item.get("count"),
            value=item.get("value"),
            remaining_quantity=item.get("remaining_quantity"),
            initial_quantity=item.get("initial_quantity"),
            remaining_percent=item.get("remaining_percent"),
        ),
    }


def _count_model_rows(db: Session, model: Any, *conditions: Any) -> int:
    """按相同过滤模式构造统计查询，避免各指标重复拼装 select。"""

    statement = select(func.count()).select_from(model)
    for condition in conditions:
        statement = statement.where(condition)
    return _count(db, statement)


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
    item_counts = _common_shelf_item_counts_subquery(
        "dashboard_common_shelf_item_counts"
    )
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
        ReagentOrder.status.in_(
            [ReagentOrderStatus.ARRIVED, ReagentOrderStatus.STOCKED]
        ),
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


def _count_overdue_borrows(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=OVERDUE_BORROW_DAYS)
    return _count_model_rows(
        db,
        Inventory,
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.updated_at < cutoff,
    )


def _count_long_pending_orders(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=LONG_PENDING_DAYS)
    reagent_count = _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
        ReagentOrder.created_at < cutoff,
    )
    consumable_count = _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
        ConsumableOrder.created_at < cutoff,
    )
    return reagent_count + consumable_count


def _count_pending_reagent_orders_overdue(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=TODO_PENDING_ALERT_DAYS)
    return _count_model_rows(
        db,
        ReagentOrder,
        ReagentOrder.status == ReagentOrderStatus.PENDING,
        ReagentOrder.created_at < cutoff,
    )


def _count_pending_consumable_orders_overdue(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=TODO_PENDING_ALERT_DAYS)
    return _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.PENDING,
        ConsumableOrder.created_at < cutoff,
    )


def _count_pending_stockins_overdue(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=PENDING_STOCKIN_ALERT_DAYS)
    return _count_model_rows(
        db,
        Inventory,
        Inventory.storage_location.is_(None),
        Inventory.temporary_keeper_id.is_not(None),
        Inventory.created_at < cutoff,
    )


def _count_long_unarrived_approved_reagent_orders(db: Session, now: datetime) -> int:
    cutoff = now - timedelta(days=LONG_UNARRIVED_APPROVED_DAYS)
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
    cutoff = now - timedelta(days=LONG_UNARRIVED_APPROVED_DAYS)
    return _count_model_rows(
        db,
        ConsumableOrder,
        ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
        ConsumableOrder.updated_at < cutoff,
    )


def _get_inventory_stock_alerts(db: Session) -> list[dict[str, Any]]:
    computed_percent = Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    remaining_percent = func.coalesce(Inventory.remaining_percent, computed_percent)
    rows = db.exec(
        select(Inventory, remaining_percent.label("remaining_percent"))
        .where(Inventory.status.in_([InventoryStatus.IN_STOCK, InventoryStatus.RUN_SHORT]))
        .where(Inventory.initial_quantity.is_not(None))
        .where(Inventory.initial_quantity > 0)
        .where(Inventory.remaining_quantity.is_not(None))
        .where(remaining_percent < INVENTORY_STOCK_ALERT_PERCENT)
        .order_by(remaining_percent.asc(), Inventory.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()
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


def _get_common_shelf_stock_alerts(db: Session) -> list[dict[str, Any]]:
    item_counts = _common_shelf_item_counts_subquery(
        "dashboard_common_shelf_alert_counts"
    )
    bottle_count = func.coalesce(item_counts.c.bottle_count, 0)
    rows = db.exec(
        select(CommonShelfGroup, bottle_count.label("bottle_count"))
        .join(
            item_counts,
            _common_shelf_group_count_join(item_counts),
            isouter=True,
        )
        .where(CommonShelfGroup.is_deleted.is_(False))
        .where(bottle_count < COMMON_SHELF_ALERT_BOTTLE_THRESHOLD)
        .order_by(bottle_count.asc(), CommonShelfGroup.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()
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
                preferred_name=standard_name_by_cas.get(group.cas_number) or group.name_snapshot,
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


def _get_stock_alert_items(db: Session) -> list[dict[str, Any]]:
    alerts = _get_inventory_stock_alerts(db) + _get_common_shelf_stock_alerts(db)
    return sorted(alerts, key=lambda item: item["created_at"], reverse=True)[:LIST_LIMIT]


def _load_recent_logs(db: Session, model: Any, condition: Any) -> list[Any]:
    return db.exec(
        select(model)
        .where(condition)
        .order_by(model.created_at.desc())
        .limit(LIST_LIMIT)
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


def _get_todo_items(db: Session, now: datetime) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    overdue_cutoff = now - timedelta(days=TODO_PENDING_ALERT_DAYS)
    reagent_orders = db.exec(
        select(ReagentOrder)
        .where(ReagentOrder.status == ReagentOrderStatus.PENDING)
        .order_by(ReagentOrder.created_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    consumable_orders = db.exec(
        select(ConsumableOrder)
        .where(ConsumableOrder.status == ConsumableOrderStatus.PENDING)
        .order_by(ConsumableOrder.created_at.desc())
        .limit(LIST_LIMIT)
    ).all()
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
    return sorted(items, key=lambda item: item["created_at"], reverse=True)[:LIST_LIMIT]


def _build_risk_items(
    *,
    long_pending_order_count: int,
    overdue_borrow_count: int,
    long_unarrived_approved_reagent_count: int,
    long_unconfirmed_approved_consumable_count: int,
) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    if long_pending_order_count > 0:
        risks.append(
            _with_dashboard_structured(
                {
                    "label": "订单超时",
                    "detail": f"超过 {LONG_PENDING_DAYS} 天未处理：{long_pending_order_count} 条",
                    "severity": "medium",
                    "tab": "reagents",
                },
                label_code="risk.order_timeout",
                metrics=_build_dashboard_metrics(
                    count=long_pending_order_count,
                    threshold_days=LONG_PENDING_DAYS,
                ),
            )
        )
    if long_unarrived_approved_reagent_count > 0:
        risks.append(
            _with_dashboard_structured(
                {
                    "label": "长时间未到货",
                    "detail": (
                        f"已批准超过 {LONG_UNARRIVED_APPROVED_DAYS} 天未到货："
                        f"{long_unarrived_approved_reagent_count} 条"
                    ),
                    "severity": "medium",
                    "tab": "reagents",
                },
                label_code="risk.reagent_order_unarrived",
                metrics=_build_dashboard_metrics(
                    count=long_unarrived_approved_reagent_count,
                    threshold_days=LONG_UNARRIVED_APPROVED_DAYS,
                ),
            )
        )
    if long_unconfirmed_approved_consumable_count > 0:
        risks.append(
            _with_dashboard_structured(
                {
                    "label": "长时间未确认收货",
                    "detail": (
                        f"已批准超过 {LONG_UNARRIVED_APPROVED_DAYS} 天未确认收货："
                        f"{long_unconfirmed_approved_consumable_count} 条"
                    ),
                    "severity": "medium",
                    "tab": "consumables",
                },
                label_code="risk.consumable_order_unconfirmed",
                metrics=_build_dashboard_metrics(
                    count=long_unconfirmed_approved_consumable_count,
                    threshold_days=LONG_UNARRIVED_APPROVED_DAYS,
                ),
            )
        )
    if overdue_borrow_count > 0:
        risks.append(
            _with_dashboard_structured(
                {
                    "label": "借用超时",
                    "detail": f"{overdue_borrow_count} 条借用已超过归还提醒阈值",
                    "severity": "high",
                    "tab": "borrows",
                },
                label_code="risk.borrow_overdue",
                metrics=_build_dashboard_metrics(
                    count=overdue_borrow_count,
                    threshold_days=OVERDUE_BORROW_DAYS,
                ),
            )
        )
    return risks[:LIST_LIMIT]


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


def _board_panel_item(
    label: str,
    detail: str,
    *,
    tab: str | None = None,
    severity: str = "medium",
    count: int | None = None,
    impact: str | None = None,
    created_at: datetime | None = None,
    submitter_name: str | None = None,
    label_code: str | None = None,
    impact_code: str | None = None,
    entity: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _with_dashboard_structured(
        {
            "label": label,
            "detail": detail,
            "tab": tab,
            "severity": severity,
            "count": count,
            "impact": impact,
            "created_at": utc_iso_str(created_at) if created_at else None,
            "submitter_name": submitter_name,
        },
        label_code=label_code,
        impact_code=impact_code,
        entity=entity,
        metrics=metrics,
    )


def _get_user_board_overview_reagent_orders(db: Session, user_id: int) -> list[ReagentOrder]:
    return db.exec(
        select(ReagentOrder)
        .where(
            ReagentOrder.applicant_id == user_id,
            ReagentOrder.status.in_(BOARD_ORDER_OVERVIEW_REAGENT_STATUSES),
        )
        .order_by(ReagentOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_user_board_overview_consumable_orders(
    db: Session,
    user_id: int,
) -> list[ConsumableOrder]:
    return db.exec(
        select(ConsumableOrder)
        .where(
            ConsumableOrder.applicant_id == user_id,
            ConsumableOrder.status.in_(BOARD_ORDER_OVERVIEW_CONSUMABLE_STATUSES),
        )
        .order_by(ConsumableOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _build_user_order_overview_items(db: Session, current_user: User) -> list[dict[str, Any]]:
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
        for order in _get_user_board_overview_reagent_orders(db, current_user.id)
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
        for order in _get_user_board_overview_consumable_orders(db, current_user.id)
    )
    return sorted(items, key=lambda item: item["created_at"] or "", reverse=True)[:LIST_LIMIT]


def _reagent_detail(order: ReagentOrder) -> str:
    specification = format_specification(order.initial_quantity, order.unit) or "-"
    return f"{order.name} · {order.cas_number} · {specification} × {order.quantity}"


def _consumable_detail(order: ConsumableOrder) -> str:
    specification = order.specification or order.unit or "-"
    return f"{order.name} · {specification} × {order.quantity}"


def _inventory_detail(item: Inventory) -> str:
    specification = format_specification(item.initial_quantity, item.unit) or "-"
    return f"{item.name} · {item.cas_number} · {specification}"

def _get_user_approved_reagent_orders(db: Session, user_id: int) -> list[ReagentOrder]:
    return db.exec(
        select(ReagentOrder)
        .where(
            ReagentOrder.applicant_id == user_id,
            ReagentOrder.status == ReagentOrderStatus.APPROVED,
        )
        .order_by(ReagentOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_user_approved_consumable_orders(db: Session, user_id: int) -> list[ConsumableOrder]:
    return db.exec(
        select(ConsumableOrder)
        .where(
            ConsumableOrder.applicant_id == user_id,
            ConsumableOrder.status == ConsumableOrderStatus.APPROVED,
        )
        .order_by(ConsumableOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_recent_completed_consumable_orders(db: Session) -> list[ConsumableOrder]:
    return db.exec(
        select(ConsumableOrder)
        .where(ConsumableOrder.status == ConsumableOrderStatus.COMPLETED)
        .order_by(ConsumableOrder.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_user_overdue_borrowed_items(
    db: Session,
    user_id: int,
    now: datetime,
) -> list[Inventory]:
    overdue_cutoff = now - timedelta(days=OVERDUE_BORROW_DAYS)
    return db.exec(
        select(Inventory)
        .where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.borrower_id == user_id,
            Inventory.updated_at < overdue_cutoff,
        )
        .order_by(Inventory.updated_at.desc())
        .limit(LIST_LIMIT)
    ).all()


def _get_user_board_action_items(
    db: Session,
    current_user: User,
    now: datetime,
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
        for order in _get_user_approved_reagent_orders(db, current_user.id)
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
        for order in _get_user_approved_consumable_orders(db, current_user.id)
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
        for item in _get_user_overdue_borrowed_items(db, current_user.id, now)
    )
    return sorted(items, key=lambda item: item["created_at"] or "", reverse=True)[:LIST_LIMIT]


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
            "试剂到货",
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
            "耗材到货",
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
            "订单入库",
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
        .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    creator_ids = {item.created_by for item in announcements if item.created_by}
    users_map = batch_get_user_names(db, creator_ids)
    return [
        _board_panel_item(
            "置顶公告" if announcement.is_pinned else "公告",
            announcement.title,
            impact="置顶" if announcement.is_pinned else "公告",
            severity="medium" if announcement.is_pinned else "success",
            submitter_name=users_map.get(announcement.created_by) if announcement.created_by else None,
            created_at=announcement.created_at,
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


@router.get("/board/summary", response_model=DashboardBoardSummaryEnvelope)
def get_dashboard_board_summary(
    db: DBSession,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Return public dashboard board data for authenticated users."""

    now = get_utc_now()
    return {
        "data": {
            "action_items": _get_user_board_action_items(db, current_user, now),
            "order_overview_items": _build_user_order_overview_items(db, current_user),
            "recent_items": _get_board_recent_items(db),
            "stock_alert_items": _get_stock_alert_items(db),
            "announcement_items": _get_board_announcement_items(db),
            "system_status": [],
            "recent_window_days": RECENT_WINDOW_DAYS,
            "system_version": settings.app_version,
            "generated_at": utc_iso_str(now),
        }
    }


@router.get(
    "/board/summary/window-stats",
    response_model=DashboardWindowStatsEnvelope,
    dependencies=[Depends(get_current_user)],
)
def get_dashboard_board_window_stats(
    db: DBSession,
    window_days: int = Query(
        default=RECENT_WINDOW_DAYS,
        ge=DASHBOARD_WINDOW_MIN_DAYS,
        le=DASHBOARD_WINDOW_MAX_DAYS,
    ),
    all_time: bool = Query(default=False),
) -> dict[str, Any]:
    """Return public dashboard board recent-window counts."""

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


@router.get(
    "/admin/summary",
    response_model=DashboardAdminSummaryEnvelope,
    dependencies=[Depends(require_admin)],
)
def get_admin_dashboard_summary(db: DBSession) -> dict[str, Any]:
    """Return high-level administrator dashboard counts."""

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
    stock_alert_items = _get_stock_alert_items(db)
    overdue_borrow_count = _count_overdue_borrows(db, now)
    long_pending_order_count = _count_long_pending_orders(db, now)
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
            "long_pending_order_count": long_pending_order_count,
            "common_stock_alert_count": _count_common_shelf_alerts(db),
            **recent_window_stats,
            "todo_items": _get_todo_items(db, now),
            "risk_items": _build_risk_items(
                long_pending_order_count=long_pending_order_count,
                overdue_borrow_count=overdue_borrow_count,
                long_unarrived_approved_reagent_count=(
                    long_unarrived_approved_reagent_count
                ),
                long_unconfirmed_approved_consumable_count=(
                    long_unconfirmed_approved_consumable_count
                ),
            ),
            "recent_actions": _get_recent_management_actions(db),
            "stock_alert_items": stock_alert_items,
            "system_status": _build_system_status(
                db=db,
                now=now,
                counts=SystemStatusCounts(
                    pending_reagent_count=pending_reagent_count,
                    pending_consumable_count=pending_consumable_count,
                    pending_stockin_count=pending_stockin_count,
                    overdue_borrow_count=overdue_borrow_count,
                    long_pending_order_count=long_pending_order_count,
                ),
            ),
            "system_version": settings.app_version,
            "generated_at": utc_iso_str(now),
        }
    }


@router.get(
    "/admin/summary/window-stats",
    response_model=DashboardWindowStatsEnvelope,
    dependencies=[Depends(require_admin)],
)
def get_admin_dashboard_window_stats(
    db: DBSession,
    window_days: int = Query(
        default=RECENT_WINDOW_DAYS,
        ge=DASHBOARD_WINDOW_MIN_DAYS,
        le=DASHBOARD_WINDOW_MAX_DAYS,
    ),
    all_time: bool = Query(default=False),
) -> dict[str, Any]:
    """Return recent-window administrator dashboard counts."""

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
