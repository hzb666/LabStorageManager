"""
User Session Model - Device and IP Login Management
"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from typing import Optional

from sqlmodel import Field, SQLModel


class UserSession(SQLModel, table=True):
    """User session model for device and IP login management"""
    __tablename__ = "user_sessions"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True, description="User ID")
    device_id: str = Field(index=True, description="Device unique identifier (UUID)")
    device_name: str = Field(description="Device name parsed from User-Agent")
    ip_address: str = Field(description="Initial login IP address")
    last_ip_address: str = Field(description="Last active IP address")
    user_agent: str = Field(description="Full User-Agent string")
    token_hash: str = Field(index=True, description="SHA-256 hash of JWT token")
    created_at: datetime = Field(default_factory=get_utc_now, description="First login time")
    last_active_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
        description="Last API call time"
    )
    expires_at: datetime = Field(description="Session absolute expiration time")
