"""Chemical structure cache and search APIs."""
from __future__ import annotations

import logging
from datetime import datetime
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlmodel import func, select

from app.core.auth import CurrentSession, get_current_user, require_admin
from app.core.config import settings
from app.core.request_utils import get_request_is_cli, get_sse_client_id
from app.database import DBSession
from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureCacheResponse,
    CompoundStructureSource,
    CompoundStructureStatus,
)
from app.models.structure_index import StructureResolutionJob, StructureResolutionJobState
from app.services.api_utils import normalize_pagination
from app.services.cas_utils import normalize_cas
from app.services.search_query_log_service import buffer_search_log
from app.services.structure_cache_repo import get_structure_cache
from app.services.structure_cache_workflow import (
    StructureFeatureDisabledError,
    StructureManualProtectedError,
    StructureValidationError,
    confirm_pubchem_cid_to_cache,
    preview_pubchem_candidates,
    resolve_cas_to_cache,
    save_manual_molblock_to_cache,
)
from app.services.structure_index import (
    StructureIndexRevisionChangedError,
    StructureIndexSnapshot,
    StructureQueryFormat,
    StructureSearchMode,
    structure_index,
)
from app.services.structure_inventory_summary import (
    get_inventory_summaries_by_cas,
    get_visible_inventory_cas_numbers,
)
from app.services.structure_resolution_jobs import (
    StructureResolutionJobCounts,
    count_structure_resolution_jobs,
    enqueue_structure_resolution_job,
)
from app.services.structure_resolution_scheduler import structure_resolution_scheduler
from app.services.structure_search_cache import (
    clear_structure_search_cache,
    put_structure_search_results,
)

router = APIRouter(prefix="/chem", tags=["Chem"])
logger = logging.getLogger(__name__)

STRUCTURE_QUERY_MAX_LENGTH = 20_000
STRUCTURE_MOLBLOCK_MAX_LENGTH = 250_000


class StructureIndexStatusResponse(BaseModel):
    version: int
    dirty: bool
    molecule_count: int
    db_revision: int
    applied_revision: int
    revision_lag: int
    base_count: int
    delta_count: int
    tombstone_count: int
    last_compaction_duration_ms: float | None
    snapshot_loaded: bool
    resolution_jobs_queued: int | None = None
    resolution_jobs_running: int | None = None
    resolution_jobs_exhausted: int | None = None


class SubstructureSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=STRUCTURE_QUERY_MAX_LENGTH)
    format: StructureQueryFormat
    match_mode: StructureSearchMode = StructureSearchMode.SUBSTRUCTURE
    limit: int = Field(default=100, ge=1, le=1000)
    only_in_stock: bool = True


class ResolveCasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cas_number: str = Field(min_length=1, max_length=50)
    force: bool = False
    overwrite_manual: bool = False


class ManualStructureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    molblock: str = Field(min_length=1, max_length=STRUCTURE_MOLBLOCK_MAX_LENGTH)


class ConfirmPubChemCidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cid: int = Field(ge=1)
    overwrite_manual: bool = False


class PubChemCandidatePreviewResponse(BaseModel):
    cas_number: str
    status: CompoundStructureStatus
    confidence: int
    candidate_count: int
    candidates: list[dict[str, Any]]
    error_message: str | None


class InventorySummaryResponse(BaseModel):
    cas_number: str
    item_count: int
    preferred_name: str | None
    preferred_name_source: str | None
    display_name: str | None = None
    english_name: str | None
    locations: list[str]
    total_by_unit: dict[str, float]


class SubstructureSearchResult(BaseModel):
    cas_number: str
    smiles_canonical: str
    inchikey: str | None
    source: CompoundStructureSource | None
    similarity: float
    inventory_summary: InventorySummaryResponse | None


class SubstructureSearchResponse(BaseModel):
    search_id: str
    total: int
    limit: int
    elapsed_ms: float
    index: StructureIndexStatusResponse
    results: list[SubstructureSearchResult]


class StructureCacheListResponse(BaseModel):
    data: list[CompoundStructureCacheResponse]
    total: int
    skip: int
    limit: int


class StructureResolutionJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cas_number: str
    state: StructureResolutionJobState
    attempt_count: int
    retry_count: int
    next_attempt_at: datetime | None
    lease_until: datetime | None
    trigger_reason: str
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


class StructureResolutionJobListResponse(BaseModel):
    data: list[StructureResolutionJobResponse]
    total: int
    skip: int
    limit: int


ACTION_REQUIRED_STATUSES = (
    CompoundStructureStatus.PENDING,
    CompoundStructureStatus.AMBIGUOUS,
    CompoundStructureStatus.NOT_FOUND,
    CompoundStructureStatus.INVALID_CAS,
    CompoundStructureStatus.ERROR,
)


def ensure_structure_feature_enabled() -> None:
    if not settings.chem_structure_feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Structure search feature is disabled",
        )


def _serialize_index_status(
    snapshot: StructureIndexSnapshot,
    job_counts: StructureResolutionJobCounts | None = None,
) -> StructureIndexStatusResponse:
    return StructureIndexStatusResponse(
        version=snapshot.version,
        dirty=snapshot.dirty,
        molecule_count=snapshot.molecule_count,
        db_revision=snapshot.db_revision,
        applied_revision=snapshot.applied_revision,
        revision_lag=snapshot.revision_lag,
        base_count=snapshot.base_count,
        delta_count=snapshot.delta_count,
        tombstone_count=snapshot.tombstone_count,
        last_compaction_duration_ms=snapshot.last_compaction_duration_ms,
        snapshot_loaded=snapshot.snapshot_loaded,
        resolution_jobs_queued=job_counts.queued if job_counts is not None else None,
        resolution_jobs_running=job_counts.running if job_counts is not None else None,
        resolution_jobs_exhausted=job_counts.exhausted if job_counts is not None else None,
    )


def _map_structure_write_error(exc: Exception) -> HTTPException:
    if isinstance(exc, StructureFeatureDisabledError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, StructureManualProtectedError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, StructureValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    logger.exception("Structure cache write failed")
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Structure cache write failed",
    )


def _ensure_structure_index_current(db: DBSession) -> StructureIndexStatusResponse:
    try:
        return _serialize_index_status(structure_index.ensure_current(db))
    except RuntimeError as exc:
        logger.warning("Structure index revision barrier failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Structure index is unavailable",
        ) from exc


def _run_structure_search(
    payload: SubstructureSearchRequest,
    limit: int,
    allowed_cas_numbers: set[str] | None,
    expected_revision: int,
):
    search_kwargs = {
        "query": payload.query,
        "query_format": payload.format,
        "limit": limit,
        "allowed_cas_numbers": allowed_cas_numbers,
        "expected_revision": expected_revision,
    }
    if payload.match_mode == StructureSearchMode.EXACT:
        return structure_index.exact_search(**search_kwargs)
    return structure_index.search(**search_kwargs)


def _parse_cache_status_filter(status_filter: str | None) -> list[CompoundStructureStatus]:
    if not status_filter or status_filter == "all":
        return []

    statuses: list[CompoundStructureStatus] = []
    for raw_value in status_filter.split(","):
        value = raw_value.strip()
        if not value:
            continue
        if value == "needs_action":
            statuses.extend(ACTION_REQUIRED_STATUSES)
            continue
        try:
            statuses.append(CompoundStructureStatus(value))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid structure cache status: {value}",
            ) from exc
    return list(dict.fromkeys(statuses))


def _apply_cache_search_filter(statement, search_text: str | None):
    if not search_text:
        return statement

    keyword = search_text.strip()
    if not keyword:
        return statement
    normalized_cas = normalize_cas(keyword)
    cas_keyword = normalized_cas or keyword
    return statement.where(
        or_(
            CompoundStructureCache.cas_number.contains(cas_keyword),
            CompoundStructureCache.english_name.contains(keyword),
            CompoundStructureCache.chinese_name.contains(keyword),
            CompoundStructureCache.source_id.contains(keyword),
            CompoundStructureCache.inchikey.contains(keyword),
        )
    )


def _serialize_candidate_preview(result: Any) -> PubChemCandidatePreviewResponse:
    return PubChemCandidatePreviewResponse(
        cas_number=result.cas_number,
        status=result.status,
        confidence=result.confidence,
        candidate_count=result.candidate_count,
        candidates=result.candidates or [],
        error_message=result.error_message,
    )


