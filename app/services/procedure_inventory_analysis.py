"""Procedure text analysis result helpers."""
from __future__ import annotations

import re
from typing import TypeVar

from app.services.procedure_inventory_models import (
    ProcedureAnalyzedReagent,
    ProcedureLLMReagent,
    ProcedureResolvedReagent,
    ProcedureUnresolvedReagent,
)
from app.services.procedure_llm_extractor import normalize_name_for_compare

WHITESPACE_PATTERN = re.compile(r"\s+")
AnalysisMatch = TypeVar("AnalysisMatch", ProcedureResolvedReagent, ProcedureUnresolvedReagent)


def format_procedure_text(text: str) -> str:
    return WHITESPACE_PATTERN.sub(" ", text).strip()


def build_skipped_analysis_items(
    reagents: list[ProcedureLLMReagent],
) -> list[ProcedureAnalyzedReagent]:
    return build_analysis_items(reagents, [], [])


def build_analysis_items(
    reagents: list[ProcedureLLMReagent],
    resolved: list[ProcedureResolvedReagent],
    unresolved: list[ProcedureUnresolvedReagent],
    common_cas: set[str] | frozenset[str] = frozenset(),
) -> list[ProcedureAnalyzedReagent]:
    resolved_by_key = _items_by_analysis_key(resolved)
    unresolved_by_key = _items_by_analysis_key(unresolved)
    return _ordered_analysis_items(reagents, resolved_by_key, unresolved_by_key, common_cas)


def _ordered_analysis_items(
    reagents: list[ProcedureLLMReagent],
    resolved_by_key: dict[str, ProcedureResolvedReagent],
    unresolved_by_key: dict[str, ProcedureUnresolvedReagent],
    common_cas: set[str] | frozenset[str],
) -> list[ProcedureAnalyzedReagent]:
    items: list[ProcedureAnalyzedReagent] = []
    seen: set[str] = set()
    for reagent in reagents:
        key = (reagent.name.strip() if not reagent.is_specific
               else normalize_name_for_compare(reagent.name))
        if not key or key in seen:
            continue
        seen.add(key)
        item = _analysis_item_for_reagent(reagent, resolved_by_key, unresolved_by_key, common_cas)
        if item:
            item.chinese_name = reagent.chinese_name
            item.is_mixture = reagent.is_mixture
            item.equivalent = reagent.equivalent
            item.equivalent_evidence = reagent.equivalent_evidence
            items.append(item)
    return items[:50]


def _analysis_item_for_reagent(
    reagent: ProcedureLLMReagent,
    resolved_by_key: dict[str, ProcedureResolvedReagent],
    unresolved_by_key: dict[str, ProcedureUnresolvedReagent],
    common_cas: set[str] | frozenset[str],
) -> ProcedureAnalyzedReagent | None:
    skipped = _skipped_analysis_item(reagent)
    if skipped:
        return skipped
    resolved_match = _find_analysis_match(reagent, resolved_by_key)
    if resolved_match:
        return _resolved_analysis_item(reagent, resolved_match, common_cas)
    unresolved_match = _find_analysis_match(reagent, unresolved_by_key)
    if unresolved_match:
        return _unresolved_analysis_item(reagent, unresolved_match)
    return None


def _items_by_analysis_key(items: list[AnalysisMatch]) -> dict[str, AnalysisMatch]:
    result: dict[str, AnalysisMatch] = {}
    for item in items:
        for key in _analysis_item_keys(item.name, item.query_name):
            result.setdefault(key, item)
    return result


def _find_analysis_match(
    reagent: ProcedureLLMReagent,
    items_by_key: dict[str, AnalysisMatch],
) -> AnalysisMatch | None:
    for key in _analysis_item_keys(reagent.name, reagent.pubchem_query_name):
        if key in items_by_key:
            return items_by_key[key]
    return None


def _analysis_item_keys(name: str, query_name: str | None) -> list[str]:
    normalized: list[str] = []
    for value in (name, query_name):
        key = normalize_name_for_compare(value or "")
        if key and key not in normalized:
            normalized.append(key)
    return normalized


def _skipped_analysis_item(
    reagent: ProcedureLLMReagent,
) -> ProcedureAnalyzedReagent | None:
    if reagent.is_specific:
        return None
    return ProcedureAnalyzedReagent(
        name=reagent.name,
        status='generic',
        reason='物料身份未明确（泛指、混合物或未知编号），保留投料记录，不查询库存',
    )


def _resolved_analysis_item(
    reagent: ProcedureLLMReagent,
    resolved: ProcedureResolvedReagent,
    common_cas: set[str] | frozenset[str],
) -> ProcedureAnalyzedReagent:
    candidates = resolved.cas_numbers or [resolved.cas_number]
    common_matches = [cas for cas in candidates if cas in common_cas]
    is_common = len(common_matches) == len(candidates)
    reason = resolved.reason
    if is_common:
        reason = 'CAS 已录入公用常用列表，未查询普通库存'
    elif common_matches:
        reason = f"公用常用候选 {' / '.join(common_matches)} 未查询普通库存，其余候选继续查询"
    if reagent.is_mixture:
        reason = '按明确成分检索，CAS 属于成分，不代表整份混合物' + (f'；{reason}' if reason else '')
    return ProcedureAnalyzedReagent(
        name=reagent.name,
        pubchem_query_name=reagent.pubchem_query_name,
        status="common" if is_common else "resolved",
        cas_number=resolved.cas_number,
        cas_numbers=resolved.cas_numbers,
        reason=reason,
        pubchem_cid=resolved.pubchem_cid,
        inventory_count=resolved.inventory_count,
    )


def _unresolved_analysis_item(
    reagent: ProcedureLLMReagent,
    unresolved: ProcedureUnresolvedReagent,
) -> ProcedureAnalyzedReagent:
    return ProcedureAnalyzedReagent(
        name=reagent.name,
        pubchem_query_name=reagent.pubchem_query_name,
        status="unresolved",
        reason=unresolved.reason,
    )
