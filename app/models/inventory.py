"""库存模型。"""
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import ConfigDict, field_validator
from sqlalchemy import Column, Enum as SAEnum, Index
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
    # CAS 号从订单复制，进入库存前已标准化
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)  # 排序/搜索常用
    english_name: Optional[str] = Field(None, max_length=200)  # 英文名称
    alias: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(max_length=100)  # 排序/搜索常用
    brand: Optional[str] = Field(max_length=100)  # 排序/搜索常用
    purity: Optional[str] = Field(default=None, max_length=20)
    storage_location: Optional[str] = Field(max_length=200)  # 排序/搜索常用
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: Optional[float] = Field(default=None)
    remaining_quantity: Optional[float] = Field(default=None)
    # 剩余百分比：remaining_quantity / initial_quantity，存储到数据库用于排序
    remaining_percent: Optional[float] = Field(default=None)
    unit: Optional[str] = Field(default=None, max_length=20)  # 不区分大小写存储
    is_hazardous: bool = False
    notes: Optional[str] = Field(None, max_length=500)  # 用户自定义备注


class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    __table_args__ = (
        # 搜索和排序加速：使用可命中 B-Tree 的索引。
        Index("ix_inventory_cas_number_created_at_id", "cas_number", "created_at", "id"),
        Index("ix_inventory_name_pinyin_created_at_id", "name_pinyin", "created_at", "id"),
        Index("ix_inventory_name_pinyin_initials_created_at_id", "name_pinyin_initials", "created_at", "id"),
        Index("ix_inventory_category_pinyin_created_at_id", "category_pinyin", "created_at", "id"),
        Index("ix_inventory_category_pinyin_initials_created_at_id", "category_pinyin_initials", "created_at", "id"),
        Index("ix_inventory_brand_pinyin_created_at_id", "brand_pinyin", "created_at", "id"),
        Index("ix_inventory_brand_pinyin_initials_created_at_id", "brand_pinyin_initials", "created_at", "id"),
        Index("ix_inventory_storage_location_created_at_id", "storage_location", "created_at", "id"),
        Index("ix_inventory_storage_location_pinyin_created_at_id", "storage_location_pinyin", "created_at", "id"),
        Index(
            "ix_inventory_storage_location_pinyin_initials_created_at_id",
            "storage_location_pinyin_initials",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_remaining_percent_created_at_id",
            "remaining_percent",
            "created_at",
            "id",
        ),
        Index("ix_inventory_created_at_id", "created_at", "id"),
        Index("ix_inventory_status_created_at_id", "status", "created_at", "id"),
        Index("ix_inventory_borrower_status_updated_at", "borrower_id", "status", "updated_at"),
        Index(
            "ix_inventory_keeper_location_created_at",
            "temporary_keeper_id",
            "storage_location",
            "created_at",
        ),
        Index("ix_inventory_created_by_created_at_id", "created_by_id", "created_at", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # 唯一内部编码，如 "64175-250113-001"（CAS-日期-序号）
    internal_code: str = Field(unique=True, index=True, max_length=50)
    status: InventoryStatus = Field(
        default=InventoryStatus.IN_STOCK,
        sa_column=Column(
            SAEnum(
                InventoryStatus,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
            default=InventoryStatus.IN_STOCK.value,
        ),
    )  # 排序/筛选常用
    borrower_id: Optional[int] = Field(
        default=None,
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
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    created_at: datetime = Field(default_factory=get_utc_now)  # 排序常用
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )

    # 拼音排序字段（预计算，使用数据库索引加速排序）
    name_pinyin: Optional[str] = Field(default=None, max_length=200)
    name_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    category_pinyin: Optional[str] = Field(default=None, max_length=200)
    category_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    brand_pinyin: Optional[str] = Field(default=None, max_length=200)
    brand_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    storage_location_pinyin: Optional[str] = Field(default=None, max_length=200)
    storage_location_pinyin_initials: Optional[str] = Field(default=None, max_length=200)


class InventoryCreate(SQLModel):
    """DTO for creating inventory from Order"""
    internal_code: str = Field(max_length=50)
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    purity: Optional[str] = Field(default=None, max_length=20)
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
    # 安全边界：拒绝未声明字段，避免静默忽略带来的越权探测面
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, max_length=200)
    cas_number: Optional[str] = Field(default=None, max_length=50)
    storage_location: Optional[str] = None
    remaining_quantity: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    purity: Optional[str] = None
    is_hazardous: Optional[bool] = None
    # 规格字段：前端传入规格字符串（如 "500ml"），后端用 parse_specification 解析
    specification: Optional[str] = Field(default=None, max_length=50)

    @field_validator("name", "cas_number", "brand", "specification", mode="before")
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


class InventoryBorrowReturn(SQLModel):
    """DTO for borrow/return operations"""
    model_config = ConfigDict(extra="forbid")

    remaining_quantity: float = Field(ge=0)
    specification: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)


class InventoryBorrowRequest(SQLModel):
    """DTO for borrow operation."""
    model_config = ConfigDict(extra="forbid")

    actual_borrower_id: Optional[int] = Field(default=None)


class InventoryResponse(BaseResponse):
    """DTO for inventory API responses"""
    id: int
    internal_code: str
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    purity: Optional[str]
    storage_location: Optional[str]
    # 允许 NULL 以兼容旧数据
    initial_quantity: Optional[float]
    remaining_quantity: Optional[float]
    remaining_percent: Optional[float]
    unit: Optional[str]
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
    # 计算字段：规格，如 "500ml"
    specification: Optional[str] = None
    # 计算字段：用户名称
    borrower_name: Optional[str] = None
    last_borrower_name: Optional[str] = None
    created_by_name: Optional[str] = None
    temporary_keeper_name: Optional[str] = None


class BorrowLog(SQLModel, table=True):
    """Borrow Log - Track borrow/return history"""
    __table_args__ = (
        Index("ix_borrowlog_borrower_borrow_time", "borrower_id", "borrow_time"),
        Index("ix_borrowlog_inventory_borrow_time", "inventory_id", "borrow_time"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    inventory_id: int = Field(
        foreign_key="inventory.id",
        ondelete="CASCADE"
    )
    borrower_id: int = Field(
        foreign_key="users.id",
        ondelete="CASCADE"
    )
    borrow_time: datetime = Field(default_factory=get_utc_now)
    return_time: Optional[datetime] = None
    quantity_borrowed: float = Field(ge=0)
    quantity_returned: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=get_utc_now)


class BorrowLogResponse(BaseResponse):
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
    model_config = ConfigDict(extra="forbid")

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
    brand: str = Field(max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = None

    @field_validator("cas_number", "name", "brand", "specification")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped
