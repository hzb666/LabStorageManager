"""Format MCP/CLI results as safe short Chinese replies for WeCom users."""

from __future__ import annotations

import re
from typing import Any

MAX_ITEMS = 5
MAX_DIAGNOSTIC_TEXT_LENGTH = 120
COLLECTION_KEYS = (
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
STATUS_LABELS = {
    "not_in_stock": "未入库",
    "in_stock": "在库",
    "run_short": "低库存",
    "borrowed": "已借用",
    "consumed": "已耗尽",
}
ERROR_MESSAGES = {
    2: "认证失败或登录已过期，请私聊机器人重新绑定账号。",
    3: "当前账号没有权限执行这个查询。",
    4: "没有找到对应记录。",
    5: "请求太频繁，请稍后再试。",
    7: "参数不完整或格式不正确。",
    8: "参数不完整或格式不正确。",
    9: "后端服务暂时不可达，请稍后再试。",
}
SAFE_FIELD_LABELS = {
    "name": "名称",
    "name_snapshot": "名称",
    "latest_name_snapshot": "最近名称",
    "chemical_name": "名称",
    "title": "标题",
    "english_name": "英文名",
    "map_english_name": "英文名",
    "cas_number": "CAS",
    "alias": "别名",
    "alias_1": "别名1",
    "alias_2": "别名2",
    "alias_3": "别名3",
    "category": "分类",
    "map_category": "分类",
    "product_number": "货号",
    "brand": "品牌",
    "purity": "纯度",
    "specification": "规格",
    "specification_text": "规格",
    "initial_quantity": "初始量",
    "remaining_quantity": "剩余量",
    "remaining_percent": "剩余比例",
    "total_remaining": "总剩余量",
    "quantity": "数量",
    "bottle_count": "瓶数",
    "count": "数量",
    "unit": "单位",
    "storage_location": "位置",
    "location": "位置",
    "location_count": "位置数",
    "status": "状态",
    "borrower_name": "借用人",
    "temporary_keeper_name": "暂存人",
    "last_borrower_name": "最近借用人",
    "created_by_name": "创建人",
    "requester_name": "申请人",
    "applicant_name": "申请人",
    "price": "价格",
    "order_reason": "申购原因",
    "communication": "沟通记录",
    "notes": "备注",
    "description": "说明",
    "snippet": "摘要",
    "date": "日期",
    "created_at": "创建时间",
    "updated_at": "更新时间",
    "stockin_time": "入库时间",
    "borrow_time": "借用时间",
    "link": "链接",
    "url": "链接",
    "cli": "CLI",
    "robot": "机器人能力",
    "requires_binding": "需要绑定",
    "write": "写操作",
    "is_hazardous": "危险品",
    "exists_in_inventory": "库存存在",
}
SAFE_FIELD_ORDER = tuple(SAFE_FIELD_LABELS.keys())
QUANTITY_KEYS = {
    "initial_quantity",
    "remaining_quantity",
    "total_remaining",
    "quantity",
}
INTERNAL_EXACT_KEYS = {
    "id",
    "inventory_id",
    "order_id",
    "user_id",
    "borrower_id",
    "temporary_keeper_id",
    "last_borrower_id",
    "created_by_id",
    "applicant_id",
    "requester_id",
    "group_key",
    "msgid",
    "chatid",
    "aibotid",
    "open_kfid",
    "external_userid",
    "userid",
    "corp_id",
    "bot_id",
    "request_id",
    "status_code",
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "session",
    "password",
    "secret",
    "credential",
    "stderr",
    "stdout",
    "traceback",
    "stack",
    "headers",
    "config_path",
    "internal_code",
    "msg_signature",
    "nonce",
    "timestamp",
    "encoding_aes_key",
}
INTERNAL_KEY_PARTS = (
    "token",
    "password",
    "secret",
    "credential",
    "session",
    "authorization",
    "cookie",
    "traceback",
    "stderr",
    "stdout",
    "headers",
    "internal_code",
    "pinyin",
    "initials",
    "normalized",
    "signature",
    "encoding_aes",
    "cipher",
    "encrypt",
    "external_userid",
    "userid",
    "openid",
)
SAFE_DIAGNOSTIC_KEYS = (
    "code",
    "category",
    "status_code",
    "retryable",
    "fields",
    "llm_hint",
    "request_id",
)
SENSITIVE_VALUE_PATTERN = re.compile(
    r"(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,}\.)",
    re.IGNORECASE,
)


def format_tool_result(result: dict[str, Any], *, title: str, empty_text: str) -> str:
    return format_safe_facts(build_safe_facts(result, title=title, empty_text=empty_text))


def build_safe_facts(result: dict[str, Any], *, title: str, empty_text: str) -> dict[str, Any]:
    """Build a safe, user-facing facts payload from a CLI/MCP result."""
    if not _is_success(result):
        facts: dict[str, Any] = {"text": _format_error(result), "empty": False}
        diagnostic = _extract_safe_error_diagnostic(result)
        if diagnostic:
            facts["diagnostic"] = diagnostic
        return facts

    data = _extract_payload_data(result)
    items = _extract_items(data)
    total = _extract_total(data, len(items))
    if items:
        safe_items = [_safe_record(item) for item in items[:MAX_ITEMS]]
        safe_items = [item for item in safe_items if item]
        if safe_items:
            return {"title": title, "items": safe_items, "total": total, "empty_text": empty_text}

    if _is_empty_collection(data, total):
        return {"text": empty_text, "empty": True}

    if isinstance(data, dict) and data:
        record = _safe_record(data)
        if record:
            return {"title": title, "record": record, "empty_text": empty_text}
    return {"text": empty_text, "empty": True}


def format_safe_facts(facts: dict[str, Any]) -> str:
    text = facts.get("text")
    if isinstance(text, str):
        return text

    title = str(facts.get("title") or "查询结果")
    lines = [f"{title}："]
    items = facts.get("items")
    if isinstance(items, list) and items:
        lines.extend(_format_item(item, index) for index, item in enumerate(items, 1))
        total = facts.get("total")
        if isinstance(total, int) and total > len(items):
            lines.append(f"... 共 {total} 条，已显示前 {MAX_ITEMS} 条。")
        return "\n".join(lines)

    record = facts.get("record")
    if isinstance(record, dict) and record:
        lines.append(_format_record(record))
        return "\n".join(lines)
    return str(facts.get("empty_text") or "没有查到匹配记录。")


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
    for key in COLLECTION_KEYS:
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
    return total == 0 and any(isinstance(data.get(key), list) for key in COLLECTION_KEYS)


def _format_error(result: dict[str, Any]) -> str:
    exit_code = result.get("exit_code")
    if isinstance(exit_code, int) and exit_code in ERROR_MESSAGES:
        return ERROR_MESSAGES[exit_code]
    error = result.get("error")
    if isinstance(error, dict) and error.get("code") in {"CLI_TIMEOUT", "NETWORK_ERROR"}:
        return "后端服务暂时不可达，请稍后再试。"
    return "系统异常，请稍后再试。"


def _extract_safe_error_diagnostic(result: dict[str, Any]) -> dict[str, Any]:
    diagnostic: dict[str, Any] = {}
    exit_code = result.get("exit_code")
    if isinstance(exit_code, int):
        diagnostic["exit_code"] = exit_code

    for error in _iter_error_payloads(result):
        if not isinstance(error, dict):
            continue
        for key in SAFE_DIAGNOSTIC_KEYS:
            value = _safe_diagnostic_value(key, error.get(key))
            if value not in (None, [], {}):
                diagnostic[key] = value
    return diagnostic


def _iter_error_payloads(result: dict[str, Any]):
    yield result.get("error")
    payload = result.get("payload")
    if isinstance(payload, dict):
        yield payload.get("error")


def _safe_diagnostic_value(key: str, value: Any) -> Any:
    if key == "status_code":
        return value if isinstance(value, int) and 100 <= value <= 599 else None
    if key == "retryable":
        return value if isinstance(value, bool) else None
    if key == "fields":
        return _safe_diagnostic_fields(value)
    return _safe_diagnostic_text(value)


def _safe_diagnostic_fields(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    fields: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        field: dict[str, str] = {}
        for key in ("name", "reason", "message"):
            text = _safe_diagnostic_text(item.get(key))
            if text:
                field[key] = text
        if field:
            fields.append(field)
    return fields


def _safe_diagnostic_text(value: Any) -> str | None:
    if not isinstance(value, (str, int)):
        return None
    text = " ".join(str(value).strip().split())
    if not text:
        return None
    text = SENSITIVE_VALUE_PATTERN.sub("[redacted]", text)
    if len(text) > MAX_DIAGNOSTIC_TEXT_LENGTH:
        return f"{text[:MAX_DIAGNOSTIC_TEXT_LENGTH - 3]}..."
    return text


def _format_item(item: Any, index: int) -> str:
    if not isinstance(item, dict):
        return f"{index}. {item}"
    return f"{index}. {_format_record(item)}"


def _format_record(record: dict[str, Any]) -> str:
    parts: list[str] = []
    for label, value in record.items():
        if label in {"名称", "标题"}:
            parts.append(str(value))
        else:
            parts.append(f"{label} {value}")
    return "，".join(parts) if parts else "无可展示信息"


def _safe_record(record: Any) -> dict[str, str]:
    if not isinstance(record, dict):
        return {"名称": str(record)} if record is not None else {}
    flattened = _flatten_record(record)
    safe: dict[str, str] = {}
    for key in SAFE_FIELD_ORDER:
        if _is_internal_key(key) or key not in flattened:
            continue
        if key == "unit" and _has_quantity(flattened):
            continue
        value = _format_value(key, flattened[key], flattened)
        if value:
            safe[SAFE_FIELD_LABELS[key]] = value
    return safe


def _flatten_record(record: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for nested_key in ("group", "display"):
        nested = record.get(nested_key)
        if isinstance(nested, dict):
            merged.update(nested)
    for key, value in record.items():
        if key in {"group", "display"}:
            continue
        if isinstance(value, (dict, list, tuple, set)):
            continue
        merged[key] = value
    return merged


def _format_value(key: str, value: Any, record: dict[str, Any]) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped or _is_sensitive_value(stripped):
            return ""
        if key == "status":
            return STATUS_LABELS.get(stripped, stripped)
        return stripped
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return _format_number_value(key, value, record)
    return ""


def _format_number_value(key: str, value: int | float, record: dict[str, Any]) -> str:
    if key == "remaining_percent":
        percent = value * 100 if 0 <= value <= 1 else value
        return f"{percent:g}%"
    if key == "bottle_count":
        return f"{value:g}瓶"
    if key in QUANTITY_KEYS:
        unit = str(record.get("unit") or "").strip()
        return f"{value:g}{unit}"
    return f"{value:g}"


def _has_quantity(record: dict[str, Any]) -> bool:
    return any(record.get(key) not in (None, "") for key in QUANTITY_KEYS | {"bottle_count", "count"})


def _is_internal_key(key: str) -> bool:
    normalized = key.strip().casefold()
    if normalized in INTERNAL_EXACT_KEYS or normalized.endswith("_id"):
        return True
    return any(part in normalized for part in INTERNAL_KEY_PARTS)


def _is_sensitive_value(value: str) -> bool:
    lowered = value.casefold()
    sensitive_words = ("access_token", "refresh_token", "api key", "apikey", "密钥", "密码")
    return any(word in lowered for word in sensitive_words) or bool(SENSITIVE_VALUE_PATTERN.search(value))
