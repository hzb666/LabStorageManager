"""Pydantic schemas for WeChat payloads."""

from pydantic import BaseModel


class WechatMessage(BaseModel):
    to_user_name: str
    from_user_name: str
    create_time: int
    msg_type: str
    content: str | None = None
    msg_id: str | None = None
    event: str | None = None
    event_key: str | None = None
