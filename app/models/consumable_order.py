"""
Consumable Order Model - Consumables Purchase Order Management
Separated from Reagent for independent workflow (no stock-in needed)
"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Column, Enum as SAEnum, Index
from sqlmodel import Field, SQLModel


class ConsumableOrderStatus(str, Enum):
    """Consumable order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已批准（采购完成）
    REJECTED = "rejected"    # 未通过
    COMPLETED = "completed"  # 已完成（耗材不需要入库）


class ConsumableOrderBase(SQLModel):
    """Base consumable order model"""
    # Chinese name (with index for query)
    name: str = Field(max_length=200)
    # English name
    english_name: Optional[str] = Field(None, max_length=200)
    # Product number (货号)
    product_number: Optional[str] = Field(None, max_length=200)
    # Specification (规格型号，如 "500ml"、M码)
    specification: str = Field(max_length=100)
    # Unit (单位，如 "箱"、"个") - 选填
    unit: Optional[str] = Field(None, max_length=20)
    # Quantity ordered (必填，大于0)
    quantity: int = Field(gt=0)
    # Price
    price: Optional[float] = Field(None, ge=0)
    # Communication (沟通信息，可选)
    communication: Optional[str] = Field(None, max_length=100)
    # Notes
    notes: Optional[str] = Field(None, max_length=500)


class ConsumableOrder(ConsumableOrderBase, table=True):
    """Consumable Order database model"""
    __tablename__ = "consumable_order"
    __table_args__ = (
        Index("ix_consumable_order_name_created_at_id", "name", "created_at", "id"),
        Index("ix_consumable_order_name_pinyin_created_at_id", "name_pinyin", "created_at", "id"),
        Index("ix_consumable_order_name_pinyin_initials_created_at_id", "name_pinyin_initials", "created_at", "id"),
        Index("ix_consumable_order_created_at_id", "created_at", "id"),
        Index("ix_consumable_order_status_created_at_id", "status", "created_at", "id"),
        Index("ix_consumable_order_applicant_created_at_id", "applicant_id", "created_at", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ConsumableOrderStatus = Field(
        default=ConsumableOrderStatus.PENDING,
        sa_column=Column(
            SAEnum(
                ConsumableOrderStatus,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
            default=ConsumableOrderStatus.PENDING.value,
        ),
    )
    # 拼音索引字段（用于排序和搜索）
    name_pinyin: Optional[str] = Field(None, max_length=200)
    name_pinyin_initials: Optional[str] = Field(None, max_length=200)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )


class ConsumableOrderCreate(SQLModel):
    """DTO for creating a new consumable order

    前端传入 quantity (数量) 和 specification (规格)
    """
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    product_number: Optional[str] = None  # 货号，选填
    specification: str = Field(max_length=100)  # 规格型号，必填
    unit: Optional[str] = None  # 单位，选填
    quantity: int = Field(gt=0)  # 数量，必填，大于0
    price: Optional[float] = None
    communication: Optional[str] = None
    notes: Optional[str] = None


class ConsumableOrderUpdate(SQLModel):
    """DTO for updating consumable order information"""
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    english_name: Optional[str] = None
    product_number: Optional[str] = None
    specification: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[float] = None
    communication: Optional[str] = None
    notes: Optional[str] = None


class ConsumableOrderResponse(BaseResponse):
    """DTO for consumable order API responses"""
    id: int
    name: str
    english_name: Optional[str]
    product_number: Optional[str]
    specification: str
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    communication: Optional[str]
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ConsumableOrderStatus
    created_at: datetime
    updated_at: datetime
