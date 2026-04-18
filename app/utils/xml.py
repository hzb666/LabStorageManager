"""XML helpers for WeChat callback."""

from xml.etree import ElementTree as ET

from app.schemas.wechat import WechatMessage


def parse_wechat_xml(payload: str) -> WechatMessage:
    root = ET.fromstring(payload)

    def _text(name: str) -> str | None:
        node = root.find(name)
        return node.text if node is not None else None

    return WechatMessage(
        to_user_name=_text("ToUserName") or "",
        from_user_name=_text("FromUserName") or "",
        create_time=int(_text("CreateTime") or 0),
        msg_type=(_text("MsgType") or "").lower(),
        content=_text("Content"),
        msg_id=_text("MsgId"),
        event=(_text("Event") or "").lower() or None,
        event_key=_text("EventKey"),
    )


def build_text_reply_xml(to_user: str, from_user: str, content: str, create_time: int) -> str:
    xml = f"""<xml>
<ToUserName><![CDATA[{to_user}]]></ToUserName>
<FromUserName><![CDATA[{from_user}]]></FromUserName>
<CreateTime>{create_time}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[{content}]]></Content>
</xml>"""
    return xml
