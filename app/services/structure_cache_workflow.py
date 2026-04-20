"""Write workflows for structure cache resolve and manual confirmation."""
from __future__ import annotations

import json
from dataclasses import replace

from sqlmodel import Session

from app.core.config import settings
from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureSource,
    CompoundStructureStatus,
)
from app.services.cas_utils import is_valid_cas, normalize_cas
from app.services.pubchem_resolver import PubChemResolver, create_pubchem_client
from app.services.structure_cache_repo import (
    StructureCacheWrite,
    get_structure_cache,
    upsert_structure_cache,
)
from app.services.structure_index import structure_index
from app.services.structure_normalizer import normalize_structure_from_molblock


class StructureWorkflowError(Exception):
    """Base exception for structure cache write workflow failures."""


class StructureFeatureDisabledError(StructureWorkflowError):
    """Raised when a resolver write path is disabled by configuration."""


class StructureManualProtectedError(StructureWorkflowError):
    """Raised when an automatic workflow would overwrite a manual structure."""


class StructureValidationError(StructureWorkflowError):
    """Raised when user-supplied structure data is invalid."""


def _min_interval_seconds(rate_limit_per_second: float) -> float:
    if rate_limit_per_second <= 0:
        return 0.5
    return 1 / rate_limit_per_second


def _ensure_pubchem_enabled() -> None:
    if not settings.chem_resolver_pubchem_enabled:
        raise StructureFeatureDisabledError("PubChem resolver is disabled")


def _normalize_valid_cas(cas_number: str) -> str:
    normalized = normalize_cas(cas_number)
    if not is_valid_cas(normalized):
        raise StructureValidationError("Invalid CAS checksum or format")
    return str(normalized)


def _ensure_manual_can_be_overwritten(
    existing: CompoundStructureCache | None,
    *,
    overwrite_manual: bool,
) -> None:
    if existing and existing.manually_verified and not overwrite_manual:
        raise StructureManualProtectedError("Manual structure is protected")


def _stored_candidate_cids(existing: CompoundStructureCache | None) -> set[int]:
    if not existing or not existing.candidates_json:
        return set()
    try:
        candidates = json.loads(existing.candidates_json)
    except json.JSONDecodeError:
        return set()
    if not isinstance(candidates, list):
        return set()
    return {
        cid
        for candidate in candidates
        if isinstance(candidate, dict)
        and isinstance((cid := candidate.get("cid")), int)
    }


def _ensure_cid_is_stored_candidate(
    existing: CompoundStructureCache | None,
    cid: int,
) -> None:
    if existing is None or existing.status != CompoundStructureStatus.AMBIGUOUS:
        raise StructureValidationError("Resolve CAS before confirming a PubChem candidate")
    if cid not in _stored_candidate_cids(existing):
        raise StructureValidationError("PubChem CID is not a stored candidate for this CAS")


def _write_cache_result(
    db: Session,
    payload: StructureCacheWrite,
    *,
    skip_manual: bool,
) -> CompoundStructureCache:
    cache = upsert_structure_cache(db, payload, skip_manual=skip_manual)
    db.commit()
    db.refresh(cache)
    structure_index.mark_dirty()
    return cache


async def resolve_cas_to_cache(
    db: Session,
    *,
    cas_number: str,
    force: bool,
    overwrite_manual: bool,
) -> CompoundStructureCache:
    """Resolve one CAS through PubChem and persist the resulting cache row."""
    _ensure_pubchem_enabled()
    existing = get_structure_cache(db, cas_number)
    if existing and existing.status == CompoundStructureStatus.RESOLVED and not force:
        return existing
    _ensure_manual_can_be_overwritten(existing, overwrite_manual=overwrite_manual)

    async with create_pubchem_client(
        timeout_seconds=settings.chem_pubchem_timeout_seconds,
        user_agent=settings.chem_pubchem_user_agent,
    ) as client:
        resolver = PubChemResolver(
            client,
            min_interval_seconds=_min_interval_seconds(settings.chem_pubchem_rate_limit_per_second),
            max_retries=settings.chem_pubchem_max_retries,
        )
        result = await resolver.resolve_cas(cas_number)
    return _write_cache_result(
        db,
        result.to_cache_write(),
        skip_manual=not overwrite_manual,
    )


async def confirm_pubchem_cid_to_cache(
    db: Session,
    *,
    cas_number: str,
    cid: int,
    overwrite_manual: bool,
) -> CompoundStructureCache:
    """Persist a manually selected PubChem CID as a verified cache row."""
    _ensure_pubchem_enabled()
    normalized_cas = _normalize_valid_cas(cas_number)
    existing = get_structure_cache(db, normalized_cas)
    _ensure_manual_can_be_overwritten(existing, overwrite_manual=overwrite_manual)
    _ensure_cid_is_stored_candidate(existing, cid)

    async with create_pubchem_client(
        timeout_seconds=settings.chem_pubchem_timeout_seconds,
        user_agent=settings.chem_pubchem_user_agent,
    ) as client:
        resolver = PubChemResolver(
            client,
            min_interval_seconds=_min_interval_seconds(settings.chem_pubchem_rate_limit_per_second),
            max_retries=settings.chem_pubchem_max_retries,
        )
        result = await resolver.resolve_pubchem_cid(normalized_cas, cid)
    payload = result.to_cache_write()
    if payload.status == CompoundStructureStatus.RESOLVED:
        payload = replace(payload, manually_verified=True)
    return _write_cache_result(db, payload, skip_manual=not overwrite_manual)


def save_manual_molblock_to_cache(
    db: Session,
    *,
    cas_number: str,
    molblock: str,
) -> CompoundStructureCache:
    """Normalize a manually drawn MolBlock and persist it as verified."""
    normalized_cas = _normalize_valid_cas(cas_number)
    normalized = normalize_structure_from_molblock(molblock)
    if normalized.status != CompoundStructureStatus.RESOLVED:
        raise StructureValidationError(normalized.error_message or "Invalid MolBlock")
    return _write_cache_result(
        db,
        StructureCacheWrite(
            cas_number=normalized_cas,
            status=CompoundStructureStatus.RESOLVED,
            source=CompoundStructureSource.MANUAL,
            smiles_canonical=normalized.smiles_canonical,
            smiles_isomeric=normalized.smiles_isomeric,
            molblock=normalized.molblock,
            inchikey=normalized.inchikey,
            confidence=100,
            candidate_count=1,
            manually_verified=True,
        ),
        skip_manual=False,
    )
