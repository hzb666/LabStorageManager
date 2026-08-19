"""搜索补全排序器 — 打分并返回内联补全结果。"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime

from app.search_completion_db import (
    CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
    INVENTORY_COMPLETION_ENDPOINT,
    REAGENT_ORDER_COMPLETION_ENDPOINT,
    QueryMemoryRow,
    get_user_preferences,
    query_entity_by_prefix,
    query_memory_by_prefix,
)
from app.services.sql_utils import normalize_search_term

logger = logging.getLogger(__name__)

RECENCY_DECAY_LAMBDA = 0.05
CONFIDENCE_THRESHOLD = 0.15

_INVENTORY_ENTITY_FIELDS = ("name", "cas_number", "storage_location", "brand", "category")
_REAGENT_ENTITY_FIELDS = ("name", "cas_number", "brand", "category", "applicant")
_CONSUMABLE_ENTITY_FIELDS = ("name", "specification", "communication", "applicant")

_ENDPOINT_FIELDS: dict[str, tuple[str, ...]] = {
    INVENTORY_COMPLETION_ENDPOINT: _INVENTORY_ENTITY_FIELDS,
    REAGENT_ORDER_COMPLETION_ENDPOINT: _REAGENT_ENTITY_FIELDS,
    CONSUMABLE_ORDER_COMPLETION_ENDPOINT: _CONSUMABLE_ENTITY_FIELDS,
}


@dataclass(frozen=True)
class InlineCompletionRequest:
    user_id: int
    endpoint: str
    field: str
    prefix: str


@dataclass(frozen=True)
class InlineCompletionResult:
    completion: str | None = None
    suffix: str | None = None
    confidence: float = 0.0
    source: str | None = None
    personalized: bool = False


def _normalize_prefix(raw: str) -> str:
    return normalize_search_term(raw.strip()).casefold()


def _candidate_key(completion: str) -> str:
    return normalize_search_term(completion).casefold()


def _completion_suffix(completion: str, raw_prefix: str, normalized_prefix: str) -> str:
    stripped_prefix = raw_prefix.strip()
    if completion.casefold().startswith(stripped_prefix.casefold()):
        return completion[len(stripped_prefix):]

    consumed = ""
    for index, char in enumerate(completion):
        consumed += _candidate_key(char)
        if len(consumed) >= len(normalized_prefix):
            return completion[index + 1:]
    return ""


def _recency_score(last_used_at: str) -> float:
    try:
        ts = last_used_at.replace("Z", "+00:00") if "Z" in last_used_at else last_used_at
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        delta = datetime.now(UTC) - dt
        days = max(delta.total_seconds() / 86400.0, 0.0)
        return math.exp(-RECENCY_DECAY_LAMBDA * days)
    except (ValueError, TypeError):
        return 0.5


def _memory_score(row: QueryMemoryRow) -> float:
    frequency_component = math.log1p(row.frequency)
    recency_component = _recency_score(row.last_used_at)
    total_feedback = row.accept_count + row.reject_count
    accept_weight = (row.accept_count + 1) / (total_feedback + 2)
    return frequency_component * recency_component * accept_weight


def _normalize_score(value: float, max_value: float) -> float:
    if max_value <= 0:
        return 0.0
    return min(value / max_value, 1.0)


def _collect_memory_candidates(
    *,
    user_id: int | None,
    endpoint: str,
    search_field: str | None,
    normalized_prefix: str,
) -> list[tuple[str, float, str]]:
    rows = query_memory_by_prefix(
        user_id=user_id,
        endpoint=endpoint,
        search_field=search_field,
        prefix=normalized_prefix,
        limit=30,
    )
    scored: list[tuple[str, float, str]] = []
    max_score = max((_memory_score(r) for r in rows), default=0.0)
    for row in rows:
        raw_score = _memory_score(row)
        normalized = _normalize_score(raw_score, max_score)
        scored.append((row.query, normalized, "personal_memory" if user_id else "global_memory"))
    return scored


def _entity_fields_for_endpoint(endpoint: str, field: str) -> tuple[str, ...]:
    if field != "all":
        return (field,)
    return _ENDPOINT_FIELDS.get(endpoint, ())


def _collect_entity_candidates(
    *,
    endpoint: str,
    field: str,
    normalized_prefix: str,
) -> list[tuple[str, float, str]]:
    fields = _entity_fields_for_endpoint(endpoint, field)
    scored: list[tuple[str, float, str]] = []
    for entity_field in fields:
        rows = query_entity_by_prefix(
            endpoint=endpoint,
            field=entity_field,
            prefix=normalized_prefix,
            limit=20,
        )
        for row in rows:
            scored.append((row.value, row.operational_score, "entity_index"))
    return scored


def _select_best(
    candidates: list[tuple[str, float, str]],
    normalized_prefix: str,
) -> tuple[str | None, float, str | None]:
    best_completion: str | None = None
    best_score = -1.0
    best_source: str | None = None

    seen: set[str] = set()
    for completion, score, source in candidates:
        key = _candidate_key(completion)
        if key in seen:
            continue
        seen.add(key)

        if not key.startswith(normalized_prefix):
            continue
        if score > best_score:
            best_score = score
            best_completion = completion
            best_source = source

    return best_completion, best_score, best_source


def get_inline_completion(req: InlineCompletionRequest) -> InlineCompletionResult:
    normalized_prefix = _normalize_prefix(req.prefix)
    if not normalized_prefix:
        return InlineCompletionResult()

    prefs = get_user_preferences(req.user_id)
    personalized = prefs.personalization_enabled
    search_field = req.field if req.field != "all" else None

    all_candidates: list[tuple[str, float, str]] = []

    if personalized:
        for c, s, src in _collect_memory_candidates(
            user_id=req.user_id, endpoint=req.endpoint,
            search_field=search_field, normalized_prefix=normalized_prefix,
        ):
            all_candidates.append((c, 0.45 * s, src))

    for c, s, src in _collect_memory_candidates(
        user_id=None, endpoint=req.endpoint,
        search_field=search_field, normalized_prefix=normalized_prefix,
    ):
        all_candidates.append((c, 0.45 * s if not personalized else 0.20 * s, src))

    for c, s, src in _collect_entity_candidates(
        endpoint=req.endpoint, field=req.field, normalized_prefix=normalized_prefix,
    ):
        all_candidates.append((c, 0.40 * s if not personalized else 0.25 * s, src))

    best_completion, best_score, best_source = _select_best(all_candidates, normalized_prefix)

    if not best_completion or best_score < CONFIDENCE_THRESHOLD:
        return InlineCompletionResult()

    suffix = _completion_suffix(best_completion, req.prefix, normalized_prefix)
    if not suffix:
        return InlineCompletionResult()

    return InlineCompletionResult(
        completion=best_completion,
        suffix=suffix,
        confidence=round(min(best_score, 1.0), 4),
        source=best_source,
        personalized=personalized,
    )
