"""Intent and state helpers for the WeCom LabStorageManager robot."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

CAS_PATTERN = re.compile(r"(?<!\d)\d{2,7}-\d{2}-\d(?!\d)")
ID_PATTERN = re.compile(r"\b\d+\b")
BIND_PATTERN = re.compile(r"^绑定\s+(\S+)\s+(.+)$")
QUANTITY_PATTERN_TEXT = r"([0-9]+(?:\.[0-9]+)?)\s*([A-Za-zμµ\u4e00-\u9fff]*)"
USED_PATTERN = re.compile(r"(?:用量|用了|消耗|使用)\s*" + QUANTITY_PATTERN_TEXT)
REMAINING_PATTERN = re.compile(
    r"(?:归还量|剩余量|剩余|剩下|余量|还剩)\s*" + QUANTITY_PATTERN_TEXT
)
SELECTION_PATTERN = re.compile(
    r"^\s*(?:我(?:要|想)?|帮我)?\s*(?:选(?:择)?|借用|归还|还|用)?\s*(?:第)?\s*"
    r"([0-9]{1,3})\s*(?:个|项|号|瓶|条)?\s*$"
)
LOW_STOCK_KEYWORDS = ("低库存", "快没", "不足", "缺货")
BORROW_KEYWORDS = ("借用", "帮我借")
RETURN_KEYWORDS = ("归还", "还瓶", "还药", "还了", "还回")
REAGENT_ORDER_KEYWORDS = ("试剂订单", "试剂申购", "试剂采购", "reagent")
CONSUMABLE_ORDER_KEYWORDS = ("耗材订单", "耗材申购", "耗材采购", "consumable")
COMMON_SHELF_KEYWORDS = ("常用货架", "公共货架", "货架")
MY_BORROW_KEYWORDS = ("我的借用", "我借了", "我借的", "借用中", "我借用的")
MY_REAGENT_ORDER_KEYWORDS = ("我的试剂订单", "我的试剂申购", "我申请的试剂", "我订的试剂")
MY_CONSUMABLE_ORDER_KEYWORDS = ("我的耗材订单", "我的耗材申购", "我申请的耗材", "我订的耗材")
MY_PENDING_STOCKIN_KEYWORDS = ("我的暂存", "我的待补全入库", "待补全入库", "我的待入库", "待入库")
UNBIND_KEYWORDS = ("退出", "登出", "注销", "解绑", "解除绑定", "取消绑定", "换绑", "换账号", "换账户")
CONFIRM_WORDS = {"确认", "确定", "yes", "y"}
CANCEL_WORDS = {"取消", "放弃", "不", "no", "n"}
STATE_TTL_MINUTES = 5
STATUS_LABELS = {
    "not_in_stock": "未入库",
    "in_stock": "在库",
    "run_short": "低库存",
    "borrowed": "已借用",
    "consumed": "已耗尽",
}
BORROWABLE_STATUSES = {"in_stock", "run_short"}
NON_BORROWABLE_STATUSES = {"not_in_stock", "borrowed", "consumed"}
QUERY_STOP_WORDS = (
    "查询",
    "查一下",
    "看看",
    "库存",
    "还有",
    "有没有",
    "有吗",
    "位置",
    "在哪",
    "在哪里",
    "请问",
    "订单",
    "试剂",
    "耗材",
    "常用货架",
    "公共货架",
    "?",
    "？",
)


@dataclass(frozen=True)
class ActorContext:
    userid: str
    chat_key: str
    is_group: bool


def help_text() -> str:
    return "\n".join(
        [
            "可以这样问我：",
            "1. 查询乙醇库存",
            "2. 精确查询乙醇库存",
            "3. 64-17-5 在哪里",
            "4. 有哪些低库存",
            "5. 绑定 alice 密码（请私聊发送）",
            "6. 借用乙醇",
            "7. 归还乙醇 用量20mL / 归还量0.2L",
            "8. 我的借用 / 我的试剂订单 / 我的耗材订单 / 我的暂存",
            "下单、入库、更新、删除等操作暂不支持在机器人里执行。",
        ]
    )


def build_actor(payload: dict[str, Any]) -> ActorContext:
    sender = payload.get("from") if isinstance(payload.get("from"), dict) else {}
    userid = str(sender.get("userid") or "")
    chattype = str(payload.get("chattype") or "single")
    chatid = payload.get("chatid") if isinstance(payload.get("chatid"), str) else ""
    return ActorContext(
        userid=userid,
        chat_key=f"{chattype}:{chatid or 'single'}:{userid}",
        is_group=chattype == "group",
    )


def has_any(text: str, keywords: tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(keyword.lower() in lower for keyword in keywords)


def is_help_request(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"帮助", "help", "指令", "怎么用", "使用说明"}


def is_borrow_intent(text: str) -> bool:
    return has_any(text, BORROW_KEYWORDS) and "借用中" not in text and "谁借" not in text


def is_return_intent(text: str) -> bool:
    return has_any(text, RETURN_KEYWORDS)


def is_unbind_request(text: str) -> bool:
    return has_any(text, UNBIND_KEYWORDS)


def extract_cas(text: str) -> str:
    match = CAS_PATTERN.search(text)
    return match.group(0) if match else ""


def extract_query(text: str) -> str:
    cas_number = extract_cas(text)
    if cas_number:
        return cas_number
    cleaned = text
    for word in QUERY_STOP_WORDS:
        cleaned = cleaned.replace(word, " ")
    value = " ".join(cleaned.split())
    if value:
        return value
    match = ID_PATTERN.search(text)
    return match.group(0) if match else text.strip()


def extract_write_query(text: str, keywords: tuple[str, ...]) -> str:
    cleaned = text
    cleaned = USED_PATTERN.sub(" ", cleaned)
    cleaned = REMAINING_PATTERN.sub(" ", cleaned)
    for word in keywords + ("请", "帮我", "一下"):
        cleaned = cleaned.replace(word, " ")
    return extract_query(cleaned)


def extract_return_quantity(text: str) -> dict[str, Any]:
    remaining = REMAINING_PATTERN.search(text)
    if remaining:
        return _quantity_args("remaining", remaining)
    used = USED_PATTERN.search(text)
    if used:
        return _quantity_args("used", used)
    return {}


def extract_candidate_selection(text: str) -> int | None:
    match = SELECTION_PATTERN.match(text)
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None


def result_ok(result: dict[str, Any]) -> bool:
    payload = result.get("payload")
    return result.get("ok") is True and isinstance(payload, dict) and payload.get("ok") is True


def payload_data(result: dict[str, Any]) -> Any:
    payload = result.get("payload")
    return payload.get("data") if isinstance(payload, dict) else None


def extract_inventory_candidates(
    result: dict[str, Any],
    *,
    borrowable_only: bool = False,
) -> list[dict[str, Any]]:
    candidates = [_candidate(item) for item in _extract_items(payload_data(result))]
    candidates = [candidate for candidate in candidates if candidate]
    if borrowable_only:
        return [candidate for candidate in candidates if _is_borrowable_candidate(candidate)]
    return candidates


def filter_candidates(candidates: list[dict[str, Any]], keyword: str) -> list[dict[str, Any]]:
    if not keyword:
        return candidates
    needle = keyword.lower()
    return [item for item in candidates if needle in item["search_text"].lower()]


def binding_status_text(binding: dict[str, Any] | None) -> str:
    if not binding:
        return "当前企业微信用户还没有绑定 LabStorageManager 账号。"
    user = binding.get("user") if isinstance(binding.get("user"), dict) else {}
    display_name = user.get("full_name") or user.get("username") or binding.get("username")
    return f"当前已绑定：{display_name}。"


def need_bind_text() -> str:
    return "查询、借用和归还都需要先绑定账号。请私聊机器人发送：绑定 用户名 密码。"


def confirm_text(action: str, display: str, args: dict[str, Any]) -> str:
    if action == "inventory_return":
        quantity = _quantity_text(args)
        return f"确认归还 {display}{quantity} 吗？回复“确认”执行，回复“取消”放弃。"
    return f"确认借用 {display} 吗？回复“确认”执行，回复“取消”放弃。"


def expires_at() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=STATE_TTL_MINUTES)).isoformat()


def state_expired(state: dict[str, Any]) -> bool:
    raw_value = state.get("expires_at")
    if not isinstance(raw_value, str):
        return True
    try:
        deadline = datetime.fromisoformat(raw_value)
    except ValueError:
        return True
    return datetime.now(timezone.utc) > deadline


def _extract_items(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("items", "records", "results", "data", "inventories"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return [data] if _read_id(data) is not None else []


def _candidate(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {}
    inventory_id = _read_id(item)
    if inventory_id is None:
        return {}
    display = _display_inventory(item)
    return {
        "inventory_id": inventory_id,
        "display": display,
        "search_text": _search_text(item),
        "remaining_quantity": item.get("remaining_quantity"),
        "initial_quantity": item.get("initial_quantity"),
        "unit": item.get("unit"),
        "specification": item.get("specification"),
        "status": _first_text(item, "status"),
        "temporary_keeper_name": _first_text(item, "temporary_keeper_name"),
    }


def _read_id(item: dict[str, Any]) -> int | None:
    value = item.get("id", item.get("inventory_id"))
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _display_inventory(item: dict[str, Any]) -> str:
    parts = [
        _first_text(item, "name", "name_snapshot", "chemical_name") or "未命名",
        _wrap(_first_text(item, "english_name"), "英文名 "),
        _wrap(_first_text(item, "alias"), "别名 "),
        _wrap(_first_text(item, "cas_number"), "CAS "),
        _wrap(_first_text(item, "brand"), "品牌 "),
        _wrap(_first_text(item, "purity"), "纯度 "),
        _wrap(_first_text(item, "specification"), "规格 "),
        _format_quantity(item),
        _wrap(_first_text(item, "storage_location", "location"), "位置 "),
        _format_status(item),
        _wrap(_first_text(item, "borrower_name"), "借用人 "),
        _wrap(_first_text(item, "temporary_keeper_name"), "暂存人 "),
        _wrap(_first_text(item, "last_borrower_name"), "最近借用人 "),
        _wrap(_first_text(item, "created_at"), "创建时间 "),
        _wrap(_first_text(item, "updated_at"), "更新时间 "),
        _wrap(_first_text(item, "notes"), "备注 "),
    ]
    return "，".join(part for part in parts if part)


def _is_borrowable_candidate(candidate: dict[str, Any]) -> bool:
    status = str(candidate.get("status") or "").strip()
    if status in NON_BORROWABLE_STATUSES:
        return False
    if status and status not in BORROWABLE_STATUSES:
        return False
    if candidate.get("temporary_keeper_name") and status not in BORROWABLE_STATUSES:
        return False
    remaining = _read_float(candidate.get("remaining_quantity"))
    return remaining is None or remaining > 0


def _search_text(item: dict[str, Any]) -> str:
    keys = (
        "name",
        "name_snapshot",
        "chemical_name",
        "english_name",
        "alias",
        "cas_number",
        "storage_location",
        "brand",
    )
    return " ".join(str(item.get(key) or "") for key in keys)


def _format_quantity(item: dict[str, Any]) -> str:
    for key in ("remaining_quantity", "initial_quantity", "quantity"):
        value = item.get(key)
        if value is not None:
            return f"数量 {value}{_first_text(item, 'unit')}"
    return ""


def _read_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_status(item: dict[str, Any]) -> str:
    status = _first_text(item, "status")
    if not status:
        return ""
    return "状态 " + STATUS_LABELS.get(status, status)


def _quantity_text(args: dict[str, Any]) -> str:
    summary = args.get("quantity_summary")
    if isinstance(summary, str) and summary.strip():
        return "，" + summary.strip()
    if "used_quantity" in args:
        return f"，用量 {args['used_quantity']}"
    if "remaining_quantity" in args:
        return f"，剩余 {args['remaining_quantity']}"
    return ""


def _quantity_args(mode: str, match: re.Match[str]) -> dict[str, Any]:
    unit = match.group(2).strip() if match.group(2) else ""
    return {
        "quantity_mode": mode,
        "quantity_value": float(match.group(1)),
        "quantity_unit": unit,
    }


def _first_text(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
    return ""


def _wrap(value: str, prefix: str) -> str:
    return f"{prefix}{value}" if value else ""
