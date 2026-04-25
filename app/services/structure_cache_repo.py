"""Repository helpers for the compound structure cache."""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, func, select

from app.core.time_utils import get_utc_now
from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureSource,
    CompoundStructureStatus,
    StructureCacheStatusCount,
)
from app.models.inventory import Inventory
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS, normalize_cas


@dataclass(frozen=True)
class StructureCacheWrite:
    """Normalized write payload for one cache row."""

    cas_number: str
    status: CompoundStructureStatus
    source: CompoundStructureSource | None = None
    source_id: str | None = None
    source_url: str | None = None
    smiles_canonical: str | None = None
    smiles_isomeric: str | None = None
    molblock: str | None = None
    inchikey: str | None = None
    molecular_formula: str | None = None
    molecular_weight: float | None = None
    english_name: str | None = None
    confidence: int = 0
    candidate_count: int = 0
    candidates: Sequence[Mapping[str, Any]] | None = None
    error_message: str | None = None
    manually_verified: bool = False


@dataclass(frozen=True)
class StructureNameCacheWrite:
    """Name lookup payload for the external-source CAS cache."""

    cas_number: str
    english_name: str | None = None
    chinese_name: str | None = None
    chinese_name_is_translated: bool = False
    name_error_message: str | None = None


def _serialize_candidates(candidates: Sequence[Mapping[str, Any]] | None) -> str | None:
    if not candidates:
        return None
    return json.dumps(list(candidates), ensure_ascii=False, separators=(",", ":"))


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def get_structure_cache(
    db: Session,
    cas_number: str,
) -> CompoundStructureCache | None:
    """Fetch one structure cache row by normalized CAS."""
    normalized_cas = normalize_cas(cas_number)
    if not normalized_cas:
        return None
    return db.get(CompoundStructureCache, normalized_cas)


def get_distinct_inventory_cas_numbers(db: Session) -> list[str]:
    """Return normalized distinct CAS values currently present in inventory."""
    rows = db.exec(select(Inventory.cas_number).where(Inventory.cas_number != "")).all()
    cas_numbers = {
        normalized
        for raw_cas in rows
        if (normalized := normalize_cas(raw_cas)) and normalized != BIOLOGICAL_REAGENT_CAS
    }
    return sorted(cas_numbers)


def count_structure_cache_by_status(db: Session) -> list[StructureCacheStatusCount]:
    """Count structure cache rows grouped by status, including zero-count statuses."""
    statement = select(CompoundStructureCache.status, func.count()).group_by(
        CompoundStructureCache.status
    )
    counts = {status: 0 for status in CompoundStructureStatus}
    for status_value, count_value in db.exec(statement).all():
        counts[CompoundStructureStatus(status_value)] = int(count_value)
    return [
        StructureCacheStatusCount(status=status_value, count=count)
        for status_value, count in counts.items()
    ]


def _apply_structure_cache_payload(
    cache: CompoundStructureCache,
    payload: StructureCacheWrite,
) -> None:
    now = get_utc_now()
    cache.status = payload.status
    cache.source = payload.source
    cache.source_id = payload.source_id
    cache.source_url = payload.source_url
    cache.smiles_canonical = payload.smiles_canonical
    cache.smiles_isomeric = payload.smiles_isomeric
    cache.molblock = payload.molblock
    cache.inchikey = payload.inchikey
    cache.molecular_formula = payload.molecular_formula
    cache.molecular_weight = payload.molecular_weight
    if english_name := _normalize_optional_text(payload.english_name):
        cache.english_name = english_name
        cache.name_last_resolved_at = now
    cache.confidence = payload.confidence
    cache.candidate_count = payload.candidate_count
    cache.candidates_json = _serialize_candidates(payload.candidates)
    cache.error_message = payload.error_message
    cache.manually_verified = payload.manually_verified or cache.manually_verified
    cache.last_resolved_at = now
    cache.updated_at = now


def upsert_structure_cache(
    db: Session,
    payload: StructureCacheWrite,
    *,
    skip_manual: bool = True,
) -> CompoundStructureCache:
    """Insert or update a cache row while preserving manually verified structures."""
    normalized_cas = normalize_cas(payload.cas_number)
    if not normalized_cas:
        raise ValueError("CAS number is required")

    existing = db.get(CompoundStructureCache, normalized_cas)
    if existing is not None and skip_manual:
        db.refresh(existing)
    if existing and existing.manually_verified and skip_manual:
        return existing

    if existing is None:
        existing = CompoundStructureCache(cas_number=normalized_cas)
        db.add(existing)

    _apply_structure_cache_payload(existing, payload)
    return existing


def upsert_structure_cache_names(
    db: Session,
    payload: StructureNameCacheWrite,
) -> CompoundStructureCache:
    """Insert or update external name fields keyed by normalized CAS."""
    normalized_cas = normalize_cas(payload.cas_number)
    if not normalized_cas:
        raise ValueError("CAS number is required")

    existing = db.get(CompoundStructureCache, normalized_cas)
    if existing is None:
        existing = CompoundStructureCache(cas_number=normalized_cas)
        db.add(existing)

    now = get_utc_now()
    if english_name := _normalize_optional_text(payload.english_name):
        existing.english_name = english_name
    if chinese_name := _normalize_optional_text(payload.chinese_name):
        existing.chinese_name = chinese_name
        existing.chinese_name_is_translated = payload.chinese_name_is_translated

    existing.name_error_message = _normalize_optional_text(payload.name_error_message)
    existing.name_last_resolved_at = now
    existing.updated_at = now
    return existing


def upsert_structure_cache_error(
    db: Session,
    cas_number: str,
    error_message: str,
) -> CompoundStructureCache:
    """Persist an error status for one CAS without raising to the batch caller."""
    return upsert_structure_cache(
        db,
        StructureCacheWrite(
            cas_number=cas_number,
            status=CompoundStructureStatus.ERROR,
            error_message=error_message,
        ),
    )
