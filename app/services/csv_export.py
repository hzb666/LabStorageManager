"""CSV export service for unified export functionality."""
import csv
import io
from typing import Any, Callable, Optional

from fastapi.responses import StreamingResponse

from app.core.time_utils import get_utc_now, to_china_time
from app.services.csv_utils import escape_csv_formula
from app.services.spec_utils import format_specification


def _get_field(item: Any, field: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(field, default)
    return getattr(item, field, default)


def export_to_csv(
    items: list[Any],
    headers: list[str],
    row_converter: Callable[[Any, dict[int, str]], list[Any]],
    filename_prefix: str,
    users_map: Optional[dict[int, str]] = None,
) -> StreamingResponse:
    """
    Generate CSV export response.

    Args:
        items: List of items to export
        headers: List of CSV header strings
        row_converter: Function that converts an item to a CSV row
        filename_prefix: Prefix for the exported filename
        users_map: Optional mapping of user IDs to usernames (for performance)

    Returns:
        StreamingResponse with CSV content
    """
    output = io.StringIO()
    output.write("\ufeff")  # BOM for UTF-8
    writer = csv.writer(output)
    writer.writerow(headers)

    resolved_users_map = users_map or {}
    for item in items:
        row = row_converter(item, resolved_users_map)
        writer.writerow(row)

    output.seek(0)
    filename = f"{filename_prefix}_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def export_inventory_csv(
    items: list[Any],
    users_map: Optional[dict[int, str]] = None,
) -> StreamingResponse:
    """Export inventory items (excluding common shelf items)."""
    headers = [
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

    def row_converter(item: Any, _: dict[int, str]) -> list[Any]:
        return [
            escape_csv_formula(_get_field(item, "cas_number")),
            escape_csv_formula(_get_field(item, "name")),
            escape_csv_formula(_get_field(item, "english_name") or ""),
            escape_csv_formula(_get_field(item, "alias") or ""),
            escape_csv_formula(_get_field(item, "category") or ""),
            escape_csv_formula(_get_field(item, "brand") or ""),
            escape_csv_formula(_get_field(item, "storage_location") or ""),
            _get_field(item, "initial_quantity"),
            _get_field(item, "remaining_quantity"),
            _get_field(item, "unit"),
            _get_field(item, "status").value if hasattr(_get_field(item, "status"), "value") else _get_field(item, "status"),
            "是" if _get_field(item, "is_hazardous") else "否",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            escape_csv_formula(_get_field(item, "notes") or ""),
        ]

    return export_to_csv(
        items=items,
        headers=headers,
        row_converter=row_converter,
        filename_prefix="inventory_export",
        users_map=users_map,
    )


def export_common_shelf_csv(
    items: list[Any],
    users_map: Optional[dict[int, str]] = None,
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

    def row_converter(item: Any, user_map: dict[int, str]) -> list[Any]:
        return [
            escape_csv_formula(_get_field(item, "cas_number")),
            escape_csv_formula(_get_field(item, "name")),
            escape_csv_formula(_get_field(item, "english_name") or ""),
            escape_csv_formula(_get_field(item, "alias") or ""),
            escape_csv_formula(_get_field(item, "category") or ""),
            escape_csv_formula(_get_field(item, "brand") or ""),
            escape_csv_formula(_get_field(item, "storage_location") or ""),
            escape_csv_formula(_get_field(item, "specification") or ""),
            _get_field(item, "total_bottles"),
            _get_field(item, "available_bottles"),
            _get_field(item, "consumed_bottles"),
            "是" if _get_field(item, "is_hazardous") else "否",
            _get_field(item, "status").value if hasattr(_get_field(item, "status"), "value") else _get_field(item, "status"),
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            escape_csv_formula(_get_field(item, "notes") or ""),
        ]

    return export_to_csv(
        items=items,
        headers=headers,
        row_converter=row_converter,
        filename_prefix="common_shelf_export",
        users_map=users_map,
    )


def export_reagent_orders_csv(
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
            escape_csv_formula(_get_field(item, "cas_number")),
            escape_csv_formula(_get_field(item, "name")),
            escape_csv_formula(_get_field(item, "english_name") or ""),
            escape_csv_formula(_get_field(item, "alias") or ""),
            escape_csv_formula(_get_field(item, "category") or ""),
            escape_csv_formula(_get_field(item, "brand") or ""),
            escape_csv_formula(specification or ""),
            _get_field(item, "quantity"),
            _get_field(item, "price") or "",
            order_reason_value.value if hasattr(order_reason_value, "value") else order_reason_value,
            status_value.value if hasattr(status_value, "value") else status_value,
            "是" if _get_field(item, "is_hazardous") else "否",
            user_map.get(_get_field(item, "applicant_id"), "") if _get_field(item, "applicant_id") else "",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            escape_csv_formula(_get_field(item, "notes") or ""),
        ]

    return export_to_csv(
        items=items,
        headers=headers,
        row_converter=row_converter,
        filename_prefix="reagent_orders_export",
        users_map=users_map,
    )


def export_consumable_orders_csv(
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
            escape_csv_formula(_get_field(item, "name")),
            escape_csv_formula(_get_field(item, "english_name") or ""),
            escape_csv_formula(spec),
            _get_field(item, "quantity"),
            _get_field(item, "price") or "",
            status_value.value if hasattr(status_value, "value") else status_value,
            user_map.get(_get_field(item, "applicant_id"), "") if _get_field(item, "applicant_id") else "",
            to_china_time(_get_field(item, "created_at")).strftime("%Y-%m-%d %H:%M:%S") if _get_field(item, "created_at") else "",
            escape_csv_formula(_get_field(item, "notes") or ""),
        ]

    return export_to_csv(
        items=items,
        headers=headers,
        row_converter=row_converter,
        filename_prefix="consumable_orders_export",
        users_map=users_map,
    )
