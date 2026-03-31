"""Common shelf operation log models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class CommonShelfOperationAction(str, Enum):
    """Supported common shelf actions."""

    STOCK_IN = "stock_in"
    ADD_BOTTLES = "add_bottles"
    REMOVE_ONE = "remove_one"
    UPDATE_GROUP = "update_group"
    UPDATE_ITEM = "update_item"
    MERGE_GROUP = "merge_group"
    DELETE_GROUP = "delete_group"
    EXPORT = "export"


class CommonShelfOperationLog(SQLModel, table=True):
    """Stable common shelf snapshots for audit and user logs."""

    __tablename__ = "common_shelf_operation_log"
    __table_args__ = (
        Index("ix_common_shelf_operation_log_created_at", "created_at"),
        Index("ix_common_shelf_operation_log_operator_created_at", "operator_id", "created_at"),
        Index("ix_common_shelf_operation_log_action_created_at", "action", "created_at"),
        Index(
            "ix_common_shelf_operation_log_operator_action_created_at",
            "operator_id",
            "action",
            "created_at",
        ),
        Index(
            "ix_common_shelf_operation_log_shelf_created_at",
            "common_shelf_id",
            "created_at",
        ),
        Index("ix_common_shelf_operation_log_cas_created_at", "cas_number", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    common_shelf_id: int = Field(default=0, index=False)
    operator_id: int = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
    )
    action: CommonShelfOperationAction = Field(
        sa_column=Column(
            SAEnum(
                CommonShelfOperationAction,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
        )
    )
    created_at: datetime = Field(default_factory=get_utc_now)
    item_name: str = Field(max_length=200)
    cas_number: str = Field(max_length=50)
    snapshot_json: str = Field(sa_column=Column(Text, nullable=False))
    notes: Optional[str] = Field(default=None, max_length=500)


class CommonShelfOperationLogResponse(BaseResponse):
    """Common shelf operation log response."""

    id: int
    common_shelf_id: int
    operator_id: int
    action: CommonShelfOperationAction
    created_at: datetime
    item_name: str
    cas_number: str
    snapshot_json: str
    notes: Optional[str]
