"""Procedure inventory search orchestration."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from fastapi import status
from sqlmodel import Session

from app.core.api_errors import ApiErrorCode, api_error
from app.core.config import settings
from app.services.llm_usage_logger import record_procedure_llm_usage
from app.services.procedure_inventory_analysis import (
    build_analysis_items,
    build_skipped_analysis_items,
    format_procedure_text,
    merge_common_reagent_mentions,
)
from app.services.procedure_inventory_lookup import unique_cas_order
from app.services.procedure_inventory_models import (
    ProcedureInventoryExtractionResult,
    ProcedureInventorySearchResult,
    ProcedureLLMExtraction,
    ProcedureLLMReagent,
    ProcedureResolvedReagent,
    ProcedureUnresolvedReagent,
)
from app.services.procedure_llm_extractor import (
    extract_reagents_with_llm,
    filter_extracted_reagents,
    load_common_names,
)
from app.services.procedure_pubchem_name import PubChemNameResolution, PubChemNameResolver

logger = logging.getLogger(__name__)
PUBCHEM_LOOKUP_WORKERS = 4
MAX_CAS_CANDIDATES_PER_REAGENT = 5


def search_procedure_inventory(
    db: Session,
    *,
    text: str,
    user_id: int,
) -> ProcedureInventorySearchResult:
    extraction = extract_procedure_inventory(db, text=text, user_id=user_id)
    return resolve_procedure_inventory(db, extraction=extraction, user_id=user_id)


def extract_procedure_inventory(
    db: Session,
    *,
    text: str,
    user_id: int,
) -> ProcedureInventoryExtractionResult:
    _ensure_llm_ready()
    formatted_text = format_procedure_text(text)
    common_names = load_common_names(db)
    extraction = extract_reagents_with_llm(
        formatted_text,
        common_names,
        record_usage=lambda payload, attempt: record_procedure_llm_usage(
            db,
            user_id=user_id,
            model=settings.llm_model,
            attempt=attempt,
            response_payload=payload,
        ),
    )
    if not extraction.is_experimental_procedure:
        return ProcedureInventoryExtractionResult(
            rejected=True,
            formatted_text=formatted_text,
            message=extraction.rejection_reason or "文本不像化学实验步骤，未执行试剂查询",
        )

    extraction.reagents = merge_common_reagent_mentions(
        formatted_text,
        extraction.reagents,
        common_names,
    )
    return ProcedureInventoryExtractionResult(
        formatted_text=formatted_text,
        reagents=extraction.reagents,
        analysis_items=build_skipped_analysis_items(extraction.reagents, common_names),
    )


def resolve_procedure_inventory(
    db: Session,
    *,
    extraction: ProcedureInventoryExtractionResult,
    user_id: int,
) -> ProcedureInventorySearchResult:
    _ensure_llm_ready()
    if extraction.rejected:
        return _rejected_result(extraction.message, extraction.formatted_text)

    common_names = load_common_names(db)
    llm_extraction = ProcedureLLMExtraction(
        is_experimental_procedure=True,
        reagents=extraction.reagents,
    )
    candidates = filter_extracted_reagents(extraction.reagents, common_names)
    if not candidates:
        analysis_items = build_skipped_analysis_items(extraction.reagents, common_names)
        return ProcedureInventorySearchResult(
            formatted_text=extraction.formatted_text,
            message="未识别到需要查询库存的非通用试剂",
            analysis_items=analysis_items,
        )

    resolved, unresolved = _resolve_candidates_with_pubchem(candidates)
    cas_order = unique_cas_order([
        cas_number
        for item in resolved
        for cas_number in item.cas_numbers
    ])
    analysis_items = build_analysis_items(extraction.reagents, common_names, resolved, unresolved)
    _log_search_result(user_id, llm_extraction, resolved, unresolved, cas_order)
    return ProcedureInventorySearchResult(
        formatted_text=extraction.formatted_text,
        cas_query="&&".join(cas_order),
        analysis_items=analysis_items,
        resolved=resolved,
        unresolved=unresolved,
    )


def _ensure_llm_ready() -> None:
    if not settings.llm_enabled:
        raise api_error(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM feature is disabled",
            code=ApiErrorCode.LLM_DISABLED,
        )
    if not settings.llm_api_base_url.strip() or not settings.llm_api_key.strip():
        raise api_error(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM API is not configured",
            code=ApiErrorCode.LLM_API_NOT_CONFIGURED,
        )
    if not settings.llm_model.strip():
        raise api_error(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM model is not configured",
            code=ApiErrorCode.LLM_MODEL_NOT_CONFIGURED,
        )


def _resolve_candidates_with_pubchem(
    candidates: list[ProcedureLLMReagent],
) -> tuple[list[ProcedureResolvedReagent], list[ProcedureUnresolvedReagent]]:
    headers = {"User-Agent": settings.chem_pubchem_user_agent, "Accept": "application/json"}
    with httpx.Client(timeout=settings.chem_pubchem_timeout_seconds, headers=headers) as client:
        resolver = PubChemNameResolver(client)
        worker_count = min(PUBCHEM_LOOKUP_WORKERS, len(candidates))
        results: list[tuple[ProcedureResolvedReagent | None, ProcedureUnresolvedReagent | None]]
        results = [(None, None)] * len(candidates)
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(_resolve_candidate_with_pubchem, resolver, candidate): index
                for index, candidate in enumerate(candidates)
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()
    return _split_resolution_results(results)


def _resolve_candidate_with_pubchem(
    resolver: PubChemNameResolver,
    candidate: ProcedureLLMReagent,
) -> tuple[ProcedureResolvedReagent | None, ProcedureUnresolvedReagent | None]:
    query_name = candidate.pubchem_query_name or candidate.name
    resolution = resolver.resolve(query_name)
    if resolution.cas_numbers:
        return _resolved_reagent(candidate.name, query_name, resolution), None
    return None, _unresolved_reagent(candidate.name, resolution, query_name=query_name)


def _split_resolution_results(
    results: list[tuple[ProcedureResolvedReagent | None, ProcedureUnresolvedReagent | None]],
) -> tuple[list[ProcedureResolvedReagent], list[ProcedureUnresolvedReagent]]:
    resolved = [item for item, _ in results if item is not None]
    unresolved = [item for _, item in results if item is not None]
    return resolved, unresolved


def _resolved_reagent(
    name: str,
    query_name: str,
    resolution: PubChemNameResolution,
) -> ProcedureResolvedReagent:
    cas_numbers = unique_cas_order(resolution.cas_numbers)[:MAX_CAS_CANDIDATES_PER_REAGENT]
    return ProcedureResolvedReagent(
        name=name,
        query_name=query_name,
        cas_number=cas_numbers[0],
        cas_numbers=cas_numbers,
        pubchem_cid=resolution.cid,
        pubchem_name=resolution.pubchem_name,
        reason=_resolved_reagent_reason(resolution, cas_numbers),
    )


def _resolved_reagent_reason(
    resolution: PubChemNameResolution,
    cas_numbers: list[str],
) -> str | None:
    if resolution.status != "ambiguous":
        return None
    suffix = (
        f"，已查询前 {MAX_CAS_CANDIDATES_PER_REAGENT} 个候选 CAS"
        if len(resolution.cas_numbers) > len(cas_numbers)
        else "，已查询候选 CAS"
    )
    return f"{resolution.reason or 'PubChem 返回多个 CAS'}{suffix}"


def _unresolved_reagent(
    name: str,
    resolution: PubChemNameResolution,
    *,
    query_name: str,
) -> ProcedureUnresolvedReagent:
    reason = resolution.reason or resolution.status
    if query_name != name:
        reason = f"{reason}（查询名：{query_name}）"
    return ProcedureUnresolvedReagent(name=name, query_name=query_name, reason=reason)


def _rejected_result(reason: str | None, formatted_text: str) -> ProcedureInventorySearchResult:
    return ProcedureInventorySearchResult(
        rejected=True,
        formatted_text=formatted_text,
        message=reason or "文本不像化学实验步骤，未执行试剂查询",
    )


def _log_search_result(
    user_id: int,
    extraction: ProcedureLLMExtraction,
    resolved: list[ProcedureResolvedReagent],
    unresolved: list[ProcedureUnresolvedReagent],
    cas_order: list[str],
) -> None:
    logger.info(
        "procedure_inventory_search user_id=%s extracted=%s resolved=%s unresolved=%s cas_count=%s",
        user_id,
        len(extraction.reagents),
        len(resolved),
        len(unresolved),
        len(cas_order),
    )
