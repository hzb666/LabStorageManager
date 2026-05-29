"""DTOs for procedure inventory search."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PROCEDURE_TEXT_MAX_CHARS = 5000


class ProcedureLLMReagent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=200)
    pubchem_query_name: str | None = Field(default=None, max_length=200)
    should_query_pubchem: bool = True
    evidence: str | None = Field(default=None, max_length=300)
    confidence: Literal["high", "medium", "low"] = "medium"


class ProcedureLLMExtraction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_experimental_procedure: bool
    rejection_reason: str | None = Field(default=None, max_length=300)
    reagents: list[ProcedureLLMReagent] = Field(default_factory=list)


class ProcedureResolvedReagent(BaseModel):
    name: str
    query_name: str | None = None
    cas_number: str
    cas_numbers: list[str] = Field(default_factory=list)
    pubchem_cid: int | None = None
    pubchem_name: str | None = None
    reason: str | None = None
    inventory_count: int = 0


class ProcedureUnresolvedReagent(BaseModel):
    name: str
    query_name: str | None = None
    reason: str


class ProcedureAnalyzedReagent(BaseModel):
    name: str
    pubchem_query_name: str | None = None
    status: Literal["resolved", "unresolved", "common", "generic"]
    cas_number: str | None = None
    cas_numbers: list[str] = Field(default_factory=list)
    reason: str | None = None
    pubchem_cid: int | None = None
    inventory_count: int = 0


class ProcedureInventoryGroup(BaseModel):
    cas_number: str
    reagent_names: list[str]
    items: list[dict[str, Any]]


class ProcedureInventoryExtractionResult(BaseModel):
    rejected: bool = False
    message: str | None = None
    formatted_text: str = ""
    reagents: list[ProcedureLLMReagent] = Field(default_factory=list)
    analysis_items: list[ProcedureAnalyzedReagent] = Field(default_factory=list)


class ProcedureInventorySearchResult(BaseModel):
    rejected: bool = False
    message: str | None = None
    formatted_text: str = ""
    cas_query: str = ""
    analysis_items: list[ProcedureAnalyzedReagent] = Field(default_factory=list)
    resolved: list[ProcedureResolvedReagent] = Field(default_factory=list)
    unresolved: list[ProcedureUnresolvedReagent] = Field(default_factory=list)
    inventory_groups: list[ProcedureInventoryGroup] = Field(default_factory=list)
