"""User operation log models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Column, Index, Text
from sqlalchemy import Enum as SAEnum
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
    CREATE_REAGENT_BRAND = "create_reagent_brand"
    UPDATE_REAGENT_BRAND = "update_reagent_brand"
    DELETE_REAGENT_BRAND = "delete_reagent_brand"
    CREATE_CHEMICAL_NAME_MAP = "create_chemical_name_map"
    UPDATE_CHEMICAL_NAME_MAP = "update_chemical_name_map"
    DELETE_CHEMICAL_NAME_MAP = "delete_chemical_name_map"
    CREATE_ANNOUNCEMENT = "create_announcement"
    UPDATE_ANNOUNCEMENT = "update_announcement"
    DELETE_ANNOUNCEMENT = "delete_announcement"
    UPDATE_ANNOUNCEMENT_PIN = "update_announcement_pin"
    UPDATE_ANNOUNCEMENT_VISIBILITY = "update_announcement_visibility"
    UPLOAD_ANNOUNCEMENT_IMAGE = "upload_announcement_image"
    DELETE_ANNOUNCEMENT_IMAGE = "delete_announcement_image"
    DELETE_SESSION = "delete_session"
    DELETE_OTHER_SESSIONS = "delete_other_sessions"
    REFRESH_SESSION = "refresh_session"
    UPDATE_SESSION = "update_session"


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

    id: int | None = Field(default=None, primary_key=True)
    actor_user_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    target_user_id: int | None = Field(
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
    client_ip: str | None = Field(default=None, max_length=64)
    request_id: str | None = Field(default=None, max_length=100)
    detail: str | None = Field(default=None, max_length=500)
    snapshot_json: str = Field(sa_column=Column(Text, nullable=False, default="{}"))
    created_at: datetime = Field(default_factory=get_utc_now)


class UserOperationLogResponse(BaseResponse):
    """DTO for user operation log responses."""

    id: int
    actor_user_id: int | None
    target_user_id: int | None
    action: UserOperationAction
    outcome: str
    client_ip: str | None
    request_id: str | None
    detail: str | None
    snapshot_json: str
    created_at: datetime
