"""Common shelf models."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

from app.core.constants import MAX_BOTTLES_PER_IMPORT
from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from app.models.chemical_name_map import ChemicalCategory


class CommonShelfBase(SQLModel):
    """Shared common shelf fields."""

    cas_number: str = Field(max_length=50)
    name_snapshot: str = Field(min_length=1, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=100)
    brand_normalized: str = Field(max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    specification_text: str = Field(max_length=50)
    spec_quantity: float
    spec_unit: str = Field(max_length=20)
    specification_normalized: str = Field(max_length=50)
    storage_location: Optional[str] = Field(default=None, max_length=200)
    storage_location_normalized: Optional[str] = Field(default=None, max_length=200)
    storage_location_pinyin: Optional[str] = Field(default=None, max_length=200)
    storage_location_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=100)


class CommonShelf(CommonShelfBase, table=True):
    """Current common shelf bottles, one row per bottle."""

    __tablename__ = "common_shelf"
    __table_args__ = (
        Index("ix_common_shelf_cas_created_at", "cas_number", "created_at", "id"),
        Index(
            "ix_common_shelf_group_created_at",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
            "created_at",
            "id",
        ),
        Index(
            "ix_common_shelf_group_location_created_at",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
            "storage_location_normalized",
            "created_at",
            "id",
        ),
        Index(
            "ix_common_shelf_group_location_pinyin_created_at",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
            "storage_location_pinyin",
            "created_at",
            "id",
        ),
        Index(
            "ix_common_shelf_group_location_pinyin_initials_created_at",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
            "storage_location_pinyin_initials",
            "created_at",
            "id",
        ),
        Index("ix_common_shelf_source_order_created_at", "source_order_id", "created_at"),
        Index("ix_common_shelf_creator_created_at", "created_by_id", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    internal_code: str = Field(unique=True, index=True, max_length=50)
    source_order_id: Optional[int] = Field(
        default=None,
        foreign_key="reagent_order.id",
        ondelete="SET NULL",
    )
    created_by_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class CommonShelfGroup(SQLModel, table=True):
    """Persistent common shelf group identity, even when bottle count is zero."""

    __tablename__ = "common_shelf_group"
    __table_args__ = (
        Index(
            "ux_common_shelf_group_active_identity",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
            unique=True,
            sqlite_where=text("is_deleted = 0"),
        ),
        Index(
            "ix_common_shelf_group_active_updated_at",
            "is_deleted",
            "updated_at",
            "id",
        ),
        Index(
            "ix_common_shelf_group_active_cas",
            "is_deleted",
            "cas_number",
            "updated_at",
            "id",
        ),
        Index(
            "ix_common_shelf_group_identity",
            "cas_number",
            "brand_normalized",
            "specification_normalized",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    cas_number: str = Field(max_length=50)
    name_snapshot: str = Field(min_length=1, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=100)
    brand_normalized: str = Field(max_length=100)
    # Compatibility columns only. Purity and notes belong to bottle rows.
    purity: Optional[str] = Field(default=None, max_length=20)
    specification_text: str = Field(max_length=50)
    spec_quantity: float
    spec_unit: str = Field(max_length=20)
    specification_normalized: str = Field(max_length=50)
    # Compatibility columns only. Purity and notes belong to bottle rows.
    notes: Optional[str] = Field(default=None, max_length=100)
    created_by_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    is_deleted: bool = Field(default=False)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )
    deleted_at: Optional[datetime] = Field(default=None)


class CommonShelfResponse(BaseResponse):
    """Common shelf row response."""

    id: int
    internal_code: str
    cas_number: str
    name_snapshot: str
    brand: Optional[str]
    brand_normalized: str
    purity: Optional[str]
    specification_text: str
    spec_quantity: float
    spec_unit: str
    specification_normalized: str
    storage_location: Optional[str]
    storage_location_normalized: Optional[str]
    storage_location_pinyin: Optional[str]
    storage_location_pinyin_initials: Optional[str]
    notes: Optional[str]
    source_order_id: Optional[int]
    created_by_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class CommonShelfGroupIdentity(BaseResponse):
    """Stable group identity returned to the frontend."""

    group_key: str
    cas_number: str
    brand: Optional[str]
    brand_normalized: str
    specification_text: str
    specification_normalized: str


class CommonShelfGroupDisplay(BaseResponse):
    """Display metadata for a grouped common-shelf row."""

    name: str
    english_name: Optional[str]
    category: Optional[ChemicalCategory]


class CommonShelfGroupResponse(BaseResponse):
    """Grouped common-shelf row response."""

    group: CommonShelfGroupIdentity
    display: CommonShelfGroupDisplay
    bottle_count: int
    location_count: int
    latest_name_snapshot: str
    created_at: datetime
    updated_at: datetime


class CommonShelfLocationSummaryResponse(BaseResponse):
    """Aggregated location summary inside one group."""

    storage_location: Optional[str]
    bottle_count: int
    oldest_created_at: datetime


class CommonShelfGroupListResponse(BaseResponse):
    """Paginated grouped common-shelf response."""

    data: list[CommonShelfGroupResponse]
    current: int
    total: int
    skip: int
    limit: int


class CommonShelfManualCreate(SQLModel):
    """Manual common-shelf add request."""

    cas_number: str = Field(max_length=50)
    name_snapshot: str = Field(min_length=1, max_length=200)
    brand: Optional[str] = Field(default=None, max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    specification: str = Field(max_length=50)
    count: int = Field(default=1, ge=1, le=MAX_BOTTLES_PER_IMPORT)
    storage_location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=100)


class CommonShelfGroupEditRequest(SQLModel):
    """Edit current group brand/specification only."""

    model_config = ConfigDict(extra="forbid")

    brand: Optional[str] = Field(default=None, max_length=100)
    specification: str = Field(max_length=50)
    confirm_merge: bool = False


class CommonShelfGroupItemResponse(BaseResponse):
    """Editable per-bottle fields inside one common-shelf group."""

    id: int
    internal_code: str
    purity: Optional[str]
    storage_location: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class CommonShelfGroupItemUpdateRequest(SQLModel):
    """One changed bottle payload from item-edit mode."""

    model_config = ConfigDict(extra="forbid")

    purity: Optional[str] = Field(default=None, max_length=20)
    storage_location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=100)


class CommonShelfAddBottlesRequest(SQLModel):
    """Add bottles to an existing group."""

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=1, le=MAX_BOTTLES_PER_IMPORT)
    storage_location: Optional[str] = Field(default=None, max_length=200)
    purity: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=100)


class CommonShelfRemoveOneRequest(SQLModel):
    """Remove the earliest bottle from a chosen location."""

    model_config = ConfigDict(extra="forbid")

    storage_location: Optional[str] = Field(default=None, max_length=200)
