"""
Announcement Model - System Announcements Management
"""
from datetime import datetime
from typing import Optional, List

from sqlmodel import Field, SQLModel, JSON

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class AnnouncementBase(SQLModel):
    """Base announcement model with common fields"""
    title: str = Field(max_length=200)
    content: str = Field(max_length=10000)
    images: Optional[List[str]] = Field(
        default=None,
        sa_type=JSON,
        sa_column_kwargs={"default": "[]"}
    )
    is_pinned: bool = Field(default=False)
    is_visible: bool = Field(default=True)


class Announcement(AnnouncementBase, table=True):
    """Announcement database model"""
    __tablename__ = "announcements"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class AnnouncementCreate(SQLModel):
    """DTO for creating a new announcement"""
    title: str = Field(max_length=200)
    content: str = Field(max_length=10000)
    images: Optional[List[str]] = None
    is_pinned: bool = False
    is_visible: bool = True


class AnnouncementUpdate(SQLModel):
    """DTO for updating announcement information"""
    title: Optional[str] = Field(None, max_length=200)
    content: Optional[str] = Field(None, max_length=10000)
    images: Optional[List[str]] = None
    is_pinned: Optional[bool] = None
    is_visible: Optional[bool] = None


class AnnouncementResponse(BaseResponse):
    """DTO for announcement API responses"""

    id: int
    title: str
    content: str
    images: Optional[List[str]]
    is_pinned: bool
    is_visible: bool
    created_by: Optional[int]
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
