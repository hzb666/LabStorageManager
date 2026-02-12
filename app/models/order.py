"""
Order Model - Purchase Order Management
Critical Rule #2: CAS Number must be normalized (uppercase, no spaces)
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class OrderType(str, Enum):
    """Order type enumeration"""
    REAGENT = "reagent"
    CONSUMABLE = "consumable"


class OrderStatus(str, Enum):
    """Order status enumeration"""
    PENDING = "pending"
    APPROVED = "approved"
    PURCHASED = "purchased"
    STOCKED = "stocked"
    REJECTED = "rejected"


class OrderBase(SQLModel):
    """Base order model with common fields"""
    type: OrderType
    # Critical: CAS Number will be normalized by service layer
    cas_number: str = Field(index=True, max_length=50)
    name: str = Field(max_length=200)
    alias: Optional[str] = Field(None, max_length=200)  # e.g., "酒精, Ethanol"
    specification: str = Field(max_length=100)  # e.g., "500ml"
    quantity: int = Field(gt=0)
    is_hazardous: bool = False
    image_path: Optional[str] = None  # Thumbnail path in filesystem


class Order(OrderBase, table=True):
    """Order database model"""
    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(default=None)
    status: OrderStatus = OrderStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OrderCreate(SQLModel):
    """DTO for creating a new order"""
    type: OrderType
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    alias: Optional[str] = None
    specification: str = Field(max_length=100)
    quantity: int = Field(gt=0)
    is_hazardous: bool = False


class OrderUpdate(SQLModel):
    """DTO for updating order information"""
    type: Optional[OrderType] = None
    cas_number: Optional[str] = None
    name: Optional[str] = None
    alias: Optional[str] = None
    specification: Optional[str] = None
    quantity: Optional[int] = None
    is_hazardous: Optional[bool] = None
    status: Optional[OrderStatus] = None


class OrderResponse(SQLModel):
    """DTO for order API responses"""
    id: int
    type: OrderType
    cas_number: str
    name: str
    alias: Optional[str]
    specification: str
    quantity: int
    applicant_id: Optional[int]
    status: OrderStatus
    is_hazardous: bool
    image_path: Optional[str]
    created_at: datetime
    updated_at: datetime
