"""Reply builders for Enterprise WeChat intelligent robot messages."""

from __future__ import annotations

MAX_TEXT_REPLY_CHARS = 3500
MAX_MARKDOWN_REPLY_CHARS = 8000


def clamp_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 20].rstrip() + "\n...（内容已截断）"


def text_reply(content: str) -> dict:
    return {"msgtype": "text", "text": {"content": clamp_text(content, MAX_TEXT_REPLY_CHARS)}}


def markdown_reply(content: str) -> dict:
    return {
        "msgtype": "markdown",
        "markdown": {"content": clamp_text(content, MAX_MARKDOWN_REPLY_CHARS)},
    }

