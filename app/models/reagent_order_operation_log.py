"""Reagent order operation snapshot log models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class ReagentOrderOperationAction(str, Enum):
    """Supported reagent order operation actions."""

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    APPROVE = "approve"
    REJECT = "reject"
    EXPORT = "export"


class ReagentOrderOperationLog(SQLModel, table=True):
    """Stable reagent order operation snapshots for audit and user logs."""

    __tablename__ = "reagent_order_operation_log"
    __table_args__ = (
        Index(
            "ix_reagent_order_operation_log_created_at",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_actor_created_at",
            "actor_user_id",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_action_created_at",
            "action",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_actor_action_created_at",
            "actor_user_id",
            "action",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_order_created_at",
            "order_id",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_applicant_created_at",
            "applicant_id",
            "created_at",
        ),
        Index(
            "ix_reagent_order_operation_log_cas_created_at",
            "cas_number",
            "created_at",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(index=False)
    actor_user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    applicant_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    action: ReagentOrderOperationAction = Field(
        sa_column=Column(
            SAEnum(
                ReagentOrderOperationAction,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
        ),
    )
    created_at: datetime = Field(default_factory=get_utc_now)
    order_name: str = Field(max_length=200)
    cas_number: str = Field(max_length=50)
    snapshot_json: str = Field(sa_column=Column(Text, nullable=False))
    notes: Optional[str] = Field(default=None, max_length=500)


class ReagentOrderOperationLogResponse(BaseResponse):
    """DTO for reagent order operation snapshot log responses."""

    id: int
    order_id: int
    actor_user_id: Optional[int]
    applicant_id: Optional[int]
    action: ReagentOrderOperationAction
    created_at: datetime
    order_name: str
    cas_number: str
    snapshot_json: str
    notes: Optional[str]
