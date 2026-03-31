"""CAS-driven name mapping models for common shelf."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class ChemicalCategory(str, Enum):
    ACID = "acid"
    BASE = "base"
    SALT = "salt"
    SOLVENT = "solvent"
    CATALYST = "catalyst"
    INDICATOR = "indicator"
    OTHER = "other"


class ChemicalNameMapBase(SQLModel):
    """Shared CAS mapping fields."""

    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias_1: Optional[str] = Field(default=None, max_length=200)
    alias_2: Optional[str] = Field(default=None, max_length=200)
    alias_3: Optional[str] = Field(default=None, max_length=200)
    category: Optional[ChemicalCategory] = Field(
        default=None,
        sa_column=Column(
            SAEnum(
                ChemicalCategory,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=True,
        ),
    )
    name_pinyin: Optional[str] = Field(default=None, max_length=200)
    name_initials: Optional[str] = Field(default=None, max_length=200)
    alias_1_pinyin: Optional[str] = Field(default=None, max_length=200)
    alias_1_initials: Optional[str] = Field(default=None, max_length=200)
    alias_2_pinyin: Optional[str] = Field(default=None, max_length=200)
    alias_2_initials: Optional[str] = Field(default=None, max_length=200)
    alias_3_pinyin: Optional[str] = Field(default=None, max_length=200)
    alias_3_initials: Optional[str] = Field(default=None, max_length=200)


class ChemicalNameMap(ChemicalNameMapBase, table=True):
    """CAS master data for display and search."""

    __tablename__ = "chemical_name_map"
    __table_args__ = (
        Index("ix_chemical_name_map_category", "category"),
        Index("ix_chemical_name_map_name_pinyin", "name_pinyin"),
        Index("ix_chemical_name_map_name_initials", "name_initials"),
        Index("ix_chemical_name_map_alias_1_pinyin", "alias_1_pinyin"),
        Index("ix_chemical_name_map_alias_1_initials", "alias_1_initials"),
        Index("ix_chemical_name_map_alias_2_pinyin", "alias_2_pinyin"),
        Index("ix_chemical_name_map_alias_2_initials", "alias_2_initials"),
        Index("ix_chemical_name_map_alias_3_pinyin", "alias_3_pinyin"),
        Index("ix_chemical_name_map_alias_3_initials", "alias_3_initials"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    cas_number: str = Field(unique=True, index=True, max_length=50)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class ChemicalNameMapCreate(SQLModel):
    """Create payload for CAS master data."""

    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias_1: Optional[str] = Field(default=None, max_length=200)
    alias_2: Optional[str] = Field(default=None, max_length=200)
    alias_3: Optional[str] = Field(default=None, max_length=200)
    category: Optional[ChemicalCategory] = None


class ChemicalNameMapUpdate(SQLModel):
    """Update payload for CAS master data."""

    name: Optional[str] = Field(default=None, max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias_1: Optional[str] = Field(default=None, max_length=200)
    alias_2: Optional[str] = Field(default=None, max_length=200)
    alias_3: Optional[str] = Field(default=None, max_length=200)
    category: Optional[ChemicalCategory] = None


class ChemicalNameMapResponse(BaseResponse):
    """CAS master data response."""

    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias_1: Optional[str]
    alias_2: Optional[str]
    alias_3: Optional[str]
    category: Optional[ChemicalCategory]
    created_at: datetime
    updated_at: datetime
