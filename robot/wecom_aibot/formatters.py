"""Format MCP/CLI results as short Chinese replies for WeCom users."""

from __future__ import annotations

from typing import Any

MAX_ITEMS = 5
ERROR_MESSAGES = {
    2: "认证失败或登录已过期，请私聊机器人重新绑定账号。",
    3: "当前账号没有权限执行这个查询。",
    4: "没有找到对应记录。",
    5: "请求太频繁，请稍后再试。",
    7: "参数不完整或格式不正确。",
    8: "参数不完整或格式不正确。",
    9: "后端服务暂时不可达，请稍后再试。",
}


def format_tool_result(result: dict[str, Any], *, title: str, empty_text: str) -> str:
    if not _is_success(result):
        return _format_error(result)

    data = _extract_payload_data(result)
    items = _extract_items(data)
    total = _extract_total(data, len(items))
    if items:
        lines = [f"{title}："]
        lines.extend(_format_item(item, index) for index, item in enumerate(items[:MAX_ITEMS], 1))
        if total > len(items[:MAX_ITEMS]):
            lines.append(f"... 共 {total} 条，已显示前 {MAX_ITEMS} 条。")
        return "\n".join(lines)

    if _is_empty_collection(data, total):
        return empty_text

    if isinstance(data, dict) and data:
        return f"{title}：\n" + _format_record(data)
    return empty_text


def _is_success(result: dict[str, Any]) -> bool:
    if result.get("ok") is not True:
        return False
    payload = result.get("payload")
    if isinstance(payload, dict):
        return payload.get("ok") is True
    return True


def _extract_payload_data(result: dict[str, Any]) -> Any:
    payload = result.get("payload")
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return result.get("data", result)


def _extract_items(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in (
        "items",
        "records",
        "results",
        "organic",
        "data",
        "orders",
        "inventories",
        "groups",
        "tools",
    ):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def _extract_total(data: Any, fallback: int) -> int:
    if isinstance(data, dict):
        for key in ("total", "count", "total_count"):
            value = data.get(key)
            if isinstance(value, int):
                return value
    return fallback


def _is_empty_collection(data: Any, total: int) -> bool:
    if not isinstance(data, dict):
        return False
    if data.get("exists_in_inventory") is False:
        return True
    collection_keys = (
        "items",
        "records",
        "results",
        "organic",
        "data",
        "orders",
        "inventories",
        "groups",
        "tools",
    )
    return total == 0 and any(isinstance(data.get(key), list) for key in collection_keys)


def _format_error(result: dict[str, Any]) -> str:
    exit_code = result.get("exit_code")
    if isinstance(exit_code, int) and exit_code in ERROR_MESSAGES:
        return ERROR_MESSAGES[exit_code]
    error = result.get("error")
    if isinstance(error, dict) and error.get("code") in {"CLI_TIMEOUT", "NETWORK_ERROR"}:
        return "后端服务暂时不可达，请稍后再试。"
    return "系统异常，请稍后再试。"


def _format_item(item: Any, index: int) -> str:
    if not isinstance(item, dict):
        return f"{index}. {item}"
    record = item.get("group") if isinstance(item.get("group"), dict) else item
    return f"{index}. {_format_record(record)}"


def _format_record(record: dict[str, Any]) -> str:
    parts = [
        _first_text(record, "name", "name_snapshot", "chemical_name", "title") or "未命名",
        _wrap(_first_text(record, "cas_number"), "CAS "),
        _wrap(_first_text(record, "product_number"), "货号 "),
        _format_quantity(record),
        _wrap(_first_text(record, "storage_location", "location"), "位置 "),
        _wrap(_first_text(record, "status"), "状态 "),
        _wrap(_first_text(record, "brand"), "品牌 "),
        _wrap(_first_text(record, "date"), "日期 "),
        _wrap(_first_text(record, "link", "url"), "链接 "),
        _wrap(_first_text(record, "description"), "说明 "),
        _wrap(_first_text(record, "snippet"), "摘要 "),
        _wrap(_first_text(record, "cli"), "CLI "),
    ]
    return "，".join(part for part in parts if part)


def _format_quantity(record: dict[str, Any]) -> str:
    for key in ("remaining_quantity", "initial_quantity", "quantity", "bottle_count", "count"):
        value = record.get(key)
        if value is not None:
            unit = _first_text(record, "unit")
            if not unit and key == "bottle_count":
                unit = "瓶"
            return f"数量 {value}{unit}"
    return ""


def _first_text(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
    return ""


def _wrap(value: str, prefix: str) -> str:
    return f"{prefix}{value}" if value else ""
