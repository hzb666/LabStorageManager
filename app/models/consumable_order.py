"""
Consumable Order Model - Consumables Purchase Order Management
Separated from Reagent for independent workflow (no stock-in needed)
"""
from datetime import datetime

from app.core.time_utils import get_utc_now
from enum import Enum
from typing import Optional

from sqlmodel import Field, ForeignKey, SQLModel


class ConsumableOrderStatus(str, Enum):
    """Consumable order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已审批（采购完成）
    REJECTED = "rejected"    # 未通过
    COMPLETED = "completed"  # 已完成（耗材不需要入库）


class ConsumableOrderBase(SQLModel):
    """Base consumable order model"""
    # Chinese name (with index for query)
    name: str = Field(index=True, max_length=200)
    # English name
    english_name: Optional[str] = Field(None, max_length=200)
    # Alias (e.g., "酒精, Ethanol")
    alias: Optional[str] = Field(None, max_length=200)
    # Category (e.g., "手套", "试管")
    category: Optional[str] = Field(None, max_length=100)
    # Brand (e.g., "3M", "Corning")
    brand: Optional[str] = Field(None, max_length=100)
    # Specification (规格型号，如 "500ml"、M码)
    specification: str = Field(max_length=100)
    # Unit (单位，如 "箱"、"个") - 选填
    unit: Optional[str] = Field(None, max_length=20)
    # Quantity ordered (必填，大于0)
    quantity: int = Field(gt=0)
    # Price
    price: Optional[float] = Field(None, ge=0)
    # Image path (thumbnail in filesystem)
    image_path: Optional[str] = None
    # Notes
    notes: Optional[str] = Field(None, max_length=500)


class ConsumableOrder(ConsumableOrderBase, table=True):
    """Consumable Order database model"""
    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ConsumableOrderStatus = Field(default=ConsumableOrderStatus.PENDING, index=True)
    created_at: datetime = Field(default_factory=get_utc_now, index=True)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )
    
    # 拼音排序字段（预计算，使用数据库索引加速排序）
    name_pinyin: Optional[str] = Field(default=None, index=True)


class ConsumableOrderCreate(SQLModel):
    """DTO for creating a new consumable order

    前端传入 quantity (数量) 和 specification (规格)
    """
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    specification: str = Field(max_length=100)  # 规格型号，必填
    unit: Optional[str] = None  # 单位，选填
    quantity: int = Field(gt=0)  # 数量，必填，大于0
    price: Optional[float] = None
    notes: Optional[str] = None


class ConsumableOrderUpdate(SQLModel):
    """DTO for updating consumable order information"""
    name: Optional[str] = None
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    specification: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[float] = None
    status: Optional[ConsumableOrderStatus] = None
    notes: Optional[str] = None


class ConsumableOrderResponse(SQLModel):
    """DTO for consumable order API responses"""
    id: int
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    specification: str
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    image_path: Optional[str]
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ConsumableOrderStatus
    created_at: datetime
    updated_at: datetime
    # 拼音排序字段
    name_pinyin: Optional[str] = None
