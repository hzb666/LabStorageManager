"""
Announcement Model - System Announcements Management
"""
from datetime import datetime

from sqlalchemy import Index
from sqlmodel import JSON, Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class AnnouncementBase(SQLModel):
    """Base announcement model with common fields"""
    title: str = Field(max_length=200)
    content: str = Field(max_length=10000)
    images: list[str] | None = Field(
        default=None,
        sa_type=JSON,
        sa_column_kwargs={"default": "[]"}
    )
    is_pinned: bool = Field(default=False)
    is_visible: bool = Field(default=True)
    is_popup: bool = Field(default=False)


class Announcement(AnnouncementBase, table=True):
    """Announcement database model"""
    __tablename__ = "announcements"
    __table_args__ = (
        Index("ix_announcements_pinned_created", "is_pinned", "created_at"),
        Index("ix_announcements_visible_pinned_created", "is_visible", "is_pinned", "created_at"),
        Index("ix_announcements_creator_visible", "created_by", "is_visible"),
    )

    id: int | None = Field(default=None, primary_key=True)
    created_by: int | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class AnnouncementCreate(SQLModel):
    """DTO for creating a new announcement"""
    title: str = Field(max_length=200)
    content: str = Field(max_length=10000)
    images: list[str] | None = None
    is_pinned: bool = False
    is_visible: bool = True
    is_popup: bool = False


class AnnouncementUpdate(SQLModel):
    """DTO for updating announcement information"""
    title: str | None = Field(None, max_length=200)
    content: str | None = Field(None, max_length=10000)
    images: list[str] | None = None
    is_pinned: bool | None = None
    is_visible: bool | None = None
    is_popup: bool | None = None


class AnnouncementResponse(BaseResponse):
    """DTO for announcement API responses"""

    id: int
    title: str
    content: str
    images: list[str] | None
    is_pinned: bool
    is_visible: bool
    is_popup: bool
    created_by: int | None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
