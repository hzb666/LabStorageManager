"""Inventory operation snapshot log models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class InventoryOperationAction(str, Enum):
    """Supported inventory snapshot log actions."""

    STOCK_IN = "stock_in"
    INVENTORY_DELETE = "inventory_delete"
    INVENTORY_UPDATE = "inventory_update"
    INVENTORY_EXPORT = "inventory_export"


class InventoryOperationLog(SQLModel, table=True):
    """Stable inventory operation snapshots for audit and user logs."""

    # snapshot_json short-key contract:
    # id=inventory row id, ic=internal_code, ca=cas_number, na=name, en=english_name,
    # al=alias, cg=category, br=brand, pu=purity, sl=storage_location, iq=initial_quantity,
    # rq=remaining_quantity, rp=remaining_percent, un=unit, hz=is_hazardous,
    # nt=notes, bi=borrower_id, lb=last_borrower_id,
    # tk=temporary_keeper_id, oi=source_order_id, cb=created_by_id, cr=created_at,
    # up=updated_at, sc=source, ct=count(export only), cq=consumed_quantity,
    # bf=before(update only), af=after(update only)

    __tablename__ = "inventory_operation_log"
    __table_args__ = (
        Index(
            "ix_inventory_operation_log_created_at",
            "created_at",
        ),
        Index(
            "ix_inventory_operation_log_operator_created_at",
            "operator_id",
            "created_at",
        ),
        Index(
            "ix_inventory_operation_log_action_created_at",
            "action",
            "created_at",
        ),
        Index(
            "ix_inventory_operation_log_operator_action_created_at",
            "operator_id",
            "action",
            "created_at",
        ),
        Index(
            "ix_inventory_operation_log_inventory_created_at",
            "inventory_id",
            "created_at",
        ),
        Index(
            "ix_inventory_operation_log_cas_created_at",
            "cas_number",
            "created_at",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    inventory_id: int = Field(index=False)
    operator_id: int = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
    )
    action: InventoryOperationAction = Field(
        sa_column=Column(
            SAEnum(
                InventoryOperationAction,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
        ),
    )
    created_at: datetime = Field(default_factory=get_utc_now)
    item_name: str = Field(max_length=200)
    cas_number: str = Field(max_length=50)
    snapshot_json: str = Field(sa_column=Column(Text, nullable=False))
    notes: Optional[str] = Field(default=None, max_length=500)


class InventoryOperationLogResponse(BaseResponse):
    """DTO for inventory operation snapshot log responses."""

    id: int
    inventory_id: int
    operator_id: int
    action: InventoryOperationAction
    created_at: datetime
    item_name: str
    cas_number: str
    snapshot_json: str
    notes: Optional[str]
