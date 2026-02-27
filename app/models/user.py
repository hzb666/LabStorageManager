"""
User Model - Authentication and Authorization
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import ConfigDict
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    """User role enumeration"""
    ADMIN = "admin"
    USER = "user"


class UserBase(SQLModel):
    """Base user model with common fields"""
    username: str = Field(unique=True, index=True, min_length=3, max_length=50)
    full_name: Optional[str] = Field(default=None, max_length=100)
    role: UserRole = Field(default=UserRole.USER)
    is_active: bool = Field(default=True)


class User(UserBase, table=True):
    """User database model"""
    __tablename__ = "users"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class UserCreate(SQLModel):
    """DTO for creating a new user"""
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6)
    full_name: Optional[str] = None
    role: UserRole = UserRole.USER


class UserUpdate(SQLModel):
    """DTO for updating user information"""
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class UserResponse(SQLModel):
    """DTO for user API responses (excludes sensitive data)"""
    model_config = ConfigDict(from_attributes=True, json_encoders={datetime: lambda v: v.isoformat()})
    
    id: int
    username: str
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime
