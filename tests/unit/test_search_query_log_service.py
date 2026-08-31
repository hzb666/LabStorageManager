import json
from dataclasses import dataclass

from app.services import search_query_log_service as service
from app.services.search_matchers import (
    build_multi_search_log_meta,
    build_segmented_search_log_meta,
)


@dataclass(frozen=True)
class _Prefs:
    personalization_enabled: bool = True


def _ready_log(
    *,
    query: str,
    filters_json: str = "{}",
    endpoint: str = "/inventory/",
) -> service.ReadySearchLog:
    payload = service.SearchLogPayload(
        user_id=1,
        session_id=1,
        source="web",
        endpoint=endpoint,
        query=query,
        normalized_query=query.lower(),
        filters_json=filters_json,
        sort_json=None,
        result_count=1,
        latency_ms=10,
    )
    return service.ReadySearchLog(
        slot_key=f"slot:{query}",
        semantic_fingerprint=f"fingerprint:{query}",
        payload=payload,
        enqueued_at_monotonic=0,
    )


def test_segmented_query_writes_search_log_but_not_query_memory(monkeypatch) -> None:
    inserted_rows = []
    memory_rows = []

    monkeypatch.setattr(
        service,
        "insert_search_log_rows",
        lambda *, rows: inserted_rows.extend(rows),
    )
    monkeypatch.setattr(service, "get_user_preferences", lambda _user_id: _Prefs())
    monkeypatch.setattr(
        service,
        "upsert_query_memory",
        lambda **kwargs: memory_rows.append(kwargs),
    )
    monkeypatch.setattr(service, "prune_query_memory_if_due", lambda: None)

    service._write_ready_batch([_ready_log(query="三氟 磺酸钠")])

    assert len(inserted_rows) == 1
    assert inserted_rows[0][4] == "三氟 磺酸钠"
    assert memory_rows == []


def test_multi_cas_query_still_records_split_terms_in_query_memory(monkeypatch) -> None:
    memory_rows = []

    monkeypatch.setattr(service, "get_user_preferences", lambda _user_id: _Prefs())
    monkeypatch.setattr(
        service,
        "upsert_query_memory",
        lambda **kwargs: memory_rows.append(kwargs),
    )

    service._record_search_memory_from_batch([
        _ready_log(
            query="64 - 17 - 5 && 67 - 56 - 1",
            filters_json='{"search_field": "cas_number"}',
        )
    ])

    recorded_queries = [row["query"] for row in memory_rows]

    assert recorded_queries == ["64-17-5", "64-17-5", "67-56-1", "67-56-1"]
    assert {row["search_field"] for row in memory_rows} == {"cas_number"}


def test_multi_cas_query_without_explicit_field_records_split_terms(monkeypatch) -> None:
    memory_rows = []

    monkeypatch.setattr(service, "get_user_preferences", lambda _user_id: _Prefs(False))
    monkeypatch.setattr(
        service,
        "upsert_query_memory",
        lambda **kwargs: memory_rows.append(kwargs),
    )

    service._record_search_memory_from_batch([
        _ready_log(query="64-17-5&&67-56-1")
    ])

    assert [row["query"] for row in memory_rows] == ["64-17-5", "67-56-1"]
    assert {row["search_field"] for row in memory_rows} == {None}


def test_segmented_search_terms_remain_structured_in_filters_json() -> None:
    filters = service.build_search_log_filters(
        fuzzy=True,
        extra_filters=build_segmented_search_log_meta(["三氟", "磺酸钠"], enabled=True),
    )

    serialized = service._serialize_mapping(filters)

    assert serialized is not None
    assert json.loads(serialized)["search_terms"] == ["三氟", "磺酸钠"]


def test_multi_cas_search_terms_remain_structured_in_filters_json() -> None:
    filters = service.build_search_log_filters(
        extra_filters=build_multi_search_log_meta("64-17-5&&67-56-1", enabled=True),
    )

    serialized = service._serialize_mapping(filters)

    assert serialized is not None
    assert json.loads(serialized)["search_terms"] == ["64-17-5", "67-56-1"]
