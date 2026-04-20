"""Chemical structure cache and search APIs."""
from __future__ import annotations

from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.database import DBSession
from app.models.compound_structure import CompoundStructureSource
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
