"""Reply builders for Enterprise WeChat intelligent robot messages."""

from __future__ import annotations

import re

MAX_TEXT_REPLY_CHARS = 3500
MAX_MARKDOWN_REPLY_CHARS = 8000
EMPTY_SANITIZED_REPLY = "我没有拿到可发送的回复，请换个问法再试。"
THINK_BLOCK_PATTERN = re.compile(r"<think\b[^>]*>.*?</think\s*>", re.IGNORECASE | re.DOTALL)
THINK_PREFIX_PATTERN = re.compile(r"^.*?</think\s*>", re.IGNORECASE | re.DOTALL)
THINK_UNCLOSED_PATTERN = re.compile(r"<think\b[^>]*>.*$", re.IGNORECASE | re.DOTALL)
EXCESS_BLANK_LINES_PATTERN = re.compile(r"\n{3,}")


def clamp_text(value: str, limit: int) -> str:
    sanitized = sanitize_reply_text(value)
    if not sanitized and value.strip():
        sanitized = EMPTY_SANITIZED_REPLY
    if len(sanitized) <= limit:
        return sanitized
    return sanitized[: limit - 20].rstrip() + "\n...（内容已截断）"


def sanitize_reply_text(value: str) -> str:
    cleaned = THINK_BLOCK_PATTERN.sub("", value)
    cleaned = THINK_PREFIX_PATTERN.sub("", cleaned)
    cleaned = THINK_UNCLOSED_PATTERN.sub("", cleaned)
    cleaned = EXCESS_BLANK_LINES_PATTERN.sub("\n\n", cleaned)
    return cleaned.strip()


def text_reply(content: str) -> dict:
    return {"msgtype": "text", "text": {"content": clamp_text(content, MAX_TEXT_REPLY_CHARS)}}


def markdown_reply(content: str) -> dict:
    return {
        "msgtype": "markdown",
        "markdown": {"content": clamp_text(content, MAX_MARKDOWN_REPLY_CHARS)},
    }
