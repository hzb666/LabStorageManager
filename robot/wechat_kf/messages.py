"""Message conversion helpers for WeChat customer service sync messages."""

from __future__ import annotations

from typing import Any

CUSTOMER_ORIGIN = 3
TEXT = "text"


def actor_id(open_kfid: str, external_userid: str) -> str:
    return f"wxkf:{open_kfid}:{external_userid}"


def is_customer_message(message: dict[str, Any]) -> bool:
    return (
        _origin(message.get("origin")) == CUSTOMER_ORIGIN
        and isinstance(message.get("external_userid"), str)
        and isinstance(message.get("open_kfid"), str)
    )


def is_customer_text_message(message: dict[str, Any]) -> bool:
    return (
        is_customer_message(message)
        and message.get("msgtype") == TEXT
        and isinstance(message.get("text"), dict)
        and isinstance(message["text"].get("content"), str)
    )


def to_orchestrator_payload(message: dict[str, Any]) -> dict[str, Any]:
    open_kfid = str(message["open_kfid"])
    external_userid = str(message["external_userid"])
    content = str(message["text"]["content"])
    return {
        "msgid": str(message.get("msgid") or ""),
        "aibotid": open_kfid,
        "from": {"userid": actor_id(open_kfid, external_userid)},
        "msgtype": TEXT,
        "text": {"content": content},
        "chattype": "single",
    }


def _origin(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None
