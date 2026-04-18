"""Timeline read-model rows for user log pagination and search."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now


class LogTimelineSourceTable(str, Enum):
    """Source log tables that can project into the timeline read model."""

    INVENTORY_OPERATION_LOG = "inventory_operation_log"
    REAGENT_ORDER_OPERATION_LOG = "reagent_order_operation_log"
    CONSUMABLE_ORDER_OPERATION_LOG = "consumable_order_operation_log"
    COMMON_SHELF_OPERATION_LOG = "common_shelf_operation_log"
    USER_OPERATION_LOG = "user_operation_log"
    BORROWLOG = "borrowlog"


class LogTimeline(SQLModel, table=True):
    """Lightweight log timeline row used for paging and search."""

    __tablename__ = "log_timeline"
    __table_args__ = (
        Index("ix_log_timeline_occurred_at_id", "occurred_at", "id"),
        Index(
            "ix_log_timeline_actor_occurred_at_id",
            "actor_user_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_log_timeline_subject_occurred_at_id",
            "subject_user_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_log_timeline_actor_source_table_occurred_at_id",
            "actor_user_id",
            "source_table",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_log_timeline_subject_source_table_occurred_at_id",
            "subject_user_id",
            "source_table",
            "occurred_at",
            "id",
        ),
        Index(
            "ux_log_timeline_source_table_source_log_id",
            "source_table",
            "source_log_id",
            unique=True,
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    occurred_at: datetime = Field(default_factory=get_utc_now)
    is_cli: bool = Field(default=False)
    actor_user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    subject_user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    source_table: LogTimelineSourceTable = Field(
        sa_column=Column(
            SAEnum(
                LogTimelineSourceTable,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
        ),
    )
    source_log_id: int = Field(index=False)
    search_text: str = Field(sa_column=Column(Text, nullable=False, default=""))
    search_text_pinyin: str = Field(sa_column=Column(Text, nullable=False, default=""))
    detail_search_text: str = Field(sa_column=Column(Text, nullable=False, default=""))
