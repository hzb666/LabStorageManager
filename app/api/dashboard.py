"""Administrator dashboard aggregate routes."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.auth import get_current_user, require_admin
from app.core.time_utils import get_utc_now
from app.database import DBSession
from app.models.user import User, UserRole
from app.services.api_utils import normalize_pagination
from app.services.dashboard.summary import (
    _build_public_board_summary_data,
    _build_user_board_summary_data,
    _get_admin_section_items,
    _get_admin_section_total,
    _get_board_section_items,
    _get_board_section_total,
    build_admin_dashboard_summary,
    build_dashboard_window_stats,
)
from app.services.dashboard.common import (
    BOARD_SECTION_MAX_PAGE_SIZE,
    BOARD_SECTION_PAGE_SIZE,
    DASHBOARD_WINDOW_MAX_DAYS,
    DASHBOARD_WINDOW_MIN_DAYS,
    RECENT_WINDOW_DAYS,
)

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
)

DashboardSeverity = Literal["high", "medium", "low", "neutral", "success", "warning"]
DashboardTone = Literal["neutral", "success", "warning", "high"]
DashboardTab = Literal["reagents", "consumables", "borrows", "stockin"]
DashboardAlertKind = Literal["inventory", "common_shelf"]
DashboardBoardSection = Literal["actions", "orders", "stockAlerts"]
DashboardAdminSection = Literal["todos", "risks", "stockAlerts"]


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


class DashboardBoardSummaryCountsResponse(BaseModel):
    action_items: int
    order_overview_items: int
    stock_alert_items: int


class DashboardBoardSummaryDataResponse(BaseModel):
    action_items: list[DashboardPanelItemResponse]
    order_overview_items: list[DashboardPanelItemResponse]
    recent_items: list[DashboardPanelItemResponse]
    stock_alert_items: list[DashboardPanelItemResponse]
    announcement_items: list[DashboardPanelItemResponse]
    system_status: list[DashboardPanelItemResponse]
    item_counts: DashboardBoardSummaryCountsResponse
    recent_window_days: int
    system_version: str | None = None
    generated_at: str


class DashboardBoardSummaryEnvelope(BaseModel):
    data: DashboardBoardSummaryDataResponse


class DashboardSectionItemsEnvelope(BaseModel):
    data: list[DashboardPanelItemResponse]
    total: int
    skip: int
    limit: int


class DashboardWindowStatsEnvelope(BaseModel):
    data: DashboardWindowStatsResponse


class DashboardAdminSummaryCountsResponse(BaseModel):
    todo_items: int
    risk_items: int
    stock_alert_items: int


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
    long_unarrived_approved_reagent_count: int
    long_unconfirmed_approved_consumable_count: int
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
    item_counts: DashboardAdminSummaryCountsResponse
    system_version: str | None = None
    generated_at: str


class DashboardAdminSummaryEnvelope(BaseModel):
    data: DashboardAdminSummaryDataResponse


@router.get("/board/summary", response_model=DashboardBoardSummaryEnvelope)
def get_dashboard_board_summary(
    db: DBSession,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Return public dashboard board data for authenticated users."""

    now = get_utc_now()
    if current_user.role == UserRole.PUBLIC:
        return {"data": _build_public_board_summary_data(db, now)}

    return {"data": _build_user_board_summary_data(db, current_user, now)}


@router.get("/board/sections/{section}", response_model=DashboardSectionItemsEnvelope)
def get_dashboard_board_section_items(
    section: DashboardBoardSection,
    db: DBSession,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=BOARD_SECTION_PAGE_SIZE, ge=1, le=BOARD_SECTION_MAX_PAGE_SIZE),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Return one paginated public dashboard board section."""

    now = get_utc_now()
    skip, limit = normalize_pagination(skip, limit)
    if current_user.role == UserRole.PUBLIC:
        return {"data": [], "total": 0, "skip": skip, "limit": limit}

    return {
        "data": _get_board_section_items(
            db,
            section,
            current_user,
            now,
            skip=skip,
            limit=limit,
        ),
        "total": _get_board_section_total(db, section, current_user, now),
        "skip": skip,
        "limit": limit,
    }


@router.get(
    "/admin/sections/{section}",
    response_model=DashboardSectionItemsEnvelope,
    dependencies=[Depends(require_admin)],
)
def get_admin_dashboard_section_items(
    section: DashboardAdminSection,
    db: DBSession,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=BOARD_SECTION_PAGE_SIZE, ge=1, le=BOARD_SECTION_MAX_PAGE_SIZE),
) -> dict[str, Any]:
    """Return one paginated administrator dashboard section."""

    now = get_utc_now()
    skip, limit = normalize_pagination(skip, limit)
    return {
        "data": _get_admin_section_items(
            db,
            section,
            now,
            skip=skip,
            limit=limit,
        ),
        "total": _get_admin_section_total(db, section, now),
        "skip": skip,
        "limit": limit,
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

    return build_dashboard_window_stats(db, window_days=window_days, all_time=all_time)


@router.get(
    "/admin/summary",
    response_model=DashboardAdminSummaryEnvelope,
    dependencies=[Depends(require_admin)],
)
def get_admin_dashboard_summary(db: DBSession) -> dict[str, Any]:
    """Return high-level administrator dashboard counts."""

    return build_admin_dashboard_summary(db)


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

    return build_dashboard_window_stats(db, window_days=window_days, all_time=all_time)
