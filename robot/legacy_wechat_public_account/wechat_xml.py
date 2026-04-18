"""Safe-enough Wechat XML parsing and reply rendering."""

from __future__ import annotations

from hashlib import sha256
from time import time
from xml.etree import ElementTree

from app.models.wechat import WechatInboundMessage

FORBIDDEN_XML_MARKERS = (b"<!doctype", b"<!entity")
MAX_REPLY_CHARS = 1200


class WechatXmlError(ValueError):
    """Raised when inbound XML cannot be accepted."""


def parse_wechat_xml(payload: bytes, *, max_bytes: int) -> WechatInboundMessage:
    """Parse a Wechat XML request with a hard size cap and DTD guard."""

    if not payload:
        raise WechatXmlError("Empty request body")
    if len(payload) > max_bytes:
        raise WechatXmlError("Request body is too large")
    lower_payload = payload.lower()
    if any(marker in lower_payload for marker in FORBIDDEN_XML_MARKERS):
        raise WechatXmlError("DTD and entity declarations are not allowed")

    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError as exc:
        raise WechatXmlError("Malformed XML") from exc

    return WechatInboundMessage(
        to_user_name=_required_text(root, "ToUserName"),
        from_user_name=_required_text(root, "FromUserName"),
        create_time=_required_int(root, "CreateTime"),
        msg_type=_required_text(root, "MsgType").lower(),
        content=_optional_text(root, "Content"),
        msg_id=_optional_text(root, "MsgId") or None,
        event=(_optional_text(root, "Event") or None),
        event_key=(_optional_text(root, "EventKey") or None),
        raw_payload_hash=sha256(payload).hexdigest(),
    )


def build_text_reply_xml(*, to_user: str, from_user: str, content: str) -> str:
    """Render a Wechat passive text reply."""

    safe_content = content.strip()[:MAX_REPLY_CHARS]
    return (
        "<xml>"
        f"<ToUserName>{_cdata(to_user)}</ToUserName>"
        f"<FromUserName>{_cdata(from_user)}</FromUserName>"
        f"<CreateTime>{int(time())}</CreateTime>"
        "<MsgType><![CDATA[text]]></MsgType>"
        f"<Content>{_cdata(safe_content)}</Content>"
        "</xml>"
    )


def _required_text(root: ElementTree.Element, tag: str) -> str:
    value = _optional_text(root, tag).strip()
    if not value:
        raise WechatXmlError(f"Missing required field: {tag}")
    return value


def _optional_text(root: ElementTree.Element, tag: str) -> str:
    node = root.find(tag)
    if node is None or node.text is None:
        return ""
    return node.text


def _required_int(root: ElementTree.Element, tag: str) -> int:
    value = _required_text(root, tag)
    try:
        return int(value)
    except ValueError as exc:
        raise WechatXmlError(f"Invalid integer field: {tag}") from exc


def _cdata(value: str) -> str:
    return "<![CDATA[" + value.replace("]]>", "]]]]><![CDATA[>") + "]]>"
