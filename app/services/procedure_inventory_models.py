"""DTOs for procedure inventory search."""
from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROCEDURE_TEXT_MAX_CHARS = 5000


class ProcedureLLMReagent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=200)
    chinese_name: str | None = Field(default=None, max_length=200)
    pubchem_query_name: str | None = Field(default=None, max_length=200)
    is_specific: bool = True
    is_mixture: bool = False
    equivalent: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    equivalent_evidence: str | None = Field(default=None, max_length=300)
    equivalent_confidence: Literal["high", "medium", "low"] = "low"

    @field_validator("equivalent", mode="before")
    @classmethod
    def normalize_equivalent(cls, value: Any) -> float | None:
        if isinstance(value, bool) or not isinstance(value, int | float):
            return None
        return value if math.isfinite(value) and value > 0 else None

    @model_validator(mode="after")
    def require_confident_equivalent(self) -> ProcedureLLMReagent:
        if self.equivalent_confidence != "high" or not (self.equivalent_evidence or "").strip():
            self.equivalent = None
        if self.equivalent is None:
            self.equivalent_evidence = None
        return self

    def validate_equivalent_source(self, text: str) -> None:
        """Check the LLM's quotation without extracting or calculating an equivalent ourselves."""
        evidence = " ".join((self.equivalent_evidence or "").split())
        if not evidence or evidence not in " ".join(text.split()):
            self.equivalent = None
            self.equivalent_evidence = None
            self.equivalent_confidence = "low"


class ProcedureLLMExtraction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_experimental_procedure: bool
    rejection_reason: str | None = Field(default=None, max_length=300)
    reagents: list[ProcedureLLMReagent] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def clear_conflicting_equivalents(self) -> ProcedureLLMExtraction:
        groups: dict[tuple[bool, str], list[ProcedureLLMReagent]] = {}
        for reagent in self.reagents:
            identifier = (reagent.pubchem_query_name or reagent.name) if reagent.is_specific and not reagent.is_mixture else reagent.name
            key = identifier.strip().casefold() if reagent.is_specific else identifier.strip()
            groups.setdefault((reagent.is_mixture, key), []).append(reagent)
        for group in groups.values():
            if len({item.equivalent for item in group if item.equivalent is not None}) > 1:
                for item in group:
                    item.equivalent = None
                    item.equivalent_evidence = None
                    item.equivalent_confidence = "low"
        return self


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
    chinese_name: str | None = None
    is_mixture: bool = False
    equivalent: float | None = None
    equivalent_evidence: str | None = None
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
