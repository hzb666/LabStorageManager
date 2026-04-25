"""Build stable detail text for log timeline display search."""
from __future__ import annotations

from typing import Any

REAGENT_ORDER_ACTION_LABELS: dict[str, str] = {
    "create": "创建试剂申购",
    "update": "编辑试剂申购",
    "delete": "删除试剂申购",
    "approve": "审批通过试剂申购",
    "reject": "审批拒绝试剂申购",
    "export": "导出试剂订单",
}

CONSUMABLE_ORDER_ACTION_LABELS: dict[str, str] = {
    "create": "创建耗材申购",
    "update": "编辑耗材申购",
    "delete": "删除耗材申购",
    "approve": "审批通过耗材申购",
    "reject": "审批拒绝耗材申购",
    "arrival_complete": "确认耗材到货",
    "export": "导出耗材订单",
}

USER_OPERATION_ACTION_LABELS: dict[str, str] = {
    "login": "用户登录",
    "logout": "用户退出",
    "change_password": "修改密码",
    "update_profile": "修改用户资料",
    "upload_avatar": "上传头像",
    "delete_avatar": "删除头像",
    "create_user": "创建用户",
    "activate_user": "启用用户",
    "deactivate_user": "停用用户",
    "update_user_role": "修改用户角色",
    "reset_user_password": "重置用户密码",
    "update_user_sensitive_fields": "修改用户敏感信息",
    "create_reagent_brand": "新增品牌",
    "update_reagent_brand": "修改品牌",
    "delete_reagent_brand": "删除品牌",
    "create_chemical_name_map": "新增 CAS 主数据",
    "update_chemical_name_map": "修改 CAS 主数据",
    "delete_chemical_name_map": "删除 CAS 主数据",
    "create_announcement": "新增公告",
    "update_announcement": "修改公告",
    "delete_announcement": "删除公告",
    "update_announcement_pin": "切换公告置顶",
    "update_announcement_visibility": "切换公告可见性",
    "upload_announcement_image": "上传公告图片",
    "delete_announcement_image": "删除公告图片",
    "delete_session": "删除设备会话",
    "delete_other_sessions": "删除其他设备会话",
    "refresh_session": "刷新设备会话",
    "update_session": "修改设备会话",
}

COMMON_SHELF_ACTION_LABELS: dict[str, str] = {
    "stock_in": "常用货架入库",
    "add_bottles": "常用货架加瓶",
    "remove_one": "常用货架扣减",
    "update_group": "修改常用货架分组",
    "update_item": "修改常用货架条目",
    "merge_group": "合并常用货架分组",
    "delete_group": "删除常用货架分组",
    "export": "导出常用货架",
}


def normalize_action_value(value: object) -> str:
    raw_value = value.value if hasattr(value, "value") else value
    return str(raw_value or "").strip()


def clean_detail_value(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def join_detail_parts(*parts: object) -> str:
    return " ".join(part for part in (clean_detail_value(item) for item in parts) if part)


def read_snapshot_value(snapshot: dict[str, Any], full_key: str, compact_key: str) -> Any:
    if full_key in snapshot:
        return snapshot.get(full_key)
    return snapshot.get(compact_key)


def read_snapshot_dict(snapshot: dict[str, Any], full_key: str, compact_key: str) -> dict[str, Any]:
    value = read_snapshot_value(snapshot, full_key, compact_key)
    return value if isinstance(value, dict) else {}


def resolve_display_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    before_snapshot = read_snapshot_dict(snapshot, "before", "bf")
    after_snapshot = read_snapshot_dict(snapshot, "after", "af")
    return after_snapshot or before_snapshot or snapshot


def with_cli_prefix(detail: str, is_cli: bool) -> str:
    normalized_detail = detail.strip()
    if not is_cli:
        return normalized_detail
    if normalized_detail.startswith("[cli] "):
        return normalized_detail
    if not normalized_detail:
        return "[cli]"
    return f"[cli] {normalized_detail}"


def build_reagent_order_detail_text(
    detail_prefix: str,
    order_name: str | None,
    snapshot: dict[str, Any],
) -> str:
    if detail_prefix.endswith("导出试剂订单"):
        export_count = read_snapshot_value(snapshot, "count", "ct") or 0
        return join_detail_parts(detail_prefix, export_count, "条")

    display_snapshot = resolve_display_snapshot(snapshot)
    initial_quantity = read_snapshot_value(display_snapshot, "initial_quantity", "iq")
    unit = read_snapshot_value(display_snapshot, "unit", "un")
    quantity = read_snapshot_value(display_snapshot, "quantity", "qt")
    return join_detail_parts(
        detail_prefix,
        order_name,
        f"{clean_detail_value(initial_quantity)}{clean_detail_value(unit)}",
        f"x{clean_detail_value(quantity)}",
    )


def build_consumable_order_detail_text(
    detail_prefix: str,
    order_name: str | None,
    specification: str | None,
    snapshot: dict[str, Any],
) -> str:
    if detail_prefix.endswith("导出耗材订单"):
        export_count = read_snapshot_value(snapshot, "count", "ct") or 0
        return join_detail_parts(detail_prefix, export_count, "条")

    quantity = read_snapshot_value(snapshot, "quantity", "qt")
    return join_detail_parts(detail_prefix, order_name, specification, f"x{clean_detail_value(quantity)}")


def build_user_operation_detail_text(action_label: str, detail: str | None) -> str:
    normalized_detail = clean_detail_value(detail)
    if normalized_detail:
        return f"{action_label} ({normalized_detail})"
    return action_label


def build_user_operation_search_detail_text(action_label: str) -> str:
    return clean_detail_value(action_label)


def build_inventory_detail_text(
    action_value: str,
    item_name: str | None,
    snapshot: dict[str, Any],
) -> str:
    if action_value == "inventory_update":
        return join_detail_parts("更新库存", item_name)
    if action_value == "inventory_delete":
        return join_detail_parts("删除库存", item_name)
    if action_value == "inventory_export":
        export_count = read_snapshot_value(snapshot, "count", "ct") or 0
        return join_detail_parts("导出库存", export_count, "条")

    initial_quantity = read_snapshot_value(snapshot, "initial_quantity", "iq")
    unit = read_snapshot_value(snapshot, "unit", "un")
    return join_detail_parts(
        "入库",
        item_name,
        f"{clean_detail_value(initial_quantity)}{clean_detail_value(unit)}",
    )


def build_common_shelf_detail_text(
    action_value: str,
    item_name: str | None,
    snapshot: dict[str, Any],
) -> str:
    if action_value == "export":
        export_count = read_snapshot_value(snapshot, "count", "ct") or 0
        return join_detail_parts("导出常用货架", export_count, "条")

    action_label = COMMON_SHELF_ACTION_LABELS.get(action_value, action_value)
    return join_detail_parts(action_label, item_name)


def build_borrow_detail_text(
    inventory_name: str | None,
    quantity_borrowed: object,
    unit: str | None,
    is_returned: bool,
    quantity_returned: object = None,
) -> str:
    unit_text = clean_detail_value(unit)
    borrow_quantity = join_detail_parts(quantity_borrowed, unit_text)
    detail = join_detail_parts("借用", inventory_name, borrow_quantity)
    if is_returned:
        return_quantity = join_detail_parts(quantity_returned, unit_text)
        return f"{detail}, 已归还 {return_quantity}".strip()
    return f"{detail}, 未归还".strip()
