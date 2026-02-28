"""
Reagent Order Model - Reagent Purchase Order Management
Separated from Consumable for independent workflow
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, ForeignKey, SQLModel


class ReagentOrderStatus(str, Enum):
    """Reagent order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已审批（采购完成）
    ARRIVED = "arrived"       # 已到货但未入库
    STOCKED = "stocked"       # 已入库
    REJECTED = "rejected"    # 未通过


class ReagentOrderReason(str, Enum):
    """Order reason enumeration"""
    NONE = "none"
    RUNNING_OUT = "running_out"
    EMPTY = "empty"
    COMMON_PUBLIC = "common_public"
    NOT_FOUND = "not_found"
    REORDER = "reorder"


class ReagentOrderBase(SQLModel):
    """Base reagent order model with common fields"""
    # CAS Number - Critical field for reagents
    cas_number: str = Field(index=True, max_length=50)
    # Chinese name
    name: str = Field(max_length=200)
    # English name
    english_name: Optional[str] = Field(None, max_length=200)
    # Alias (e.g., "酒精, Ethanol")
    alias: Optional[str] = Field(None, max_length=200)
    # Category (e.g., "分析纯", "实验级")
    category: Optional[str] = Field(None, max_length=100)
    # Brand (e.g., "Sigma", "国药")
    brand: Optional[str] = Field(None, max_length=100)
    # Specification (e.g., "500ml")
    specification: str = Field(max_length=100)
    # Quantity ordered
    quantity: int = Field(gt=0)
    # Price
    price: Optional[float] = Field(None, ge=0)
    # Order reason
    order_reason: ReagentOrderReason = ReagentOrderReason.NONE
    # Hazardous flag
    is_hazardous: bool = False
    # Image path (thumbnail in filesystem)
    image_path: Optional[str] = None
    # Notes
    notes: Optional[str] = Field(None, max_length=500)


class ReagentOrder(ReagentOrderBase, table=True):
    """Reagent Order database model"""
    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ReagentOrderStatus = ReagentOrderStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ReagentOrderCreate(SQLModel):
    """DTO for creating a new reagent order"""
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    specification: str = Field(max_length=100)
    quantity: int = Field(gt=0)
    price: Optional[float] = None
    order_reason: ReagentOrderReason = ReagentOrderReason.NONE
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
    specification: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[float] = None
    order_reason: Optional[ReagentOrderReason] = None
    is_hazardous: Optional[bool] = None
    status: Optional[ReagentOrderStatus] = None
    notes: Optional[str] = None


class ReagentOrderResponse(SQLModel):
    """DTO for reagent order API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    specification: str
    quantity: int
    price: Optional[float]
    order_reason: ReagentOrderReason
    is_hazardous: bool
    image_path: Optional[str]
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ReagentOrderStatus
    created_at: datetime
    updated_at: datetime
