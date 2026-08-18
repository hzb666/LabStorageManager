"""耗材订单模型。"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

from pydantic import ConfigDict, field_validator
from sqlalchemy import Column, Enum as SAEnum, Index, asc, desc
from sqlmodel import Field, SQLModel


class ConsumableOrderStatus(str, Enum):
    """Consumable order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已批准（采购完成）
    REJECTED = "rejected"    # 未通过
    COMPLETED = "completed"  # 已完成（耗材不需要入库）


class ConsumableOrderBase(SQLModel):
    """Base consumable order model"""
    # 中文名称，带查询索引
    name: str = Field(max_length=200)
    # 英文名称
    english_name: Optional[str] = Field(None, max_length=200)
    # 货号
    product_number: Optional[str] = Field(None, max_length=200)
    # 规格型号，如 "500mL"、M 码
    specification: Optional[str] = Field(default=None, max_length=100)
    # 单位，如 "箱"、"个"，选填
    unit: Optional[str] = Field(None, max_length=20)
    # 订购数量，必填且大于 0
    quantity: int = Field(gt=0)
    # 单价
    price: Optional[float] = Field(None, ge=0)
    # 沟通信息，选填
    communication: Optional[str] = Field(None, max_length=100)
    # 备注
    notes: Optional[str] = Field(None, max_length=500)


class ConsumableOrder(ConsumableOrderBase, table=True):
    """Consumable Order database model"""
    __tablename__ = "consumable_order"
    __table_args__ = (
        Index("ix_consumable_order_name_created_at_id", asc("name"), desc("created_at"), desc("id")),
        Index("ix_consumable_order_name_pinyin_created_at_id", asc("name_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_consumable_order_name_pinyin_desc_created_at_id",
            desc("name_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_consumable_order_name_pinyin_initials_created_at_id", asc("name_pinyin_initials"), desc("created_at"), desc("id")),
        Index("ix_consumable_order_created_at_id", desc("created_at"), desc("id")),
        Index("ix_consumable_order_created_at_asc_id_desc", asc("created_at"), desc("id")),
        Index("ix_consumable_order_status_created_at_id", asc("status"), desc("created_at"), desc("id")),
        Index("ix_consumable_order_applicant_created_at_id", asc("applicant_id"), desc("created_at"), desc("id")),
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
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    product_number: Optional[str] = Field(default=None, max_length=200)  # 货号，选填
    specification: str = Field(max_length=100)  # 规格型号，必填
    unit: Optional[str] = Field(default=None, max_length=20)  # 单位，选填
    quantity: int = Field(gt=0)  # 数量，必填，大于0
    price: Optional[float] = Field(default=None, ge=0)
    communication: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name", "specification")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped


class ConsumableOrderUpdate(SQLModel):
    """DTO for updating consumable order information"""
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    product_number: Optional[str] = Field(default=None, max_length=200)
    specification: Optional[str] = Field(default=None, max_length=100)
    unit: Optional[str] = Field(default=None, max_length=20)
    quantity: Optional[int] = Field(default=None, gt=0)
    price: Optional[float] = Field(default=None, ge=0)
    communication: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name", "specification", mode="before")
    @classmethod
    def strip_supplied_required_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            raise ValueError("Field must not be empty")
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped

    @field_validator("quantity", mode="before")
    @classmethod
    def reject_null_quantity(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            raise ValueError("Quantity is required")
        return value


class ConsumableOrderResponse(BaseResponse):
    """DTO for consumable order API responses"""
    id: int
    name: str
    english_name: Optional[str]
    product_number: Optional[str]
    specification: Optional[str]
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    communication: Optional[str]
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ConsumableOrderStatus
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
