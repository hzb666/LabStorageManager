"""Shared dashboard response builders and query helpers."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from sqlalchemy import func
from sqlmodel import Session, select

from app.core.time_utils import utc_iso_str
from app.models.consumable_order import ConsumableOrder
from app.models.inventory import Inventory
from app.models.reagent_order import ReagentOrder
from app.services.spec_utils import format_specification

RECENT_WINDOW_DAYS = 7
DASHBOARD_WINDOW_MIN_DAYS = 3
DASHBOARD_WINDOW_MAX_DAYS = 365
COMMON_SHELF_ALERT_BOTTLE_THRESHOLD = 3
INVENTORY_STOCK_ALERT_PERCENT = 0.10
TODO_PENDING_ALERT_DAYS = 2
LONG_PENDING_DAYS = TODO_PENDING_ALERT_DAYS
LONG_UNARRIVED_APPROVED_DAYS = 3
PENDING_STOCKIN_ALERT_DAYS = 7
LIST_LIMIT = 5
BOARD_SECTION_PAGE_SIZE = 50
BOARD_SECTION_MAX_PAGE_SIZE = 100
BOARD_SECTION_ACTIONS = "actions"
BOARD_SECTION_ORDERS = "orders"
BOARD_SECTION_STOCK_ALERTS = "stockAlerts"
ADMIN_SECTION_TODOS = "todos"
ADMIN_SECTION_RISKS = "risks"
ADMIN_SECTION_STOCK_ALERTS = "stockAlerts"
DashboardItemFetcher = Callable[[int], list[dict[str, Any]]]


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


def _exec_dashboard_limited(db: Session, statement: Any, limit: int | None) -> list[Any]:
    if limit is not None:
        statement = statement.limit(limit)
    return db.exec(statement).all()


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


def _get_dashboard_section_page(
    fetch_items: DashboardItemFetcher,
    *,
    skip: int,
    limit: int,
) -> list[dict[str, Any]]:
    fetch_limit = skip + limit if limit > 0 else 0
    return fetch_items(fetch_limit)[skip : skip + limit]


def _reagent_detail(order: ReagentOrder) -> str:
    specification = format_specification(order.initial_quantity, order.unit) or "-"
    return f"{order.name} · {order.cas_number} · {specification} × {order.quantity}"


def _consumable_detail(order: ConsumableOrder) -> str:
    specification = order.specification or order.unit or "-"
    return f"{order.name} · {specification} × {order.quantity}"


def _inventory_detail(item: Inventory) -> str:
    specification = format_specification(item.initial_quantity, item.unit) or "-"
    return f"{item.name} · {item.cas_number} · {specification}"
