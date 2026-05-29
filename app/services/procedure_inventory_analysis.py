"""Procedure text analysis result helpers."""
from __future__ import annotations

import re
from re import Match
from typing import TypeVar

from app.services.procedure_inventory_models import (
    ProcedureAnalyzedReagent,
    ProcedureLLMReagent,
    ProcedureResolvedReagent,
    ProcedureUnresolvedReagent,
)
from app.services.procedure_llm_extractor import (
    is_common_reagent_name,
    is_generic_reagent_name,
    is_llm_marked_generic,
    normalize_name_for_compare,
)

WHITESPACE_PATTERN = re.compile(r"\s+")
AnalysisMatch = TypeVar("AnalysisMatch", ProcedureResolvedReagent, ProcedureUnresolvedReagent)


def format_procedure_text(text: str) -> str:
    return WHITESPACE_PATTERN.sub(" ", text).strip()


def merge_common_reagent_mentions(
    formatted_text: str,
    reagents: list[ProcedureLLMReagent],
    common_names: list[str],
) -> list[ProcedureLLMReagent]:
    ordered: list[tuple[int, int, ProcedureLLMReagent]] = []
    seen = {normalize_name_for_compare(reagent.name) for reagent in reagents}
    for index, reagent in enumerate(reagents):
        ordered.append((_find_mention_index(formatted_text, reagent.name), index, reagent))
    for match, common_name in _find_common_name_matches(formatted_text, common_names):
        item = _common_mention_to_reagent(match, common_name)
        key = normalize_name_for_compare(item.name)
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append((match.start(), len(ordered), item))
    ordered.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in ordered[:50]]


def build_skipped_analysis_items(
    reagents: list[ProcedureLLMReagent],
    common_names: list[str],
) -> list[ProcedureAnalyzedReagent]:
    items: list[ProcedureAnalyzedReagent] = []
    for reagent in reagents:
        item = _skipped_analysis_item(reagent, common_names)
        if item:
            items.append(item)
    return items[:50]


def build_analysis_items(
    reagents: list[ProcedureLLMReagent],
    common_names: list[str],
    resolved: list[ProcedureResolvedReagent],
    unresolved: list[ProcedureUnresolvedReagent],
) -> list[ProcedureAnalyzedReagent]:
    resolved_by_key = _items_by_analysis_key(resolved)
    unresolved_by_key = _items_by_analysis_key(unresolved)
    return _ordered_analysis_items(reagents, common_names, resolved_by_key, unresolved_by_key)


def _ordered_analysis_items(
    reagents: list[ProcedureLLMReagent],
    common_names: list[str],
    resolved_by_key: dict[str, ProcedureResolvedReagent],
    unresolved_by_key: dict[str, ProcedureUnresolvedReagent],
) -> list[ProcedureAnalyzedReagent]:
    items: list[ProcedureAnalyzedReagent] = []
    seen: set[str] = set()
    for reagent in reagents:
        key = normalize_name_for_compare(reagent.name)
        if not key or key in seen:
            continue
        seen.add(key)
        item = _analysis_item_for_reagent(reagent, common_names, resolved_by_key, unresolved_by_key)
        if item:
            items.append(item)
    return items[:50]


def _analysis_item_for_reagent(
    reagent: ProcedureLLMReagent,
    common_names: list[str],
    resolved_by_key: dict[str, ProcedureResolvedReagent],
    unresolved_by_key: dict[str, ProcedureUnresolvedReagent],
) -> ProcedureAnalyzedReagent | None:
    skipped = _skipped_analysis_item(reagent, common_names)
    if skipped:
        return skipped
    resolved_match = _find_analysis_match(reagent, resolved_by_key)
    if resolved_match:
        return _resolved_analysis_item(reagent, resolved_match)
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
    common_names: list[str],
) -> ProcedureAnalyzedReagent | None:
    normalized_name = normalize_name_for_compare(reagent.name)
    normalized_query = normalize_name_for_compare(reagent.pubchem_query_name or reagent.name)
    if is_common_reagent_name(reagent.name, common_names) or is_common_reagent_name(
        reagent.pubchem_query_name or reagent.name,
        common_names,
    ):
        return ProcedureAnalyzedReagent(
            name=reagent.name,
            pubchem_query_name=reagent.pubchem_query_name,
            status="common",
            reason="常用试剂/溶剂，未查询库存",
        )
    if is_generic_reagent_name(normalized_name) or is_generic_reagent_name(normalized_query):
        return ProcedureAnalyzedReagent(
            name=reagent.name,
            pubchem_query_name=reagent.pubchem_query_name,
            status="generic",
            reason="通用占位名称，未查询 PubChem",
        )
    if is_llm_marked_generic(reagent):
        return ProcedureAnalyzedReagent(
            name=reagent.name,
            pubchem_query_name=reagent.pubchem_query_name,
            status="generic",
            reason="LLM 标记为无需查询 PubChem",
        )
    return None


def _resolved_analysis_item(
    reagent: ProcedureLLMReagent,
    resolved: ProcedureResolvedReagent,
) -> ProcedureAnalyzedReagent:
    return ProcedureAnalyzedReagent(
        name=reagent.name,
        pubchem_query_name=reagent.pubchem_query_name,
        status="resolved",
        cas_number=resolved.cas_number,
        cas_numbers=resolved.cas_numbers,
        reason=resolved.reason,
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


def _common_mention_to_reagent(match: Match[str], common_name: str) -> ProcedureLLMReagent:
    matched_text = match.group(0).strip()
    return ProcedureLLMReagent(
        name=matched_text,
        pubchem_query_name=common_name,
        should_query_pubchem=False,
        evidence=matched_text,
        confidence="high",
    )


def _find_mention_index(text: str, mention: str) -> int:
    if not mention:
        return len(text)
    index = text.lower().find(mention.lower())
    return index if index >= 0 else len(text)


def _find_common_name_matches(
    text: str,
    common_names: list[str],
) -> list[tuple[Match[str], str]]:
    matches = [
        (match, common_name)
        for common_name in common_names
        if (match := _find_common_name_match(text, common_name))
    ]
    matches.sort(key=lambda item: (item[0].start(), -(item[0].end() - item[0].start())))
    return _remove_overlapping_common_matches(matches)


def _remove_overlapping_common_matches(
    matches: list[tuple[Match[str], str]],
) -> list[tuple[Match[str], str]]:
    result: list[tuple[Match[str], str]] = []
    occupied_spans: list[tuple[int, int]] = []
    for match, common_name in matches:
        span = (match.start(), match.end())
        if any(_spans_overlap(span, occupied) for occupied in occupied_spans):
            continue
        occupied_spans.append(span)
        result.append((match, common_name))
    return result


def _find_common_name_match(text: str, common_name: str) -> Match[str] | None:
    stripped = common_name.strip()
    if not stripped:
        return None
    pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(stripped)}(?![A-Za-z0-9])", re.IGNORECASE)
    return pattern.search(text)


def _spans_overlap(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]
