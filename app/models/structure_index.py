"""Durable structure-index revision and resolution-job models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now
from app.models.compound_structure import CompoundStructureSource, CompoundStructureStatus


def _enum_column(enum_type: type[Enum], *, nullable: bool = False) -> Column:
    return Column(
        SAEnum(
            enum_type,
            native_enum=False,
            create_constraint=False,
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
            validate_strings=True,
        ),
        nullable=nullable,
    )


class StructureIndexChangeOperation(str, Enum):
    """Persistent operation applied to the derived RDKit index."""

    ADD_OR_UPDATE = "add_or_update"
    DELETE = "delete"


class StructureResolutionJobState(str, Enum):
    """Durable resolution job lifecycle."""

    QUEUED = "queued"
    RUNNING = "running"
    EXHAUSTED = "exhausted"


class StructureIndexMeta(SQLModel, table=True):
    """Single-row monotonic revision metadata."""

    __tablename__ = "structure_index_meta"

    id: int = Field(default=1, primary_key=True)
    generation_id: str = Field(default_factory=lambda: uuid4().hex, max_length=32)
    current_revision: int = Field(default=0, ge=0)
    last_compacted_revision: int = Field(default=0, ge=0)
    updated_at: datetime = Field(default_factory=get_utc_now)


class StructureIndexChange(SQLModel, table=True):
    """After-image change log consumed by structure-index processes."""

    __tablename__ = "structure_index_change"

    revision: int = Field(primary_key=True, ge=1)
    cas_number: str = Field(max_length=50)
    operation: StructureIndexChangeOperation = Field(
        sa_column=_enum_column(StructureIndexChangeOperation),
    )
    status: CompoundStructureStatus | None = Field(
        default=None,
        sa_column=_enum_column(CompoundStructureStatus, nullable=True),
    )
    smiles_canonical: str | None = Field(default=None, max_length=1000)
    smiles_isomeric: str | None = Field(default=None, max_length=1000)
    inchikey: str | None = Field(default=None, max_length=64)
    source: CompoundStructureSource | None = Field(
        default=None,
        sa_column=_enum_column(CompoundStructureSource, nullable=True),
    )
    created_at: datetime = Field(default_factory=get_utc_now)


class StructureResolutionJob(SQLModel, table=True):
    """One coalesced durable PubChem resolution job per normalized CAS."""

    __tablename__ = "structure_resolution_job"
    __table_args__ = (
        Index(
            "ix_structure_resolution_job_queued_due",
            "state",
            "next_attempt_at",
        ),
        Index(
            "ix_structure_resolution_job_expired_lease",
            "state",
            "lease_until",
        ),
    )

    cas_number: str = Field(primary_key=True, max_length=50)
    state: StructureResolutionJobState = Field(
        default=StructureResolutionJobState.QUEUED,
        sa_column=_enum_column(StructureResolutionJobState),
    )
    attempt_count: int = Field(default=0, ge=0)
    retry_count: int = Field(default=0, ge=0)
    next_attempt_at: datetime | None = Field(default_factory=get_utc_now)
    lease_token: str | None = Field(default=None, max_length=64)
    lease_until: datetime | None = Field(default=None)
    trigger_reason: str = Field(default="unspecified", max_length=100)
    last_error_code: str | None = Field(default=None, max_length=100)
    last_error_message: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
    )
