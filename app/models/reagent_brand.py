"""Reagent brand master data models."""
from __future__ import annotations

from datetime import datetime

from pydantic import ConfigDict, field_validator
from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


def _strip_brand_name(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class ReagentBrand(SQLModel, table=True):
    """Managed brand option used by reagent order forms."""

    __tablename__ = "reagent_brand"
    __table_args__ = (
        Index("ux_reagent_brand_name_normalized", "name_normalized", unique=True),
        Index("ix_reagent_brand_active_name_normalized", "is_active", "name_normalized"),
        Index("ix_reagent_brand_active_name_pinyin", "is_active", "name_pinyin"),
        Index(
            "ix_reagent_brand_active_name_pinyin_initials",
            "is_active",
            "name_pinyin_initials",
        ),
        Index("ix_reagent_brand_active_updated_at_id", "is_active", "updated_at", "id"),
    )

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)
    name_normalized: str = Field(max_length=100)
    name_pinyin: str | None = Field(default=None, max_length=200)
    name_pinyin_initials: str | None = Field(default=None, max_length=200)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class ReagentBrandCreate(SQLModel):
    """Create payload for reagent brand master data."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return _strip_brand_name(value)


class ReagentBrandUpdate(SQLModel):
    """Update payload for reagent brand master data."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return _strip_brand_name(value)


class ReagentBrandResponse(BaseResponse):
    """Reagent brand master data response."""

    id: int
    name: str
    name_normalized: str
    name_pinyin: str | None
    name_pinyin_initials: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
