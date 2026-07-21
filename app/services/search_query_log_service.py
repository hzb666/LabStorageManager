"""Buffered search log writer for low-priority query analytics."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping

from app.search_query_log_db import insert_search_log_rows
from app.search_completion_db import (
    TARGET_ENDPOINTS,
    get_user_preferences,
    prune_query_memory_if_due,
    upsert_query_memory,
)
from app.services.search_matchers import split_exact_cas_search_terms

logger = logging.getLogger(__name__)

QUIET_WINDOW_SECONDS = 1.2
RECENT_COMMIT_SUPPRESSION_SECONDS = 3.0
WORKER_POLL_INTERVAL_SECONDS = 0.2
READY_BATCH_SIZE_THRESHOLD = 10
READY_BATCH_MAX_WAIT_SECONDS = 5.0

_NORMALIZED_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class SearchLogPayload:
    user_id: int
    session_id: int
    source: str
    endpoint: str
    query: str | None
    normalized_query: str | None
    filters_json: str
    sort_json: str | None
    result_count: int
    latency_ms: int | None


@dataclass(slots=True)
class PendingSearchLog:
    semantic_fingerprint: str
    payload: SearchLogPayload
    ready_at_monotonic: float


@dataclass(slots=True)
class RecentCommittedSearchLog:
    semantic_fingerprint: str
    committed_at_monotonic: float


@dataclass(slots=True)
class ReadySearchLog:
    slot_key: str
    semantic_fingerprint: str
    payload: SearchLogPayload
    enqueued_at_monotonic: float


_pending_by_slot: dict[str, PendingSearchLog] = {}
_recent_committed_by_slot: dict[str, RecentCommittedSearchLog] = {}
_ready_queue: list[ReadySearchLog] = []
_state_lock = threading.Lock()
_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None


def _normalize_query(raw_query: str | None) -> tuple[str | None, str | None]:
    query = (raw_query or "").strip()
    if not query:
        return None, None
    normalized_query = _NORMALIZED_SPACE_RE.sub(" ", query.lower())
    return query, normalized_query


def _normalize_metadata_value(value: Any) -> Any | None:
    if value is None:
        return None
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, bool):
        return value or None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, Mapping):
        normalized_mapping = _normalize_metadata_mapping(value)
        return normalized_mapping or None
    if isinstance(value, (list, tuple)):
        normalized_items = [
            normalized_item
            for item in value
            if (normalized_item := _normalize_metadata_value(item)) is not None
        ]
        return normalized_items or None
    return str(value)


def _normalize_metadata_mapping(values: Mapping[str, Any] | None) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    if not values:
        return normalized
    for key, value in values.items():
        normalized_value = _normalize_metadata_value(value)
        if normalized_value is None:
            continue
        normalized[key] = normalized_value
    return normalized


def build_search_log_filters(
    *,
    search_field: str | None = None,
    fuzzy: bool = False,
    match_mode: str | Enum | None = None,
    extra_filters: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    filters = dict(_normalize_metadata_mapping(extra_filters))
    if search_field and search_field != "all":
        filters["search_field"] = search_field
    if fuzzy:
        filters["fuzzy"] = True
    normalized_match_mode = _normalize_metadata_value(match_mode)
    if normalized_match_mode and normalized_match_mode != "contains":
        filters["match_mode"] = normalized_match_mode
    return filters


def build_search_log_sort(
    *,
    sort_by: str | None,
    sort_order: str | None,
) -> dict[str, Any] | None:
    sort_payload = _normalize_metadata_mapping(
        {
            "sort_by": sort_by,
            "sort_order": sort_order.lower() if isinstance(sort_order, str) else sort_order,
        }
    )
    return sort_payload or None


def _serialize_mapping(values: Mapping[str, Any] | None) -> str | None:
    normalized_values = _normalize_metadata_mapping(values)
    if not normalized_values:
        return None
    return json.dumps(normalized_values, ensure_ascii=False, sort_keys=True)


def _build_semantic_fingerprint(
    *,
    endpoint: str,
    normalized_query: str | None,
    filters_json: str,
) -> str:
    fingerprint_payload = json.dumps(
        {
            "endpoint": endpoint,
            "normalized_query": normalized_query or "",
            "filters_json": filters_json,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(fingerprint_payload.encode("utf-8")).hexdigest()


def _build_slot_key(
    *,
    user_id: int,
    session_id: int,
    source: str,
    endpoint: str,
    client_slot: str,
) -> str:
    return f"{user_id}:{session_id}:{source}:{endpoint}:{client_slot}"


def _clear_slot_state(slot_key: str) -> None:
    with _state_lock:
        _pending_by_slot.pop(slot_key, None)
        _recent_committed_by_slot.pop(slot_key, None)


def buffer_search_log(
    *,
    user_id: int,
    session_id: int,
    source: str,
    endpoint: str,
    client_slot: str,
    raw_query: str | None,
    filters: Mapping[str, Any] | None,
    has_effective_filter: bool,
    sort: Mapping[str, Any] | None,
    result_count: int,
    latency_ms: int | None,
) -> None:
    if user_id <= 0 or session_id <= 0:
        return

    query, normalized_query = _normalize_query(raw_query)
    filters_json = _serialize_mapping(filters) or "{}"
    sort_json = _serialize_mapping(sort)
    has_loggable_query = normalized_query is not None and len(normalized_query) >= 2
    slot_key = _build_slot_key(
        user_id=user_id,
        session_id=session_id,
        source=source,
        endpoint=endpoint,
        client_slot=client_slot,
    )
    if not has_loggable_query and not has_effective_filter:
        _clear_slot_state(slot_key)
        return

    semantic_fingerprint = _build_semantic_fingerprint(
        endpoint=endpoint,
        normalized_query=normalized_query,
        filters_json=filters_json,
    )
    payload = SearchLogPayload(
        user_id=user_id,
        session_id=session_id,
        source=source,
        endpoint=endpoint,
        query=query,
        normalized_query=normalized_query,
        filters_json=filters_json,
        sort_json=sort_json,
        result_count=result_count,
        latency_ms=latency_ms,
    )
    now_monotonic = time.monotonic()
    with _state_lock:
        recent_committed = _recent_committed_by_slot.get(slot_key)
        if recent_committed and recent_committed.semantic_fingerprint == semantic_fingerprint:
            if now_monotonic - recent_committed.committed_at_monotonic < RECENT_COMMIT_SUPPRESSION_SECONDS:
                return

        _pending_by_slot[slot_key] = PendingSearchLog(
            semantic_fingerprint=semantic_fingerprint,
            payload=payload,
            ready_at_monotonic=now_monotonic + QUIET_WINDOW_SECONDS,
        )


def _latest_ready_fingerprint_for_slot(slot_key: str) -> str | None:
    for ready in reversed(_ready_queue):
        if ready.slot_key == slot_key:
            return ready.semantic_fingerprint
    return None


def _promote_ready_candidates(*, flush_all: bool) -> None:
    now_monotonic = time.monotonic()
    with _state_lock:
        expired_slots = [
            slot_key
            for slot_key, recent in _recent_committed_by_slot.items()
            if now_monotonic - recent.committed_at_monotonic >= RECENT_COMMIT_SUPPRESSION_SECONDS
        ]
        for slot_key in expired_slots:
            _recent_committed_by_slot.pop(slot_key, None)

        for slot_key, pending in list(_pending_by_slot.items()):
            if not flush_all and pending.ready_at_monotonic > now_monotonic:
                continue
            _pending_by_slot.pop(slot_key, None)
            latest_ready_fingerprint = _latest_ready_fingerprint_for_slot(slot_key)
            if latest_ready_fingerprint == pending.semantic_fingerprint:
                continue
            _ready_queue.append(
                ReadySearchLog(
                    slot_key=slot_key,
                    semantic_fingerprint=pending.semantic_fingerprint,
                    payload=pending.payload,
                    enqueued_at_monotonic=now_monotonic,
                )
            )


def _collect_batch(*, flush_all: bool) -> list[ReadySearchLog]:
    now_monotonic = time.monotonic()
    with _state_lock:
        if not _ready_queue:
            return []
        if not flush_all:
            oldest_wait_seconds = now_monotonic - _ready_queue[0].enqueued_at_monotonic
            should_flush = (
                len(_ready_queue) >= READY_BATCH_SIZE_THRESHOLD
                or oldest_wait_seconds >= READY_BATCH_MAX_WAIT_SECONDS
            )
            if not should_flush:
                return []
        batch = list(_ready_queue)
        _ready_queue.clear()
        return batch


def _batch_rows(
    batch: list[ReadySearchLog],
) -> list[tuple[int, int, str, str, str | None, str | None, str, str | None, int, int | None]]:
    return [
        (
            ready.payload.user_id,
            ready.payload.session_id,
            ready.payload.source,
            ready.payload.endpoint,
            ready.payload.query,
            ready.payload.normalized_query,
            ready.payload.filters_json,
            ready.payload.sort_json,
            ready.payload.result_count,
            ready.payload.latency_ms,
        )
        for ready in batch
    ]


def _parse_filters_json(filters_json: str) -> dict[str, Any]:
    try:
        parsed = json.loads(filters_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_search_field(filters_json: str) -> str | None:
    filters = _parse_filters_json(filters_json)
    field = filters.get("search_field")
    if field and isinstance(field, str) and field != "all":
        return field
    return None




def _upsert_query_memory_for_scope(
    *,
    user_id: int | None,
    payload: SearchLogPayload,
    search_field: str | None,
    query: str,
) -> None:
    upsert_query_memory(
        user_id=user_id,
        endpoint=payload.endpoint,
        search_field=search_field,
        query=query,
        normalized_query=query,
    )


def _record_split_and_query_memory(payload: SearchLogPayload) -> bool:
    if not payload.query or "&&" not in payload.query:
        return False

    search_field = _parse_search_field(payload.filters_json)
    if payload.endpoint not in {"/inventory/", "/reagent-orders/"}:
        return False
    if search_field not in {None, "cas_number"}:
        return False

    terms = split_exact_cas_search_terms(payload.query)
    terms = [term for term in terms if len(term) >= 2]

    if not terms:
        return True

    prefs = get_user_preferences(payload.user_id)

    for term in terms:
        if prefs.personalization_enabled:
            _upsert_query_memory_for_scope(
                user_id=payload.user_id,
                payload=payload,
                search_field=search_field,
                query=term,
            )
        _upsert_query_memory_for_scope(
            user_id=None,
            payload=payload,
            search_field=search_field,
            query=term,
        )

    return True


def _record_search_memory_from_batch(batch: list[ReadySearchLog]) -> None:
    seen: set[str] = set()
    for ready in batch:
        payload = ready.payload
        if payload.endpoint not in TARGET_ENDPOINTS:
            continue
        if not payload.normalized_query or len(payload.normalized_query) < 2:
            continue

        dedupe_key = f"{payload.user_id}:{payload.endpoint}:{payload.normalized_query}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        try:
            if _record_split_and_query_memory(payload):
                continue

            query = payload.query.strip() if payload.query else ""
            if len(query) < 2:
                continue
            if " " in query:
                continue

            search_field = _parse_search_field(payload.filters_json)
            prefs = get_user_preferences(payload.user_id)

            if prefs.personalization_enabled:
                _upsert_query_memory_for_scope(
                    user_id=payload.user_id,
                    payload=payload,
                    search_field=search_field,
                    query=query,
                )

            _upsert_query_memory_for_scope(
                user_id=None,
                payload=payload,
                search_field=search_field,
                query=query,
            )
        except Exception:  # noqa: BLE001
            logger.debug("Search memory recording failed for query=%s", payload.normalized_query)


def _prune_query_memory_best_effort() -> None:
    try:
        deleted_rows = prune_query_memory_if_due()
    except Exception:  # noqa: BLE001
        logger.exception("Search query memory pruning failed")
        return
    if deleted_rows:
        logger.info("Search query memory pruned deleted_rows=%s", deleted_rows)


def _write_ready_batch(batch: list[ReadySearchLog]) -> None:
    if not batch:
        return
    rows = _batch_rows(batch)
    try:
        insert_search_log_rows(rows=rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Search log batch write failed; retry once: batch_size=%s error=%s",
            len(batch),
            exc,
        )
        try:
            insert_search_log_rows(rows=rows)
        except Exception as retry_exc:  # noqa: BLE001
            logger.warning(
                "Dropping search log batch after retry failure: batch_size=%s error=%s",
                len(batch),
                retry_exc,
            )
            return

    _record_search_memory_from_batch(batch)
    _prune_query_memory_best_effort()

    committed_at_monotonic = time.monotonic()
    with _state_lock:
        for ready in batch:
            _recent_committed_by_slot[ready.slot_key] = RecentCommittedSearchLog(
                semantic_fingerprint=ready.semantic_fingerprint,
                committed_at_monotonic=committed_at_monotonic,
            )


def _worker_main() -> None:
    while not _stop_event.wait(WORKER_POLL_INTERVAL_SECONDS):
        _promote_ready_candidates(flush_all=False)
        _write_ready_batch(_collect_batch(flush_all=False))
    _promote_ready_candidates(flush_all=True)
    _write_ready_batch(_collect_batch(flush_all=True))


def start_search_query_log_worker() -> None:
    global _worker_thread
    with _state_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return
        _stop_event.clear()
        _worker_thread = threading.Thread(
            target=_worker_main,
            name="search-query-log-writer",
            daemon=True,
        )
        _worker_thread.start()


def stop_search_query_log_worker() -> None:
    global _worker_thread
    with _state_lock:
        worker = _worker_thread
        if worker is None:
            return
        _worker_thread = None
        _stop_event.set()
    worker.join(timeout=3.0)
