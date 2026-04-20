"""Compound structure cache models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import ConfigDict
from sqlalchemy import Column, Enum as SAEnum, Index
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse


class CompoundStructureStatus(str, Enum):
    """Resolution status for one CAS structure cache record."""

    PENDING = "pending"
    RESOLVED = "resolved"
    AMBIGUOUS = "ambiguous"
    NOT_FOUND = "not_found"
    UNSUPPORTED = "unsupported"
    INVALID_CAS = "invalid_cas"
    ERROR = "error"


class CompoundStructureSource(str, Enum):
    """Known structure data sources."""

    PUBCHEM = "pubchem"
    MANUAL = "manual"
    COMMON_CHEMISTRY = "commonchemistry"
    OTHER = "other"


class CompoundStructureCache(SQLModel, table=True):
    """Local cache for resolved chemical structures keyed by normalized CAS."""

    __tablename__ = "compound_structure_cache"
    __table_args__ = (
        Index("ix_structure_cache_status", "status"),
        Index("ix_structure_cache_inchikey", "inchikey"),
        Index("ix_structure_cache_source", "source", "source_id"),
    )

    cas_number: str = Field(primary_key=True, max_length=50)
    smiles_canonical: str | None = Field(default=None, max_length=1000)
    smiles_isomeric: str | None = Field(default=None, max_length=1000)
    molblock: str | None = Field(default=None)
    inchikey: str | None = Field(default=None, max_length=64)
    molecular_formula: str | None = Field(default=None, max_length=100)
    molecular_weight: float | None = Field(default=None)
    english_name: str | None = Field(default=None, max_length=500)
    chinese_name: str | None = Field(default=None, max_length=500)
    chinese_name_is_translated: bool = Field(default=False)
    name_error_message: str | None = Field(default=None, max_length=1000)
    name_last_resolved_at: datetime | None = Field(default=None)
    source: CompoundStructureSource | None = Field(
        default=None,
        sa_column=Column(
            SAEnum(
                CompoundStructureSource,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=True,
        ),
    )
    source_id: str | None = Field(default=None, max_length=100)
    source_url: str | None = Field(default=None, max_length=500)
    status: CompoundStructureStatus = Field(
        default=CompoundStructureStatus.PENDING,
        sa_column=Column(
            SAEnum(
                CompoundStructureStatus,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
            default=CompoundStructureStatus.PENDING.value,
        ),
    )
    confidence: int = Field(default=0, ge=0, le=100)
    candidate_count: int = Field(default=0, ge=0)
    candidates_json: str | None = Field(default=None)
    error_message: str | None = Field(default=None, max_length=1000)
    manually_verified: bool = Field(default=False)
    last_resolved_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )


class CompoundStructureCacheResponse(BaseResponse):
    """Public response shape for one structure cache row."""

    model_config = ConfigDict(from_attributes=True)

    cas_number: str
    smiles_canonical: str | None
    smiles_isomeric: str | None
    molblock: str | None = None
    inchikey: str | None
    molecular_formula: str | None
    molecular_weight: float | None
    english_name: str | None
    chinese_name: str | None
    chinese_name_is_translated: bool
    name_error_message: str | None
    name_last_resolved_at: datetime | None
    source: CompoundStructureSource | None
    source_id: str | None
    source_url: str | None
    status: CompoundStructureStatus
    confidence: int
    candidate_count: int
    candidates_json: str | None
    error_message: str | None
    manually_verified: bool
    last_resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class StructureCacheStatusCount(BaseResponse):
    """Status count row used by admin/status endpoints and scripts."""

    status: CompoundStructureStatus
    count: int
