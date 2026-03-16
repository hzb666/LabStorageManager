"""
User Model - Authentication and Authorization
"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

import re

from pydantic import field_validator
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    """User role enumeration"""
    ADMIN = "admin"
    USER = "user"
    PUBLIC = "public"


class UserBase(SQLModel):
    """Base user model with common fields"""
    username: str = Field(unique=True, index=True, min_length=3, max_length=20)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9_]+$', v):
            raise ValueError('用户名只能包含字母、数字和下划线')
        return v

    full_name: str = Field(max_length=100)
    role: UserRole = Field(default=UserRole.USER)
    is_active: bool = Field(default=True)
    avatar_url: Optional[str] = Field(default=None, max_length=500)


class User(UserBase, table=True):
    """User database model"""
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    password_hash: str
    username_version: int = Field(default=1, description="用户名版本号，每次修改用户名时+1")
    # 姓名拼音，用于按姓名排序
    full_name_pinyin: Optional[str] = Field(default=None, index=True, max_length=200)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )


class UserCreate(SQLModel):
    """DTO for creating a new user"""
    username: str = Field(min_length=3, max_length=20)
    password: str = Field(min_length=6, max_length=50)
    full_name: str = Field(min_length=1, max_length=100)  # 必填
    role: UserRole = UserRole.USER


class UserUpdate(SQLModel):
    """DTO for updating user information"""
    username: Optional[str] = Field(None, min_length=3, max_length=20)
    
    # 添加 username 格式验证
    @field_validator('username')
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.match(r'^[a-zA-Z0-9_]+$', v):
            raise ValueError('用户名只能包含字母，数字和下划线')
        return v
    
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    avatar_url: Optional[str] = None


class UserResponse(BaseResponse):
    """DTO for user API responses (excludes sensitive data)"""

    id: int
    username: str
    full_name: Optional[str]
    full_name_pinyin: Optional[str] = None
    role: UserRole
    is_active: bool
    created_at: datetime
    avatar_url: Optional[str] = None
