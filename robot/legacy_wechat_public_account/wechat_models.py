"""Wechat bot SQLModel tables and inbound message DTOs."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import Column, Index, Text, text
from sqlmodel import JSON, Field, SQLModel

from app.core.time_utils import get_utc_now


WECHAT_MSG_TEXT = "text"
WECHAT_MSG_EVENT = "event"
WECHAT_EVENT_SUBSCRIBE = "subscribe"
WECHAT_EVENT_UNSUBSCRIBE = "unsubscribe"

CHAT_ROLE_USER = "user"
CHAT_ROLE_ASSISTANT = "assistant"

CHAT_SESSION_STATUS_ACTIVE = "active"
CHAT_SESSION_STATUS_ARCHIVED = "archived"

MESSAGE_SOURCE_WECHAT = "wechat"


class WechatInboundMessage(BaseModel):
    """Parsed Wechat XML message used by the service layer."""

    to_user_name: str
    from_user_name: str
    create_time: int
    msg_type: str
    content: str = ""
    msg_id: str | None = None
    event: str | None = None
    event_key: str | None = None
    raw_payload_hash: str


class WechatUser(SQLModel, table=True):
    """Wechat subscriber mapped by OpenID."""

    __tablename__ = "wechat_users"

    id: Optional[int] = Field(default=None, primary_key=True)
    openid: str = Field(unique=True, index=True, max_length=128)
    unionid: str | None = Field(default=None, index=True, max_length=128)
    nickname: str | None = Field(default=None, max_length=255)
    subscribe_status: str = Field(default="subscribed", max_length=32)
    first_seen_at: datetime = Field(default_factory=get_utc_now)
    last_seen_at: datetime = Field(default_factory=get_utc_now)
    raw_profile_json: str | None = Field(default=None, sa_column=Column(Text, nullable=True))


class WechatUserMemory(SQLModel, table=True):
    """Long-term user memory maintained outside the passive reply path."""

    __tablename__ = "wechat_user_memories"

    user_id: int = Field(foreign_key="wechat_users.id", primary_key=True)
    profile_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    preference_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    summary_text: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class WechatChatSession(SQLModel, table=True):
    """Single active chat session per Wechat user."""

    __tablename__ = "wechat_chat_sessions"
    __table_args__ = (
        Index("ix_wechat_chat_sessions_user_status", "user_id", "status"),
        Index(
            "ux_wechat_chat_sessions_active_user",
            "user_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="wechat_users.id", index=True)
    status: str = Field(default=CHAT_SESSION_STATUS_ACTIVE, max_length=32)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class WechatChatMessage(SQLModel, table=True):
    """Conversation message persisted for context and audit."""

    __tablename__ = "wechat_chat_messages"
    __table_args__ = (
        Index("ix_wechat_chat_messages_session_created", "session_id", "created_at"),
        Index("ix_wechat_chat_messages_user_created", "user_id", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="wechat_chat_sessions.id", index=True)
    user_id: int = Field(foreign_key="wechat_users.id", index=True)
    role: str = Field(max_length=32)
    content: str = Field(sa_column=Column(Text, nullable=False))
    source: str = Field(default=MESSAGE_SOURCE_WECHAT, max_length=32)
    wechat_msg_id: str | None = Field(default=None, index=True, max_length=128)
    created_at: datetime = Field(default_factory=get_utc_now)


class ProcessedWechatEvent(SQLModel, table=True):
    """Idempotency record for Wechat retries."""

    __tablename__ = "processed_wechat_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    dedupe_key: str = Field(unique=True, index=True, max_length=255)
    openid: str = Field(index=True, max_length=128)
    msg_type: str = Field(max_length=32)
    reply_text: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )
