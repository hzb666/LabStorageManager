"""
Inventory Model - Laboratory Reagents and Consumables Tracking
Critical Rule #2: CAS Number must be normalized (uppercase, no spaces)
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class InventoryStatus(str, Enum):
    """Inventory status enumeration"""
    IN_STOCK = "in_stock"
    BORROWED = "borrowed"
    CONSUMED = "consumed"


class InventoryBase(SQLModel):
    """Base inventory model with common fields"""
    # Critical: CAS Number copied from Order (already normalized)
    cas_number: str = Field(index=True, max_length=50)
    name: str = Field(max_length=200)
    alias: Optional[str] = Field(None, max_length=200)
    location: str = Field(max_length=200, default="")  # Free text, e.g., "302冰箱第二层"
    initial_quantity: float = Field(gt=0)
    remaining_quantity: float = Field(default=0.0)
    unit: str = Field(max_length=20, default="ml")  # Case-insensitive storage
    is_hazardous: bool = False
    image_path: Optional[str] = None  # Copied from Order


class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    id: Optional[int] = Field(default=None, primary_key=True)
    # Unique internal code: e.g., "ETH-001", "ETH-002"
    internal_code: str = Field(unique=True, index=True, max_length=50)
    status: InventoryStatus = InventoryStatus.IN_STOCK
    borrower_id: Optional[int] = Field(default=None, index=True)
    last_borrower_id: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class InventoryCreate(SQLModel):
    """DTO for creating inventory from Order"""
    internal_code: str = Field(max_length=50)
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    alias: Optional[str] = None
    location: str = Field(max_length=200, default="")
    initial_quantity: float = Field(gt=0)
    remaining_quantity: float = Field(default=0.0)
    unit: str = Field(max_length=20, default="ml")
    is_hazardous: bool = False
    image_path: Optional[str] = None


class InventoryUpdate(SQLModel):
    """DTO for updating inventory"""
    location: Optional[str] = None
    remaining_quantity: Optional[float] = None
    status: Optional[InventoryStatus] = None


class InventoryBorrowReturn(SQLModel):
    """DTO for borrow/return operations"""
    remaining_quantity: float = Field(ge=0)
    unit: str = Field(max_length=20)


class InventoryResponse(SQLModel):
    """DTO for inventory API responses"""
    id: int
    internal_code: str
    cas_number: str
    name: str
    alias: Optional[str]
    location: str
    initial_quantity: float
    remaining_quantity: float
    unit: str
    status: InventoryStatus
    borrower_id: Optional[int]
    is_hazardous: bool
    image_path: Optional[str]
    created_at: datetime
    updated_at: datetime
