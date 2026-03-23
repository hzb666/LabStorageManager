"""XLSX export service for unified export functionality."""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.time_utils import get_utc_now, to_china_time
from app.models.inventory import InventoryStatus
from app.services.shelf_utils import is_common_shelf_available_status
from app.services.spec_utils import format_specification

_DANGEROUS_SPREADSHEET_PREFIXES = ("=", "+", "-", "@")

try:
    from openpyxl import Workbook
    from openpyxl.styles.numbers import FORMAT_TEXT
except ImportError as exc:  # pragma: no cover - import-time guard for deployment envs
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="XLSX export requires the 'openpyxl' package.",
    ) from exc


@dataclass
class ExportSheet:
    title: str
    headers: list[str]
    rows: list[list[Any]]
    text_columns: set[int]


def _get_field(item: Any, field: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(field, default)
    return getattr(item, field, default)


def _escape_spreadsheet_formula(value: Any) -> Any:
    """Neutralize spreadsheet formulas in exported string cells."""
    if not isinstance(value, str):
        return value

    stripped = value.lstrip()
    if stripped and stripped[0] in _DANGEROUS_SPREADSHEET_PREFIXES:
        return f"'{value}"

    return value


def _export_to_xlsx(
    sheets: list[ExportSheet],
    filename_prefix: str,
) -> StreamingResponse:
    """Generate XLSX export response with per-column text formatting."""
    wb = Workbook()
    default_sheet = wb.active
    wb.remove(default_sheet)

    for sheet in sheets:
        ws = wb.create_sheet(title=sheet.title)

        for col_idx, header in enumerate(sheet.headers, 1):
            header_cell = ws.cell(row=1, column=col_idx, value=header)
            if col_idx in sheet.text_columns:
                header_cell.number_format = FORMAT_TEXT

        for row_idx, row in enumerate(sheet.rows, 2):
            for col_idx, value in enumerate(row, 1):
                safe_value = _escape_spreadsheet_formula(value)
                if col_idx in sheet.text_columns:
                    cell = ws.cell(
                        row=row_idx,
                        column=col_idx,
                        value="" if safe_value is None else str(safe_value),
                    )
                    cell.number_format = FORMAT_TEXT
                else:
                    ws.cell(
                        row=row_idx,
                        column=col_idx,
                        value="" if safe_value is None else safe_value,
                    )

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"{filename_prefix}_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _common_group_sort_key(item: Any) -> tuple[Any, ...]:
    return (
        _get_field(item, "cas_number") or "",
        _get_field(item, "name") or "",
        _get_field(item, "brand") or "",
        _get_field(item, "initial_quantity") if _get_field(item, "initial_quantity") is not None else -1,
        _get_field(item, "unit") or "",
        _get_field(item, "storage_location") or "",
    )


def _derive_common_group_status(available_bottles: int, has_running_short: bool) -> InventoryStatus:
    if available_bottles <= 0:
        return InventoryStatus.CONSUMED
    if has_running_short:
        return InventoryStatus.RUN_SHORT
    return InventoryStatus.IN_STOCK


def build_common_shelf_export_rows(items: list[Any]) -> list[dict[str, Any]]:
    """Build grouped common-shelf export rows from raw common inventory items."""
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in items:
        group_key = _common_group_sort_key(item)
        group = grouped.get(group_key)
        if group is None:
            group = {
                "sample_inventory_id": _get_field(item, "id"),
                "cas_number": _get_field(item, "cas_number"),
                "name": _get_field(item, "name"),
                "english_name": _get_field(item, "english_name"),
                "alias": _get_field(item, "alias"),
                "category": _get_field(item, "category"),
                "brand": _get_field(item, "brand"),
                "storage_location": _get_field(item, "storage_location"),
                "initial_quantity": _get_field(item, "initial_quantity"),
                "unit": _get_field(item, "unit"),
                "is_hazardous": _get_field(item, "is_hazardous"),
                "notes": _get_field(item, "notes"),
                "created_at": _get_field(item, "created_at"),
                "updated_at": _get_field(item, "updated_at"),
                "total_bottles": 0,
                "available_bottles": 0,
                "has_running_short": False,
            }
            grouped[group_key] = group

        group["total_bottles"] += 1
        if is_common_shelf_available_status(_get_field(item, "status")):
            group["available_bottles"] += 1
        if _get_field(item, "status") == InventoryStatus.RUN_SHORT:
            group["has_running_short"] = True

        created_at = _get_field(item, "created_at")
        if created_at and (group["created_at"] is None or created_at > group["created_at"]):
            group["created_at"] = created_at
            group["sample_inventory_id"] = _get_field(item, "id")

    rows: list[dict[str, Any]] = []
    for group in grouped.values():
        available_bottles = group["available_bottles"]
        row_status = _derive_common_group_status(available_bottles, group["has_running_short"])
        rows.append(
            {
                "sample_inventory_id": group["sample_inventory_id"],
                "cas_number": group["cas_number"],
                "name": group["name"],
                "english_name": group["english_name"],
                "alias": group["alias"],
                "category": group["category"],
                "brand": group["brand"],
                "storage_location": group["storage_location"],
                "initial_quantity": group["initial_quantity"],
                "unit": group["unit"],
                "is_hazardous": group["is_hazardous"],
                "status": row_status,
                "available_bottles": available_bottles,
                "total_bottles": group["total_bottles"],
                "consumed_bottles": group["total_bottles"] - available_bottles,
                "created_at": group["created_at"],
                "updated_at": group["updated_at"],
                "notes": group["notes"],
                "specification": format_specification(group["initial_quantity"], group["unit"]),
            }
        )

    return rows


def export_inventory_xlsx(
    items: list[Any],
    common_items: Optional[list[Any]] = None,
) -> StreamingResponse:
    """Export inventory workbook with regular and common-shelf worksheets."""
    regular_headers = [
        "CAS号",
        "名称",
        "英文名",
        "别名",
        "分类",
        "品牌",
        "位置",
        "初始数量",
        "剩余数量",
        "单位",
        "状态",
        "是否危险品",
        "入库时间",
        "备注",
    ]

    def regular_row_converter(item: Any) -> list[Any]:
        return [
            _get_field(item, "cas_number"),
            _get_field(item, "name"),
            _get_field(item, "english_name") or "",
            _get_field(item, "alias") or "",
            _get_field(item, "category") or "",
            _get_field(item, "brand") or "",
            _get_field(item, "storage_location") or "",
            _get_field(item, "initial_quantity"),
            _get_field(item, "remaining_quantity"),
            _get_field(item, "unit"),
            _get_field(item, "status").value
            if hasattr(_get_field(item, "status"), "value")
            else _get_field(item, "status"),
            "是" if _get_field(item, "is_hazardous") else "否",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S")
            if _get_field(item, "created_at")
            else "",
            _get_field(item, "notes") or "",
        ]

    regular_rows = [regular_row_converter(item) for item in items]
    sheets = [
        ExportSheet(
            title="库存",
            headers=regular_headers,
            rows=regular_rows,
            text_columns=set(range(1, len(regular_headers) + 1)),
        )
    ]

    common_rows_data = build_common_shelf_export_rows(common_items or [])
    common_headers = [
        "CAS号",
        "名称",
        "英文名",
        "别名",
        "分类",
        "品牌",
        "位置",
        "规格",
        "总瓶数",
        "可用瓶数",
        "已消耗瓶数",
        "是否危险品",
        "状态",
        "入库时间",
        "备注",
    ]

    common_rows = [
        [
            _get_field(item, "cas_number"),
            _get_field(item, "name"),
            _get_field(item, "english_name") or "",
            _get_field(item, "alias") or "",
            _get_field(item, "category") or "",
            _get_field(item, "brand") or "",
            _get_field(item, "storage_location") or "",
            _get_field(item, "specification") or "",
            _get_field(item, "total_bottles"),
            _get_field(item, "available_bottles"),
            _get_field(item, "consumed_bottles"),
            "是" if _get_field(item, "is_hazardous") else "否",
            _get_field(item, "status").value
            if hasattr(_get_field(item, "status"), "value")
            else _get_field(item, "status"),
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S")
            if _get_field(item, "created_at")
            else "",
            _get_field(item, "notes") or "",
        ]
        for item in common_rows_data
    ]

    sheets.append(
        ExportSheet(
            title="常用",
            headers=common_headers,
            rows=common_rows,
            text_columns=set(range(1, len(common_headers) + 1)),
        )
    )

    return _export_to_xlsx(
        sheets=sheets,
        filename_prefix="inventory_export",
    )


def export_common_shelf_xlsx(
    items: list[Any],
) -> StreamingResponse:
    """Export common shelf items (grouped by sample_inventory_id)."""
    headers = [
        "CAS号",
        "名称",
        "英文名",
        "别名",
        "分类",
        "品牌",
        "位置",
        "规格",
        "总瓶数",
        "可用瓶数",
        "已消耗瓶数",
        "是否危险品",
        "状态",
        "入库时间",
        "备注",
    ]

    def row_converter(item: Any) -> list[Any]:
        return [
            _get_field(item, "cas_number"),
            _get_field(item, "name"),
            _get_field(item, "english_name") or "",
            _get_field(item, "alias") or "",
            _get_field(item, "category") or "",
            _get_field(item, "brand") or "",
            _get_field(item, "storage_location") or "",
            _get_field(item, "specification") or "",
            _get_field(item, "total_bottles"),
            _get_field(item, "available_bottles"),
            _get_field(item, "consumed_bottles"),
            "是" if _get_field(item, "is_hazardous") else "否",
            _get_field(item, "status").value if hasattr(_get_field(item, "status"), "value") else _get_field(item, "status"),
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            _get_field(item, "notes") or "",
        ]

    rows = [row_converter(item) for item in items]
    return _export_to_xlsx(
        sheets=[
            ExportSheet(
                title="常用",
                headers=headers,
                rows=rows,
                text_columns=set(range(1, len(headers) + 1)),
            )
        ],
        filename_prefix="common_shelf_export",
    )


def export_reagent_orders_xlsx(
    items: list[Any],
    users_map: Optional[dict[int, str]] = None,
) -> StreamingResponse:
    """Export reagent orders."""
    headers = [
        "CAS号",
        "名称",
        "英文名",
        "别名",
        "分类",
        "品牌",
        "规格",
        "数量",
        "单价",
        "申购原因",
        "状态",
        "是否危险品",
        "订购人",
        "申购时间",
        "备注",
    ]

    def row_converter(item: Any, user_map: dict[int, str]) -> list[Any]:
        status_value = _get_field(item, "status")
        order_reason_value = _get_field(item, "order_reason")
        initial_quantity = _get_field(item, "initial_quantity")
        unit = _get_field(item, "unit")
        specification = _get_field(item, "specification")
        if not specification:
            specification = format_specification(initial_quantity, unit)

        return [
            _get_field(item, "cas_number"),
            _get_field(item, "name"),
            _get_field(item, "english_name") or "",
            _get_field(item, "alias") or "",
            _get_field(item, "category") or "",
            _get_field(item, "brand") or "",
            specification or "",
            _get_field(item, "quantity"),
            _get_field(item, "price") or "",
            order_reason_value.value if hasattr(order_reason_value, "value") else order_reason_value,
            status_value.value if hasattr(status_value, "value") else status_value,
            "是" if _get_field(item, "is_hazardous") else "否",
            user_map.get(_get_field(item, "applicant_id"), "") if _get_field(item, "applicant_id") else "",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            _get_field(item, "notes") or "",
        ]

    resolved_users_map = users_map or {}
    rows = [row_converter(item, resolved_users_map) for item in items]
    # 单价列保持数值格式，其余列全部强制文本格式
    text_columns = {idx for idx in range(1, len(headers) + 1) if idx != 9}
    return _export_to_xlsx(
        sheets=[
            ExportSheet(
                title="试剂订单",
                headers=headers,
                rows=rows,
                text_columns=text_columns,
            )
        ],
        filename_prefix="reagent_orders_export",
    )


def export_consumable_orders_xlsx(
    items: list[Any],
    users_map: Optional[dict[int, str]] = None,
) -> StreamingResponse:
    """Export consumable orders."""
    headers = [
        "名称",
        "英文名",
        "规格",
        "数量",
        "单价",
        "状态",
        "订购人",
        "申购时间",
        "备注",
    ]

    def row_converter(item: Any, user_map: dict[int, str]) -> list[Any]:
        status_value = _get_field(item, "status")
        spec = _get_field(item, "specification", "") or ""
        return [
            _get_field(item, "name"),
            _get_field(item, "english_name") or "",
            spec,
            _get_field(item, "quantity"),
            _get_field(item, "price") or "",
            status_value.value if hasattr(status_value, "value") else status_value,
            user_map.get(_get_field(item, "applicant_id"), "") if _get_field(item, "applicant_id") else "",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            _get_field(item, "notes") or "",
        ]

    resolved_users_map = users_map or {}
    rows = [row_converter(item, resolved_users_map) for item in items]
    # 单价列保持数值格式，其余列全部强制文本格式
    text_columns = {idx for idx in range(1, len(headers) + 1) if idx != 5}
    return _export_to_xlsx(
        sheets=[
            ExportSheet(
                title="耗材订单",
                headers=headers,
                rows=rows,
                text_columns=text_columns,
            )
        ],
        filename_prefix="consumable_orders_export",
    )
