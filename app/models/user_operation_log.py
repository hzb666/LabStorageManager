"""User operation log models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class UserOperationAction(str, Enum):
    """Supported user operation actions."""

    LOGIN = "login"
    LOGOUT = "logout"
    CHANGE_PASSWORD = "change_password"
    UPDATE_PROFILE = "update_profile"
    UPLOAD_AVATAR = "upload_avatar"
    DELETE_AVATAR = "delete_avatar"
    CREATE_USER = "create_user"
    ACTIVATE_USER = "activate_user"
    DEACTIVATE_USER = "deactivate_user"
    UPDATE_USER_ROLE = "update_user_role"
    RESET_USER_PASSWORD = "reset_user_password"
    UPDATE_USER_SENSITIVE_FIELDS = "update_user_sensitive_fields"


class UserOperationLog(SQLModel, table=True):
    """Stable user operation logs for audit and user behavior tracing."""

    __tablename__ = "user_operation_log"
    __table_args__ = (
        Index(
            "ix_user_operation_log_created_at",
            "created_at",
        ),
        Index(
            "ix_user_operation_log_actor_created_at",
            "actor_user_id",
            "created_at",
        ),
        Index(
            "ix_user_operation_log_target_created_at",
            "target_user_id",
            "created_at",
        ),
        Index(
            "ix_user_operation_log_action_created_at",
            "action",
            "created_at",
        ),
        Index(
            "ix_user_operation_log_actor_action_created_at",
            "actor_user_id",
            "action",
            "created_at",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    actor_user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    target_user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    action: UserOperationAction = Field(
        sa_column=Column(
            SAEnum(
                UserOperationAction,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
        ),
    )
    outcome: str = Field(default="success", max_length=20)
    client_ip: Optional[str] = Field(default=None, max_length=64)
    request_id: Optional[str] = Field(default=None, max_length=100)
    detail: Optional[str] = Field(default=None, max_length=500)
    snapshot_json: str = Field(sa_column=Column(Text, nullable=False, default="{}"))
    created_at: datetime = Field(default_factory=get_utc_now)


class UserOperationLogResponse(BaseResponse):
    """DTO for user operation log responses."""

    id: int
    actor_user_id: Optional[int]
    target_user_id: Optional[int]
    action: UserOperationAction
    outcome: str
    client_ip: Optional[str]
    request_id: Optional[str]
    detail: Optional[str]
    snapshot_json: str
    created_at: datetime
