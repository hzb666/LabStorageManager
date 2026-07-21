"""Procedure text reagent extraction and inventory lookup API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.api_errors import ApiErrorCode, api_error
from app.core.auth import NonPublicUser
from app.core.config import settings
from app.database import DBSession
from app.services.procedure_inventory_models import (
    PROCEDURE_TEXT_MAX_CHARS,
    ProcedureInventoryExtractionResult,
    ProcedureInventorySearchResult,
    ProcedureLLMReagent,
)
from app.services.procedure_inventory_search import (
    extract_procedure_inventory,
    resolve_procedure_inventory,
    search_procedure_inventory,
)
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/procedure-inventory-search", tags=["Procedure Inventory Search"])
PROCEDURE_EXTRACTION_RATE_LIMIT_SCOPE = "procedure_inventory_extract"
PROCEDURE_RESOLUTION_RATE_LIMIT_SCOPE = "procedure_inventory_resolve"


def _enforce_procedure_rate_limit(*, scope: str, user_id: int) -> None:
    try:
        enforce_rate_limit(
            scope=scope,
            identifier=str(user_id),
            limit=settings.procedure_search_rate_limit_count,
            window_seconds=settings.procedure_search_rate_limit_window_seconds,
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
            raise
        raise api_error(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Procedure search rate limit exceeded",
            code=ApiErrorCode.PROCEDURE_SEARCH_RATE_LIMITED,
            headers={"Retry-After": str(settings.procedure_search_rate_limit_window_seconds)},
        ) from exc


class ProcedureInventorySearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=PROCEDURE_TEXT_MAX_CHARS)


class ProcedureInventoryResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rejected: bool = False
    message: str | None = Field(default=None, max_length=300)
    formatted_text: str = Field(min_length=0, max_length=PROCEDURE_TEXT_MAX_CHARS)
    reagents: list[ProcedureLLMReagent] = Field(default_factory=list, max_length=50)


@router.post("/extract", response_model=ProcedureInventoryExtractionResult)
def extract_inventory_from_procedure(
    payload: ProcedureInventorySearchRequest,
    current_user: NonPublicUser,
    db: DBSession,
) -> ProcedureInventoryExtractionResult:
    _enforce_procedure_rate_limit(
        scope=PROCEDURE_EXTRACTION_RATE_LIMIT_SCOPE,
        user_id=current_user.id,
    )
    return extract_procedure_inventory(db, text=payload.text, user_id=current_user.id)


@router.post("/resolve", response_model=ProcedureInventorySearchResult)
def resolve_inventory_from_procedure(
    payload: ProcedureInventoryResolveRequest,
    current_user: NonPublicUser,
    db: DBSession,
) -> ProcedureInventorySearchResult:
    _enforce_procedure_rate_limit(
        scope=PROCEDURE_RESOLUTION_RATE_LIMIT_SCOPE,
        user_id=current_user.id,
    )
    extraction = ProcedureInventoryExtractionResult(
        rejected=payload.rejected,
        message=payload.message,
        formatted_text=payload.formatted_text,
        reagents=payload.reagents,
    )
    return resolve_procedure_inventory(db, extraction=extraction, user_id=current_user.id)


@router.post("", response_model=ProcedureInventorySearchResult)
def search_inventory_from_procedure(
    payload: ProcedureInventorySearchRequest,
    current_user: NonPublicUser,
    db: DBSession,
) -> ProcedureInventorySearchResult:
    _enforce_procedure_rate_limit(
        scope=PROCEDURE_EXTRACTION_RATE_LIMIT_SCOPE,
        user_id=current_user.id,
    )
    _enforce_procedure_rate_limit(
        scope=PROCEDURE_RESOLUTION_RATE_LIMIT_SCOPE,
        user_id=current_user.id,
    )
    return search_procedure_inventory(db, text=payload.text, user_id=current_user.id)
