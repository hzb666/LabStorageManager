"""
Inventory Model - Laboratory Reagents and Consumables Tracking
Critical Rule #2: CAS Number must be normalized (uppercase, no spaces)
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Index
from app.core.constants import MAX_BOTTLES_PER_IMPORT
from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from sqlmodel import Field, SQLModel


class InventoryStatus(str, Enum):
    """Inventory status enumeration"""
    NOT_IN_STOCK = "not_in_stock"
    IN_STOCK = "in_stock"
    RUN_SHORT = "run_short"
    BORROWED = "borrowed"
    CONSUMED = "consumed"


class InventoryBase(SQLModel):
    """Base inventory model with common fields"""
    # Critical: CAS Number copied from Order (already normalized)
    cas_number: str = Field(index=True, max_length=50)
    name: str = Field(index=True, max_length=200)  # 排序/搜索常用
    english_name: Optional[str] = Field(None, max_length=200)  # English name
    alias: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(index=True, max_length=100)  # 排序/搜索常用
    brand: Optional[str] = Field(index=True, max_length=100)  # 排序/搜索常用
    storage_location: Optional[str] = Field(index=True, max_length=200)  # 排序/搜索常用
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: Optional[float] = Field(default=None)
    remaining_quantity: Optional[float] = Field(default=None)
    # 剩余百分比：remaining_quantity / initial_quantity，存储到数据库用于排序
    remaining_percent: Optional[float] = Field(default=None, index=True)
    unit: Optional[str] = Field(default=None, max_length=20)  # Case-insensitive storage
    is_hazardous: bool = False
    notes: Optional[str] = Field(None, max_length=500)  # User custom notes


class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    __table_args__ = (
        Index("ix_inventory_is_common_created_at_id", "is_common", "created_at", "id"),
        Index("ix_inventory_status_created_at_id", "status", "created_at", "id"),
        Index("ix_inventory_borrower_status_updated_at", "borrower_id", "status", "updated_at"),
        Index("ix_inventory_keeper_location_created_at", "temporary_keeper_id", "storage_location", "created_at"),
        Index("ix_inventory_cas_status_created_at", "cas_number", "status", "created_at"),
        Index("ix_inventory_created_by_created_at_id", "created_by_id", "created_at", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # Unique internal code: e.g., "64175-250113-001" (CAS-Date-Sequence)
    internal_code: str = Field(unique=True, index=True, max_length=50)
    is_common: bool = Field(index=True, default=False)
    status: InventoryStatus = Field(index=True, default=InventoryStatus.IN_STOCK)  # 排序/筛选常用
    borrower_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    last_borrower_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    temporary_keeper_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    source_order_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="reagent_order.id",
        ondelete="SET NULL"
    )
    created_by_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    created_at: datetime = Field(default_factory=get_utc_now, index=True)  # 排序常用
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
    storage_location_pinyin: Optional[str] = Field(default=None, index=True, max_length=200)
    storage_location_pinyin_initials: Optional[str] = Field(default=None, index=True, max_length=200)


class InventoryCreate(SQLModel):
    """DTO for creating inventory from Order"""
    internal_code: str = Field(max_length=50)
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    storage_location: Optional[str] = None
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: Optional[float] = None
    remaining_quantity: Optional[float] = None
    # 可选：允许显式传入，默认由后端根据数量自动计算
    remaining_percent: Optional[float] = None
    unit: Optional[str] = Field(default=None, max_length=20)
    is_hazardous: bool = False
    temporary_keeper_id: Optional[int] = None
    source_order_id: Optional[int] = None
    notes: Optional[str] = None


class InventoryUpdate(SQLModel):
    """DTO for updating inventory"""
    name: Optional[str] = None
    cas_number: Optional[str] = None
    storage_location: Optional[str] = None
    remaining_quantity: Optional[float] = None
    # 可选：通常由后端根据 remaining_quantity / initial_quantity 自动维护
    remaining_percent: Optional[float] = None
    status: Optional[InventoryStatus] = None
    temporary_keeper_id: Optional[int] = None
    source_order_id: Optional[int] = None
    notes: Optional[str] = None
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    is_hazardous: Optional[bool] = None
    # 仅用于常用货架分组编辑，表示是否标记为快用完
    is_running_short: Optional[bool] = None
    # 规格字段：前端传入规格字符串（如 "500ml"），后端用 parse_specification 解析
    specification: Optional[str] = None


class InventoryBorrowReturn(SQLModel):
    """DTO for borrow/return operations"""
    remaining_quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, max_length=20)


class InventoryBorrowRequest(SQLModel):
    """DTO for borrow operation."""
    actual_borrower_id: Optional[int] = Field(default=None, ge=1)


class InventoryResponse(BaseResponse):
    """DTO for inventory API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    storage_location: Optional[str]
    # 允许 NULL 以兼容旧数据
    initial_quantity: Optional[float]
    remaining_quantity: Optional[float]
    remaining_percent: Optional[float]
    unit: Optional[str]
    is_common: bool
    status: InventoryStatus
    borrower_id: Optional[int]
    last_borrower_id: Optional[int]
    is_hazardous: bool
    temporary_keeper_id: Optional[int]
    source_order_id: Optional[int]
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
    temporary_keeper_name: Optional[str] = None


class BorrowLog(SQLModel, table=True):
    """Borrow Log - Track borrow/return history"""
    __table_args__ = (
        Index("ix_borrowlog_borrower_consume_borrow_time", "borrower_id", "is_consume", "borrow_time"),
        Index("ix_borrowlog_inventory_consume_return_borrow", "inventory_id", "is_consume", "return_time", "borrow_time"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    inventory_id: int = Field(
        index=True,
        foreign_key="inventory.id",
        ondelete="CASCADE"
    )
    borrower_id: int = Field(
        index=True,
        foreign_key="users.id",
        ondelete="CASCADE"
    )
    borrow_time: datetime = Field(default_factory=get_utc_now)
    is_consume: bool = Field(default=False)
    return_time: Optional[datetime] = None
    quantity_borrowed: float = Field(gt=0)
    quantity_returned: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=get_utc_now)


class BorrowLogResponse(BaseResponse):
    """DTO for borrow log API responses"""
    id: int
    inventory_id: int
    borrower_id: int
    borrow_time: datetime
    is_consume: bool
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
    quantity_bottles: int = Field(default=1, ge=1, le=MAX_BOTTLES_PER_IMPORT)  # Number of bottles: 1-99
    storage_location: Optional[str] = None
    is_hazardous: bool = False
    category: Optional[str] = None
    brand: Optional[str] = None
    notes: Optional[str] = None
