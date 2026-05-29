"""Procedure text reagent extraction and inventory lookup API."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import CurrentUser
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

router = APIRouter(prefix="/procedure-inventory-search", tags=["Procedure Inventory Search"])


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
    _current_user: CurrentUser,
    db: DBSession,
) -> ProcedureInventoryExtractionResult:
    return extract_procedure_inventory(db, text=payload.text)


@router.post("/resolve", response_model=ProcedureInventorySearchResult)
def resolve_inventory_from_procedure(
    payload: ProcedureInventoryResolveRequest,
    current_user: CurrentUser,
    db: DBSession,
) -> ProcedureInventorySearchResult:
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
    current_user: CurrentUser,
    db: DBSession,
) -> ProcedureInventorySearchResult:
    return search_procedure_inventory(db, text=payload.text, user_id=current_user.id)
