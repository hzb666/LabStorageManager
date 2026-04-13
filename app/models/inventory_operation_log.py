"""库存操作快照日志模型。"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class InventoryOperationAction(str, Enum):
    """库存快照日志支持的动作。"""

    STOCK_IN = "stock_in"
    INVENTORY_DELETE = "inventory_delete"
    INVENTORY_UPDATE = "inventory_update"
    INVENTORY_EXPORT = "inventory_export"


class InventoryOperationLog(SQLModel, table=True):
    """供审计和用户日志复用的稳定库存操作快照。"""

    # snapshot_json 短键约定：
    # id=库存记录 ID, ic=内部编码, ca=CAS 号, na=名称, en=英文名,
    # al=别名, cg=分类, br=品牌, pu=纯度, sl=存放位置, iq=初始量,
    # rq=剩余量, rp=剩余百分比, un=单位, hz=危险品标记,
    # nt=备注, bi=借用人 ID, lb=上次借用人 ID,
    # tk=临时保管人 ID, oi=来源订单 ID, cb=创建人 ID, cr=创建时间,
    # up=更新时间, sc=来源, ct=数量（仅导出）,
    # bf=变更前（仅更新）, af=变更后（仅更新）

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