@router.get(
    "/index/status",
    response_model=StructureIndexStatusResponse,
    dependencies=[Depends(get_current_user), Depends(ensure_structure_feature_enabled)],
)
def get_structure_index_status(db: DBSession) -> StructureIndexStatusResponse:
    return _serialize_index_status(
        structure_index.status(db),
        count_structure_resolution_jobs(db),
    )


@router.get(
    "/structures/resolution-jobs",
    response_model=StructureResolutionJobListResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
def list_structure_resolution_jobs(
    db: DBSession,
    job_state: StructureResolutionJobState | None = Query(default=None, alias="state"),  # noqa: B008
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1),
) -> StructureResolutionJobListResponse:
    skip, limit = normalize_pagination(skip, limit)
    statement = select(StructureResolutionJob)
    if job_state is not None:
        statement = statement.where(StructureResolutionJob.state == job_state)
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    rows = db.exec(
        statement.order_by(
            StructureResolutionJob.updated_at.desc(),
            StructureResolutionJob.cas_number,
        )
        .offset(skip)
        .limit(limit)
    ).all()
    return StructureResolutionJobListResponse(
        data=[StructureResolutionJobResponse.model_validate(row) for row in rows],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/structures/resolution-jobs/{cas_number}/requeue",
    response_model=StructureResolutionJobResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
def requeue_structure_resolution_job(
    cas_number: str,
    db: DBSession,
) -> StructureResolutionJobResponse:
    if not enqueue_structure_resolution_job(
        db,
        cas_number,
        trigger_reason="admin_requeue",
        force=True,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Structure resolution job is not exhausted or CAS is invalid",
        )
    db.commit()
    job = db.get(StructureResolutionJob, normalize_cas(cas_number))
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Structure resolution job was not persisted",
        )
    structure_resolution_scheduler.notify()
    return StructureResolutionJobResponse.model_validate(job)


