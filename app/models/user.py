"""
User Model - Authentication and Authorization
"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from app.core.constants import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

import re

from pydantic import ConfigDict, field_validator
from sqlalchemy import Index
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    """User role enumeration"""
    ADMIN = "admin"
    USER = "user"
    PUBLIC = "public"


class UserBase(SQLModel):
    """Base user model with common fields"""
    username: str = Field(unique=True, index=True, min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r'^\w+$', v, flags=re.ASCII):
            raise ValueError('用户名只能包含字母、数字和下划线')
        return v

    full_name: str = Field(max_length=100)
    role: UserRole = Field(default=UserRole.USER)
    is_active: bool = Field(default=True)
    avatar_url: Optional[str] = Field(default=None, max_length=500)


class User(UserBase, table=True):
    """User database model"""
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_active_role_created", "is_active", "role", "created_at"),
        Index("ix_users_full_name_pinyin_id", "full_name_pinyin", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    password_hash: str
    username_version: int = Field(default=1, description="用户名版本号，每次修改用户名时+1")
    # 姓名拼音，用于按姓名排序
    full_name_pinyin: Optional[str] = Field(default=None, max_length=200)
    full_name_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )


class UserCreate(SQLModel):
    """DTO for creating a new user"""
    username: str = Field(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    full_name: str = Field(min_length=1, max_length=100)  # 必填
    role: UserRole = UserRole.USER


class UserUpdate(SQLModel):
    """DTO for updating user information"""
    # 安全边界：拒绝未声明字段（如 role），统一通过专用接口更新权限字段
    model_config = ConfigDict(extra="forbid")

    username: Optional[str] = Field(None, min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    
    # 添加 username 格式验证
    @field_validator('username')
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.match(r'^\w+$', v, flags=re.ASCII):
            raise ValueError('用户名只能包含字母，数字和下划线')
        return v
    
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


class PublicUserResponse(BaseResponse):
    """Public user profile payload for authenticated non-admin access."""

    id: int
    full_name: Optional[str]
    avatar_url: Optional[str] = None


class UserResponse(BaseResponse):
    """DTO for user API responses (excludes sensitive data)"""

    id: int
    username: str
    full_name: Optional[str]
    full_name_pinyin: Optional[str] = None
    full_name_pinyin_initials: Optional[str] = None
    role: UserRole
    is_active: bool
    created_at: datetime
    avatar_url: Optional[str] = None
