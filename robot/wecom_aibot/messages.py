"""Message parsing for Enterprise WeChat intelligent robot callbacks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

TEXT = "text"
EVENT = "event"
GROUP = "group"
SINGLE = "single"


class UnsupportedWecomMessageError(ValueError):
    """Raised for message types that the first production slice does not handle."""


@dataclass(frozen=True)
class WecomInboundMessage:
    msgid: str
    aibotid: str
    chattype: str
    userid: str
    content: str
    response_url: str | None = None
    chatid: str | None = None


def strip_bot_mention(content: str) -> str:
    text = content.strip()
    while text.startswith("@"):
        parts = text.split(maxsplit=1)
        if len(parts) == 1:
            return ""
        text = parts[1].strip()
    return text


def parse_text_message(payload: dict[str, Any]) -> WecomInboundMessage:
    msgtype = payload.get("msgtype")
    if msgtype != TEXT:
        raise UnsupportedWecomMessageError(f"unsupported message type: {msgtype or 'unknown'}")

    sender = payload.get("from")
    text = payload.get("text")
    if not isinstance(sender, dict) or not isinstance(text, dict):
        raise ValueError("invalid text message payload")

    content = text.get("content")
    userid = sender.get("userid")
    if not isinstance(content, str) or not isinstance(userid, str):
        raise ValueError("invalid text message fields")

    return WecomInboundMessage(
        msgid=str(payload.get("msgid") or ""),
        aibotid=str(payload.get("aibotid") or ""),
        chattype=str(payload.get("chattype") or SINGLE),
        userid=userid,
        chatid=payload.get("chatid") if isinstance(payload.get("chatid"), str) else None,
        response_url=(
            payload.get("response_url") if isinstance(payload.get("response_url"), str) else None
        ),
        content=strip_bot_mention(content),
    )


def is_enter_chat_event(payload: dict[str, Any]) -> bool:
    event_type = payload.get("eventtype") or payload.get("event")
    if payload.get("msgtype") == EVENT and event_type == "enter_chat":
        return True
    return event_type == "enter_chat"

