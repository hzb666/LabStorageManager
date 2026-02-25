"""
Inventory Model - Laboratory Reagents and Consumables Tracking
Critical Rule #2: CAS Number must be normalized (uppercase, no spaces)
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, ForeignKey, SQLModel, Relationship
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User


class InventoryStatus(str, Enum):
    """Inventory status enumeration"""
    NOT_IN_STOCK = "not_in_stock"
    IN_STOCK = "in_stock"
    BORROWED = "borrowed"
    CONSUMED = "consumed"


class InventoryBase(SQLModel):
    """Base inventory model with common fields"""
    # Critical: CAS Number copied from Order (already normalized)
    cas_number: str = Field(index=True, max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = Field(None, max_length=200)  # English name
    alias: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(None, max_length=100)  # Category
    brand: Optional[str] = Field(None, max_length=100)  # Brand
    location: Optional[str] = Field(None, max_length=200)  # Free text, can be None for temporary keeper
    initial_quantity: float = Field(gt=0)
    remaining_quantity: float = Field(default=0.0)
    unit: str = Field(max_length=20, default="ml")  # Case-insensitive storage
    is_hazardous: bool = False
    image_path: Optional[str] = None  # Copied from Order
    notes: Optional[str] = Field(None, max_length=500)  # User custom notes


class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    id: Optional[int] = Field(default=None, primary_key=True)
    # Unique internal code: e.g., "64175-250113-01" (CAS-Date-Sequence)
    internal_code: str = Field(unique=True, index=True, max_length=50)
    status: InventoryStatus = InventoryStatus.IN_STOCK
    borrower_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="user.id",
        ondelete="SET NULL"
    )
    last_borrower_id: Optional[int] = Field(
        default=None,
        foreign_key="user.id",
        ondelete="SET NULL"
    )
    temporary_keeper_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="user.id",
        ondelete="SET NULL"
    )
    created_by_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="user.id",
        ondelete="SET NULL"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class InventoryCreate(SQLModel):
    """DTO for creating inventory from Order"""
    internal_code: str = Field(max_length=50)
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    location: Optional[str] = None
    initial_quantity: float = Field(gt=0)
    remaining_quantity: float = Field(default=0.0)
    unit: str = Field(max_length=20, default="ml")
    is_hazardous: bool = False
    image_path: Optional[str] = None
    temporary_keeper_id: Optional[int] = None
    notes: Optional[str] = None


class InventoryUpdate(SQLModel):
    """DTO for updating inventory"""
    location: Optional[str] = None
    remaining_quantity: Optional[float] = None
    status: Optional[InventoryStatus] = None
    temporary_keeper_id: Optional[int] = None
    notes: Optional[str] = None
    english_name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None


class InventoryBorrowReturn(SQLModel):
    """DTO for borrow/return operations"""
    remaining_quantity: float = Field(ge=0)
    unit: str = Field(max_length=20)


class InventoryResponse(SQLModel):
    """DTO for inventory API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    location: Optional[str]
    initial_quantity: float
    remaining_quantity: float
    unit: str
    status: InventoryStatus
    borrower_id: Optional[int]
    last_borrower_id: Optional[int]
    is_hazardous: bool
    image_path: Optional[str]
    temporary_keeper_id: Optional[int]
    created_by_id: Optional[int]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    # Computed field: specification (e.g., "500ml")
    specification: Optional[str] = None
    # Computed fields: user names
    borrower_name: Optional[str] = None
    last_borrower_name: Optional[str] = None
    created_by_name: Optional[str] = None


class BorrowLog(SQLModel, table=True):
    """Borrow Log - Track borrow/return history"""
    id: Optional[int] = Field(default=None, primary_key=True)
    inventory_id: int = Field(
        index=True,
        foreign_key="inventory.id",
        ondelete="CASCADE"
    )
    borrower_id: int = Field(
        index=True,
        foreign_key="user.id",
        ondelete="CASCADE"
    )
    borrow_time: datetime = Field(default_factory=datetime.utcnow)
    return_time: Optional[datetime] = None
    quantity_borrowed: float = Field(gt=0)
    quantity_returned: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BorrowLogResponse(SQLModel):
    """DTO for borrow log API responses"""
    id: int
    inventory_id: int
    borrower_id: int
    borrow_time: datetime
    return_time: Optional[datetime]
    quantity_borrowed: float
    quantity_returned: Optional[float]
    notes: Optional[str]
    created_at: datetime


class ManualInventoryCreate(SQLModel):
    """DTO for manually adding inventory (not from Order)"""
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    specification: str = Field(max_length=50)  # e.g., "500ml"
    initial_quantity: Optional[float] = None  # Optional - derived from specification
    quantity_bottles: int = Field(default=1, ge=1)  # Number of bottles
    location: Optional[str] = None
    is_hazardous: bool = False
    category: Optional[str] = None
    brand: Optional[str] = None
    notes: Optional[str] = None
