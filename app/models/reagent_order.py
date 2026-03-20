"""
Reagent Order Model - Reagent Purchase Order Management
Separated from Consumable for independent workflow
"""
from datetime import datetime

from app.core.constants import MAX_ORDER_QUANTITY
from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class ReagentOrderStatus(str, Enum):
    """Reagent order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已审批（采购完成）
    ARRIVED = "arrived"       # 已到货但未入库
    STOCKED = "stocked"       # 已入库
    REJECTED = "rejected"    # 未通过


class ReagentOrderReason(str, Enum):
    """Order reason enumeration"""
    RUNNING_OUT = "running_out"      # 库存用完
    NOT_STOCKED = "not_stocked"    # 库里没有
    COMMON_PUBLIC = "common_public"  # 公用常用
    NOT_FOUND = "not_found"          # 没找到
    REORDER = "reorder"              # 追加订购
    HIGH_USAGE = "high_usage"        # 大量使用
    DEGRADED = "degraded"            # 变质
    OTHERS = "others"                # 其他


class ReagentOrderBase(SQLModel):
    """Base reagent order model with common fields"""
    # CAS Number - Critical field for reagents
    cas_number: str = Field(index=True, max_length=50)
    # Chinese name (with index for query and pinyin for sorting)
    name: str = Field(index=True, max_length=200)
    # English name
    english_name: Optional[str] = Field(None, max_length=200)
    # Alias (e.g., "酒精, Ethanol")
    alias: Optional[str] = Field(None, max_length=200)
    # Category (with index for query and pinyin for sorting)
    category: Optional[str] = Field(index=True, max_length=100)
    # Brand (with index for query and pinyin for sorting)
    brand: Optional[str] = Field(index=True, max_length=100)
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: Optional[float] = Field(default=None)
    # Unit (e.g., "ml", "g", "L")
    unit: Optional[str] = Field(None, max_length=20)
    # Quantity ordered (number of bottles)
    quantity: int = Field(gt=0)
    # Price
    price: float = Field(ge=0)
    # Order reason
    # Order reason (optional, frontend must provide when creating)
    order_reason: Optional[ReagentOrderReason] = None
    # Hazardous flag
    is_hazardous: bool = False
    # Notes
    notes: Optional[str] = Field(None, max_length=500)


class ReagentOrder(ReagentOrderBase, table=True):
    """Reagent Order database model"""
    __tablename__ = "reagent_order"

    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ReagentOrderStatus = Field(default=ReagentOrderStatus.PENDING, index=True)
    created_at: datetime = Field(default_factory=get_utc_now, index=True)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )
    
    # 拼音排序字段（预计算，使用数据库索引加速排序）
    name_pinyin: Optional[str] = Field(default=None, index=True, max_length=200)
    name_pinyin_initials: Optional[str] = Field(default=None, index=True, max_length=200)
    category_pinyin: Optional[str] = Field(default=None, index=True, max_length=200)
    category_pinyin_initials: Optional[str] = Field(default=None, index=True, max_length=200)
    brand_pinyin: Optional[str] = Field(default=None, index=True, max_length=200)
    brand_pinyin_initials: Optional[str] = Field(default=None, index=True, max_length=200)


class ReagentOrderCreate(SQLModel):
    """DTO for creating a new reagent order
    
    前端传入 specification (规格字符串)，后端解析为 initial_quantity + unit
    """
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    specification: str = Field(max_length=100)  # 前端传入规格字符串，如 "500ml"
    quantity: int = Field(gt=0, le=MAX_ORDER_QUANTITY)  # 数量限制：1-99
    price: float = Field(gt=0)  # 价格必填，必须大于0
    order_reason: ReagentOrderReason  # 必填，前端只能选择枚举值
    is_hazardous: bool = False
    notes: Optional[str] = None


class ReagentOrderUpdate(SQLModel):
    """DTO for updating reagent order information"""
    cas_number: Optional[str] = None
    name: Optional[str] = None
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    initial_quantity: Optional[float] = None
    unit: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[float] = None
    order_reason: Optional[ReagentOrderReason] = None
    is_hazardous: Optional[bool] = None
    status: Optional[ReagentOrderStatus] = None
    notes: Optional[str] = None


class ReagentOrderResponse(BaseResponse):
    """DTO for reagent order API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    initial_quantity: Optional[float]
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    order_reason: Optional[ReagentOrderReason]
    is_hazardous: bool
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ReagentOrderStatus
    created_at: datetime
    updated_at: datetime
