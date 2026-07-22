"""读取单个库存的主数据库操作时间线。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import and_, or_
from sqlmodel import func, select

from app.database import DBSession
from app.models.inventory import BorrowLog
from app.models.inventory_operation_log import (
    InventoryOperationAction,
    InventoryOperationLog,
)
from app.models.inventory_timeline import (
    InventoryTimelineItem,
    InventoryTimelineOperationType,
    InventoryTimelineResponse,
)
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.services.log_timeline_renderer import render_log_timeline_rows
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names


INVENTORY_CHANGE_FIELD_LABELS: tuple[tuple[str, str], ...] = (
    ("name", "名称"),
    ("english_name", "英文名称"),
    ("alias", "别名"),
    ("cas_number", "CAS号"),
    ("storage_location", "存放位置"),
    ("remaining_quantity", "剩余量"),
    ("initial_quantity", "入库数量"),
    ("unit", "单位"),
    ("status", "状态"),
    ("category", "类别"),
    ("brand", "品牌"),
    ("purity", "纯度"),
    ("is_hazardous", "危险品"),
    ("notes", "备注"),
)


def _build_inventory_timeline_clause(inventory_id: int):
    inventory_log_ids = select(InventoryOperationLog.id).where(
        InventoryOperationLog.inventory_id == inventory_id,
        InventoryOperationLog.action.in_(
            (
                InventoryOperationAction.STOCK_IN,
                InventoryOperationAction.INVENTORY_UPDATE,
            )
        ),
    )
    borrow_log_ids = select(BorrowLog.id).where(BorrowLog.inventory_id == inventory_id)
    return or_(
        and_(
            LogTimeline.source_table == LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
            LogTimeline.source_log_id.in_(inventory_log_ids),
        ),
        and_(
            LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG,
            LogTimeline.source_log_id.in_(borrow_log_ids),
        ),
    )


def _get_changed_field_labels(full_data: dict[str, Any]) -> list[str]:
    before = full_data.get("before")
    after = full_data.get("after")
    before_values = before if isinstance(before, dict) else {}
    after_values = after if isinstance(after, dict) else {}
    return [
        label
        for field_name, label in INVENTORY_CHANGE_FIELD_LABELS
        if before_values.get(field_name) != after_values.get(field_name)
    ]


def _build_edit_detail(full_data: dict[str, Any]) -> str:
    labels = _get_changed_field_labels(full_data)
    if not labels:
        return "编辑库存信息"
    if len(labels) <= 3:
        return f"修改了{'、'.join(labels)}"
    return f"修改了{'、'.join(labels[:2])}等 {len(labels)} 项"


def _build_stock_in_detail(full_data: dict[str, Any]) -> str:
    specification = format_specification(
        full_data.get("initial_quantity"),
        str(full_data.get("unit") or "").strip(),
    )
    return f"入库 {specification or ''}".strip()


def _build_borrow_detail(full_data: dict[str, Any]) -> str:
    specification = format_specification(
        full_data.get("quantity_borrowed"),
        str(full_data.get("unit") or "").strip(),
    )
    return f"借用 {specification or ''}".strip()


def _resolve_operation_type(
    timeline_row: LogTimeline,
    full_data: dict[str, Any],
) -> InventoryTimelineOperationType | None:
    if timeline_row.source_table == LogTimelineSourceTable.BORROWLOG:
        return InventoryTimelineOperationType.BORROW
    action = str(full_data.get("action") or "")
    if action == InventoryOperationAction.STOCK_IN.value:
        return InventoryTimelineOperationType.STOCK_IN
    if action == InventoryOperationAction.INVENTORY_UPDATE.value:
        return InventoryTimelineOperationType.EDIT
    return None


def _build_timeline_item(
    timeline_row: LogTimeline,
    rendered: dict[str, object],
    user_names: dict[int, str],
) -> InventoryTimelineItem | None:
    raw_full_data = rendered.get("full_data")
    full_data = raw_full_data if isinstance(raw_full_data, dict) else {}
    operation_type = _resolve_operation_type(timeline_row, full_data)
    if operation_type is None:
        return None

    detail_builders = {
        InventoryTimelineOperationType.STOCK_IN: _build_stock_in_detail,
        InventoryTimelineOperationType.EDIT: _build_edit_detail,
        InventoryTimelineOperationType.BORROW: _build_borrow_detail,
    }
    source_table = (
        timeline_row.source_table.value
        if isinstance(timeline_row.source_table, LogTimelineSourceTable)
        else str(timeline_row.source_table)
    )
    return InventoryTimelineItem(
        id=f"{source_table}:{timeline_row.source_log_id}",
        time=str(rendered["time"]),
        type=str(rendered["type"]),
        operation_type=operation_type,
        operator_name=user_names.get(timeline_row.actor_user_id or 0) or "未知用户",
        detail=detail_builders[operation_type](full_data),
        summary=rendered.get("summary") if isinstance(rendered.get("summary"), dict) else None,
        full_data=full_data,
    )


def _render_timeline_items(
    db: DBSession,
    rows: list[LogTimeline],
    *,
    viewer_user_id: int,
) -> list[InventoryTimelineItem]:
    user_ids = {row.actor_user_id for row in rows if row.actor_user_id is not None}
    user_names = batch_get_user_names(db, user_ids)
    items: list[InventoryTimelineItem] = []
    for row, rendered in render_log_timeline_rows(db, rows, user_id=viewer_user_id):
        item = _build_timeline_item(row, rendered, user_names)
        if item is not None:
            items.append(item)
    return items


def _matches_search(item: InventoryTimelineItem, search: str) -> bool:
    keyword = search.casefold()
    status_text = ""
    if item.operation_type == InventoryTimelineOperationType.BORROW:
        status_text = "已归还" if item.summary and item.summary.get("is_returned") else "借用中"
    haystack = f"{item.operator_name} {item.detail} {status_text}".casefold()
    return keyword in haystack


def list_inventory_timeline(
    db: DBSession,
    *,
    inventory_id: int,
    viewer_user_id: int,
    search: str | None,
    skip: int,
    limit: int,
) -> InventoryTimelineResponse:
    """返回单个库存的入库、编辑和借用记录。"""

    target_clause = _build_inventory_timeline_clause(inventory_id)
    base_query = select(LogTimeline).where(target_clause)
    order_by = (LogTimeline.occurred_at.desc(), LogTimeline.id.desc())
    normalized_search = (search or "").strip()

    if normalized_search:
        rows = list(db.exec(base_query.order_by(*order_by)).all())
        matched_items = [
            item
            for item in _render_timeline_items(db, rows, viewer_user_id=viewer_user_id)
            if _matches_search(item, normalized_search)
        ]
        data = matched_items[skip : skip + limit] if limit > 0 else []
        total = len(matched_items)
    else:
        total = db.exec(select(func.count()).select_from(LogTimeline).where(target_clause)).one()
        rows = (
            list(db.exec(base_query.order_by(*order_by).offset(skip).limit(limit)).all())
            if limit > 0
            else []
        )
        data = _render_timeline_items(db, rows, viewer_user_id=viewer_user_id)

    return InventoryTimelineResponse(data=data, total=total, skip=skip, limit=limit)
