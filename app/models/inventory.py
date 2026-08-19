"""库存模型。"""
from datetime import datetime
from enum import Enum

from pydantic import ConfigDict, field_validator
from sqlalchemy import Column, Index, asc, desc
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.core.constants import MAX_BOTTLES_PER_IMPORT
from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


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
    english_name: str | None = Field(None, max_length=200)  # 英文名称
    alias: str | None = Field(None, max_length=200)
    category: str | None = Field(max_length=100)  # 排序/搜索常用
    brand: str | None = Field(max_length=100)  # 排序/搜索常用
    purity: str | None = Field(default=None, max_length=20)
    storage_location: str | None = Field(max_length=200)  # 排序/搜索常用
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: float | None = Field(default=None)
    remaining_quantity: float | None = Field(default=None)
    # 剩余百分比：remaining_quantity / initial_quantity，存储到数据库用于排序
    remaining_percent: float | None = Field(default=None)
    unit: str | None = Field(default=None, max_length=20)  # 不区分大小写存储
    is_hazardous: bool = False
    notes: str | None = Field(None, max_length=500)  # 用户自定义备注


class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    __table_args__ = (
        # 搜索和排序加速：使用可命中 B-Tree 的索引。
        Index("ix_inventory_cas_number_created_at_id", asc("cas_number"), desc("created_at"), desc("id")),
        Index(
            "ix_inventory_cas_number_desc_created_at_id",
            desc("cas_number"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_inventory_name_pinyin_created_at_id", asc("name_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_inventory_name_pinyin_desc_created_at_id",
            desc("name_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_inventory_name_pinyin_initials_created_at_id", asc("name_pinyin_initials"), desc("created_at"), desc("id")),
        Index("ix_inventory_category_pinyin_created_at_id", asc("category_pinyin"), desc("created_at"), desc("id")),
        Index("ix_inventory_category_pinyin_initials_created_at_id", asc("category_pinyin_initials"), desc("created_at"), desc("id")),
        Index(
            "ix_inventory_category_pinyin_desc_created_at_id",
            desc("category_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_inventory_brand_pinyin_created_at_id", asc("brand_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_inventory_brand_pinyin_desc_created_at_id",
            desc("brand_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_inventory_brand_pinyin_initials_created_at_id", asc("brand_pinyin_initials"), desc("created_at"), desc("id")),
        Index("ix_inventory_storage_location_created_at_id", asc("storage_location"), desc("created_at"), desc("id")),
        Index("ix_inventory_storage_location_pinyin_created_at_id", asc("storage_location_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_inventory_storage_location_pinyin_desc_created_at_id",
            desc("storage_location_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index(
            "ix_inventory_storage_location_pinyin_initials_created_at_id",
            asc("storage_location_pinyin_initials"),
            desc("created_at"),
            desc("id"),
        ),
        Index(
            "ix_inventory_remaining_percent_created_at_id",
            desc("remaining_percent"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_inventory_created_at_id", desc("created_at"), desc("id")),
        Index("ix_inventory_created_at_asc_id_desc", asc("created_at"), desc("id")),
        Index("ix_inventory_status_created_at_id", asc("status"), desc("created_at"), desc("id")),
        Index("ix_inventory_borrower_status_updated_at", asc("borrower_id"), asc("status"), desc("updated_at")),
        Index(
            "ix_inventory_keeper_location_created_at",
            asc("temporary_keeper_id"),
            asc("storage_location"),
            desc("created_at"),
        ),
        Index("ix_inventory_created_by_created_at_id", asc("created_by_id"), desc("created_at"), desc("id")),
    )

    id: int | None = Field(default=None, primary_key=True)
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
    borrower_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    last_borrower_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    temporary_keeper_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    source_order_id: int | None = Field(
        default=None,
        index=True,
        foreign_key="reagent_order.id",
        ondelete="SET NULL"
    )
    created_by_id: int | None = Field(
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
    name_pinyin: str | None = Field(default=None, max_length=200)
    name_pinyin_initials: str | None = Field(default=None, max_length=200)
    category_pinyin: str | None = Field(default=None, max_length=200)
    category_pinyin_initials: str | None = Field(default=None, max_length=200)
    brand_pinyin: str | None = Field(default=None, max_length=200)
    brand_pinyin_initials: str | None = Field(default=None, max_length=200)
    storage_location_pinyin: str | None = Field(default=None, max_length=200)
    storage_location_pinyin_initials: str | None = Field(default=None, max_length=200)


class InventoryCreate(SQLModel):
    """DTO for creating inventory from Order"""
    internal_code: str = Field(max_length=50)
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: str | None = None
    alias: str | None = None
    category: str | None = None
    brand: str | None = None
    purity: str | None = Field(default=None, max_length=20)
    storage_location: str | None = None
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: float | None = None
    remaining_quantity: float | None = None
    # 可选：允许显式传入，默认由后端根据数量自动计算
    remaining_percent: float | None = None
    unit: str | None = Field(default=None, max_length=20)
    is_hazardous: bool = False
    temporary_keeper_id: int | None = None
    source_order_id: int | None = None
    notes: str | None = None


class InventoryUpdate(SQLModel):
    """DTO for updating inventory"""
    # 安全边界：拒绝未声明字段，避免静默忽略带来的越权探测面
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    cas_number: str | None = Field(default=None, max_length=50)
    storage_location: str | None = None
    remaining_quantity: float | None = Field(default=None, ge=0)
    notes: str | None = None
    english_name: str | None = None
    alias: str | None = None
    category: str | None = None
    brand: str | None = None
    purity: str | None = None
    is_hazardous: bool | None = None
    # 规格字段：前端传入规格字符串（如 "500mL"），后端用 parse_specification 解析
    specification: str | None = Field(default=None, max_length=50)

    @field_validator("name", "cas_number", "brand", "specification", mode="before")
    @classmethod
    def strip_supplied_required_text(cls, value: str | None) -> str | None:
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
    specification: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)


class InventoryBorrowRequest(SQLModel):
    """DTO for borrow operation."""
    model_config = ConfigDict(extra="forbid")

    actual_borrower_id: int | None = Field(default=None)


class InventoryResponse(BaseResponse):
    """DTO for inventory API responses"""
    id: int
    internal_code: str
    cas_number: str
    name: str
    english_name: str | None
    alias: str | None
    category: str | None
    brand: str | None
    purity: str | None
    storage_location: str | None
    # 允许 NULL 以兼容旧数据
    initial_quantity: float | None
    remaining_quantity: float | None
    remaining_percent: float | None
    unit: str | None
    status: InventoryStatus
    borrower_id: int | None
    last_borrower_id: int | None
    is_hazardous: bool
    temporary_keeper_id: int | None
    source_order_id: int | None
    created_by_id: int | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    # 计算字段：规格，如 "500mL"
    specification: str | None = None
    # 计算字段：用户名称
    borrower_name: str | None = None
    last_borrower_name: str | None = None
    created_by_name: str | None = None
    temporary_keeper_name: str | None = None


class BorrowLog(SQLModel, table=True):
    """Borrow Log - Track borrow/return history"""
    __table_args__ = (
        Index("ix_borrowlog_borrower_borrow_time", "borrower_id", "borrow_time"),
        Index("ix_borrowlog_inventory_borrow_time", "inventory_id", "borrow_time"),
    )

    id: int | None = Field(default=None, primary_key=True)
    inventory_id: int = Field(
        foreign_key="inventory.id",
        ondelete="CASCADE"
    )
    borrower_id: int = Field(
        foreign_key="users.id",
        ondelete="CASCADE"
    )
    borrow_time: datetime = Field(default_factory=get_utc_now)
    return_time: datetime | None = None
    quantity_borrowed: float = Field(ge=0)
    quantity_returned: float | None = None
    notes: str | None = None
    created_at: datetime = Field(default_factory=get_utc_now)


class BorrowLogResponse(BaseResponse):
    """DTO for borrow log API responses"""
    id: int
    inventory_id: int
    borrower_id: int
    borrow_time: datetime
    return_time: datetime | None
    quantity_borrowed: float
    quantity_returned: float | None
    notes: str | None
    created_at: datetime


class ManualInventoryCreate(SQLModel):
    """DTO for manually adding inventory (not from Order)"""
    model_config = ConfigDict(extra="forbid")

    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: str | None = None
    alias: str | None = None
    specification: str = Field(max_length=50)  # e.g., "500mL"
    initial_quantity: float | None = None  # Optional - derived from specification
    quantity_bottles: int = Field(default=1, ge=1, le=MAX_BOTTLES_PER_IMPORT)  # Number of bottles: 1-99
    storage_location: str | None = None
    is_hazardous: bool = False
    category: str | None = None
    brand: str = Field(max_length=100)
    purity: str | None = Field(default=None, max_length=20)
    notes: str | None = None

    @field_validator("cas_number", "name", "brand", "specification")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped
