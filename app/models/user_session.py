"""
User Session Model - Device and IP Login Management
"""
from datetime import datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now

DEVICE_ID_MAX_LENGTH = 128
DEVICE_NAME_MAX_LENGTH = 200
IP_ADDRESS_MAX_LENGTH = 64
USER_AGENT_MAX_LENGTH = 2048
TOKEN_HASH_MAX_LENGTH = 128


class UserSession(SQLModel, table=True):
    """User session model for device and IP login management"""
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_user_sessions_user_last_active", "user_id", "last_active_at"),
        Index("ix_user_sessions_user_device", "user_id", "device_id"),
        Index("ix_user_sessions_user_expires", "user_id", "expires_at"),
        Index("ix_user_sessions_user_ip", "user_id", "ip_address"),
        Index("ix_user_sessions_expires_at", "expires_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", description="User ID")
    device_id: str = Field(
        max_length=DEVICE_ID_MAX_LENGTH,
        description="Device unique identifier (UUID)",
    )
    device_name: str = Field(
        max_length=DEVICE_NAME_MAX_LENGTH,
        description="Device name parsed from User-Agent",
    )
    ip_address: str = Field(
        max_length=IP_ADDRESS_MAX_LENGTH,
        description="Initial login IP address",
    )
    last_ip_address: str = Field(
        max_length=IP_ADDRESS_MAX_LENGTH,
        description="Last active IP address",
    )
    user_agent: str = Field(
        max_length=USER_AGENT_MAX_LENGTH,
        description="Full User-Agent string",
    )
    token_hash: str = Field(
        index=True,
        max_length=TOKEN_HASH_MAX_LENGTH,
        description="SHA-256 hash of JWT token",
    )
    created_at: datetime = Field(default_factory=get_utc_now, description="First login time")
    last_active_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
        description="Last API call time"
    )
    expires_at: datetime = Field(description="Session absolute expiration time")
