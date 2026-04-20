"""Chemical structure cache and search APIs."""
from __future__ import annotations

from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.database import DBSession
from app.models.compound_structure import (
    CompoundStructureCacheResponse,
    CompoundStructureSource,
)
from app.services.structure_cache_repo import get_structure_cache
from app.services.structure_cache_workflow import (
    StructureFeatureDisabledError,
    StructureManualProtectedError,
    StructureValidationError,
    confirm_pubchem_cid_to_cache,
    resolve_cas_to_cache,
    save_manual_molblock_to_cache,
)
from app.services.structure_index import (
    StructureIndexSnapshot,
    StructureQueryFormat,
    structure_index,
)
from app.services.structure_inventory_summary import get_inventory_summaries_by_cas

router = APIRouter(prefix="/chem", tags=["Chem"])


class StructureIndexStatusResponse(BaseModel):
    version: int
    dirty: bool
    molecule_count: int


class SubstructureSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1)
    format: StructureQueryFormat
    limit: int = Field(default=100, ge=1, le=1000)
    use_chirality: bool = False
    only_in_stock: bool = True


class ResolveCasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cas_number: str = Field(min_length=1, max_length=50)
    force: bool = False
    overwrite_manual: bool = False


class ManualStructureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    molblock: str = Field(min_length=1)


class ConfirmPubChemCidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cid: int = Field(ge=1)
    overwrite_manual: bool = False


class InventorySummaryResponse(BaseModel):
    cas_number: str
    item_count: int
    display_name: str | None
    english_name: str | None
    locations: list[str]
    total_by_unit: dict[str, float]


class SubstructureSearchResult(BaseModel):
    cas_number: str
    smiles_canonical: str
    inchikey: str | None
    source: CompoundStructureSource | None
    inventory_summary: InventorySummaryResponse | None


class SubstructureSearchResponse(BaseModel):
    total: int
    limit: int
    elapsed_ms: float
    index: StructureIndexStatusResponse
    results: list[SubstructureSearchResult]


def ensure_structure_feature_enabled() -> None:
    if not settings.chem_structure_feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Structure search feature is disabled",
        )


def _serialize_index_status(snapshot: StructureIndexSnapshot) -> StructureIndexStatusResponse:
    return StructureIndexStatusResponse(
        version=snapshot.version,
        dirty=snapshot.dirty,
        molecule_count=snapshot.molecule_count,
    )


def _map_structure_write_error(exc: Exception) -> HTTPException:
    if isinstance(exc, StructureFeatureDisabledError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, StructureManualProtectedError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, StructureValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.get(
    "/index/status",
    response_model=StructureIndexStatusResponse,
    dependencies=[Depends(get_current_user), Depends(ensure_structure_feature_enabled)],
)
def get_structure_index_status() -> StructureIndexStatusResponse:
    return _serialize_index_status(structure_index.status())


@router.post(
    "/index/rebuild",
    response_model=StructureIndexStatusResponse,
    dependencies=[Depends(require_admin), Depends(ensure_structure_feature_enabled)],
)
def rebuild_structure_index(db: DBSession) -> StructureIndexStatusResponse:
    return _serialize_index_status(structure_index.rebuild(db))


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
    dependencies=[Depends(get_current_user), Depends(ensure_structure_feature_enabled)],
)
def search_substructure(
    payload: SubstructureSearchRequest,
    db: DBSession,
) -> SubstructureSearchResponse:
    started = perf_counter()
    limit = min(payload.limit, settings.chem_structure_search_max_results)
    try:
        hits = structure_index.search(
            query=payload.query,
            query_format=payload.format,
            limit=limit,
            use_chirality=payload.use_chirality,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    summaries = get_inventory_summaries_by_cas(
        db,
        [hit.cas_number for hit in hits],
        only_in_stock=payload.only_in_stock,
    )
    results = [
        SubstructureSearchResult(
            cas_number=hit.cas_number,
            smiles_canonical=hit.smiles_canonical,
            inchikey=hit.inchikey,
            source=hit.source,
            inventory_summary=(
                InventorySummaryResponse(**summary.as_dict())
                if (summary := summaries.get(hit.cas_number)) is not None
                else None
            ),
        )
        for hit in hits
        if (not payload.only_in_stock) or hit.cas_number in summaries
    ]
    return SubstructureSearchResponse(
        total=len(results),
        limit=limit,
        elapsed_ms=round((perf_counter() - started) * 1000, 2),
        index=_serialize_index_status(structure_index.status()),
        results=results,
    )