@router.post(
    "/index/rebuild",
    response_model=StructureIndexStatusResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
def rebuild_structure_index(db: DBSession) -> StructureIndexStatusResponse:
    snapshot = structure_index.rebuild(db)
    clear_structure_search_cache()
    return _serialize_index_status(snapshot)


@router.get(
    "/structures/cache",
    response_model=StructureCacheListResponse,
    dependencies=[Depends(get_current_user), Depends(ensure_structure_feature_enabled)],
)
def list_structure_cache(
    db: DBSession,
    status_filter: str | None = Query(default="needs_action", max_length=200),
    search: str | None = Query(default=None, max_length=100),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1),
) -> StructureCacheListResponse:
    skip, limit = normalize_pagination(skip, limit)
    statuses = _parse_cache_status_filter(status_filter)
    statement = select(CompoundStructureCache)
    if statuses:
        statement = statement.where(CompoundStructureCache.status.in_(statuses))
    statement = _apply_cache_search_filter(statement, search)

    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    rows = db.exec(
        statement
        .order_by(CompoundStructureCache.updated_at.desc(), CompoundStructureCache.cas_number.asc())
        .offset(skip)
        .limit(limit)
    ).all()
    return StructureCacheListResponse(
        data=[CompoundStructureCacheResponse.model_validate(row) for row in rows],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/structures/cache/{cas_number}/pubchem-candidates",
    response_model=PubChemCandidatePreviewResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
async def preview_structure_pubchem_candidates(
    cas_number: str,
) -> PubChemCandidatePreviewResponse:
    try:
        result = await preview_pubchem_candidates(cas_number)
        return _serialize_candidate_preview(result)
    except Exception as exc:
        raise _map_structure_write_error(exc) from exc


@router.get(
    "/structures/cache/{cas_number}",
    response_model=CompoundStructureCacheResponse | None,
    dependencies=[Depends(get_current_user), Depends(ensure_structure_feature_enabled)],
)
def get_structure_cache_status(
    cas_number: str,
    db: DBSession,
) -> CompoundStructureCacheResponse | None:
    return get_structure_cache(db, cas_number)


@router.post(
    "/structures/resolve-cas",
    response_model=CompoundStructureCacheResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
async def resolve_structure_cas(
    payload: ResolveCasRequest,
    db: DBSession,
) -> CompoundStructureCacheResponse:
    try:
        return await resolve_cas_to_cache(
            db,
            cas_number=payload.cas_number,
            force=payload.force,
            overwrite_manual=payload.overwrite_manual,
        )
    except Exception as exc:
        raise _map_structure_write_error(exc) from exc


@router.put(
    "/structures/cache/{cas_number}/manual",
    response_model=CompoundStructureCacheResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
def save_manual_structure(
    cas_number: str,
    payload: ManualStructureRequest,
    db: DBSession,
) -> CompoundStructureCacheResponse:
    try:
        return save_manual_molblock_to_cache(db, cas_number=cas_number, molblock=payload.molblock)
    except Exception as exc:
        raise _map_structure_write_error(exc) from exc


@router.post(
    "/structures/cache/{cas_number}/confirm-pubchem",
    response_model=CompoundStructureCacheResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
async def confirm_pubchem_candidate(
    cas_number: str,
    payload: ConfirmPubChemCidRequest,
    db: DBSession,
) -> CompoundStructureCacheResponse:
    try:
        return await confirm_pubchem_cid_to_cache(
            db,
            cas_number=cas_number,
            cid=payload.cid,
            overwrite_manual=payload.overwrite_manual,
        )
    except Exception as exc:
        raise _map_structure_write_error(exc) from exc


@router.post(
    "/search/substructure",
    response_model=SubstructureSearchResponse,
    dependencies=[Depends(ensure_structure_feature_enabled)],
)
def search_substructure(
    request: Request,
    payload: SubstructureSearchRequest,
    db: DBSession,
    current_session: CurrentSession,
) -> SubstructureSearchResponse:
    started = perf_counter()
    preview_limit = min(payload.limit, settings.chem_structure_search_max_results)
    try:
        for revision_attempt in range(2):
            index_status = _ensure_structure_index_current(db)
            allowed_cas_numbers = (
                get_visible_inventory_cas_numbers(db) if payload.only_in_stock else None
            )
            try:
                hits = (
                    []
                    if allowed_cas_numbers is not None and not allowed_cas_numbers
                    else _run_structure_search(
                        payload,
                        index_status.molecule_count,
                        allowed_cas_numbers,
                        index_status.applied_revision,
                    )
                )
            except StructureIndexRevisionChangedError:
                if revision_attempt == 0:
                    db.rollback()
                    continue
                raise
            break
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StructureIndexRevisionChangedError as exc:
        logger.warning("Structure index changed repeatedly during search: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Structure index changed during search",
        ) from exc
    except RuntimeError as exc:
        logger.warning("Structure search unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Structure index is unavailable",
        ) from exc

    cache_entry = put_structure_search_results(
        hits,
        index_version=index_status.version,
        ttl_seconds=settings.chem_structure_search_cache_ttl_seconds,
        max_entries=settings.chem_structure_search_cache_max_entries,
    )
    preview_hits = hits[:preview_limit]
    summaries = get_inventory_summaries_by_cas(
        db,
        [hit.cas_number for hit in preview_hits],
        only_in_stock=payload.only_in_stock,
    )
    results = [
        SubstructureSearchResult(
            cas_number=hit.cas_number,
            smiles_canonical=hit.smiles_canonical,
            inchikey=hit.inchikey,
            source=hit.source,
            similarity=hit.similarity,
            inventory_summary=(
                InventorySummaryResponse(**summary.as_dict())
                if (summary := summaries.get(hit.cas_number)) is not None
                else None
            ),
        )
        for hit in preview_hits
        if (not payload.only_in_stock) or hit.cas_number in summaries
    ]
    elapsed_ms = round((perf_counter() - started) * 1000, 2)

    _current_user, session = current_session
    is_cli = get_request_is_cli(request)
    buffer_search_log(
        user_id=session.user_id,
        session_id=session.id or 0,
        source="cli" if is_cli else "web",
        endpoint="/chem/search/substructure",
        client_slot="cli" if is_cli else (get_sse_client_id(request) or "web"),
        raw_query=payload.query,
        filters={
            "query_format": payload.format,
            "match_mode": payload.match_mode,
            "only_in_stock": payload.only_in_stock,
        },
        has_effective_filter=True,
        sort=None,
        result_count=cache_entry.total,
        latency_ms=max(0, int(elapsed_ms)),
    )

    return SubstructureSearchResponse(
        search_id=cache_entry.search_id,
        total=cache_entry.total,
        limit=preview_limit,
        elapsed_ms=elapsed_ms,
        index=index_status,
        results=results,
    )
