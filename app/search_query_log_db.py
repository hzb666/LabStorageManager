"""SQLite helpers for lightweight search query logging."""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from app.core.config import settings
from app.services.pinyin_utils import to_pinyin
from app.services.sql_utils import normalize_search_term

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _resolve_query_log_dir(path_value: str) -> Path:
    path = Path(path_value)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


QUERY_LOG_DIR = _resolve_query_log_dir(settings.query_log_dir)
QUERY_LOG_DB_PATH = QUERY_LOG_DIR / "query_logs.db"

_SEARCH_LOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id INTEGER,
    source TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    query TEXT,
    normalized_query TEXT,
    filters_json TEXT NOT NULL,
    sort_json TEXT,
    result_count INTEGER NOT NULL,
    latency_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_search_logs_created_at
ON search_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_search_logs_normalized_query
ON search_logs(normalized_query);

CREATE INDEX IF NOT EXISTS idx_search_logs_endpoint_created_at
ON search_logs(endpoint, created_at);

CREATE INDEX IF NOT EXISTS idx_search_logs_user_created_at
ON search_logs(user_id, created_at);
"""

_EXPECTED_SEARCH_LOG_COLUMNS: tuple[str, ...] = (
    "id",
    "user_id",
    "session_id",
    "source",
    "endpoint",
    "query",
    "normalized_query",
    "filters_json",
    "sort_json",
    "result_count",
    "latency_ms",
    "created_at",
)

_EXPECTED_SEARCH_LOG_INDEXES: dict[str, tuple[str, ...]] = {
    "idx_search_logs_created_at": ("created_at",),
    "idx_search_logs_normalized_query": ("normalized_query",),
    "idx_search_logs_endpoint_created_at": ("endpoint", "created_at"),
    "idx_search_logs_user_created_at": ("user_id", "created_at"),
}

_SEARCH_LOG_SELECT_COLUMNS = """
id,
user_id,
session_id,
source,
endpoint,
query,
normalized_query,
filters_json,
sort_json,
result_count,
latency_ms,
created_at
"""

_SEARCH_LOG_KEYWORD_COLUMNS: tuple[str, ...] = (
    "source",
    "endpoint",
    "query",
    "normalized_query",
    "filters_json",
    "sort_json",
)

SEARCH_LOG_ENDPOINT_LABELS: dict[str, str] = {
    "/inventory/": "库存",
    "/reagent-orders/": "试剂订单",
    "/consumable-orders/": "耗材订单",
    "/common-shelf/groups": "常用货架",
    "/chem/search/substructure": "结构",
}

_SEARCH_LOG_SOURCE_LABELS: dict[str, tuple[str, ...]] = {
    "cli": ("CLI", "命令行"),
    "web": ("Web", "网页"),
}
_SEARCH_LOG_QUERY_ACTION_LABELS: tuple[str, ...] = ("搜索", "查询")
_SEARCH_LOG_FILTER_ACTION_LABELS: tuple[str, ...] = ("筛选", "过滤")


@dataclass(frozen=True)
class SearchLogRow:
    id: int
    user_id: int | None
    session_id: int | None
    source: str
    endpoint: str
    query: str | None
    normalized_query: str | None
    filters_json: str
    sort_json: str | None
    result_count: int
    latency_ms: int | None
    created_at: str


def _open_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(str(QUERY_LOG_DB_PATH), timeout=3.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA synchronous=NORMAL;")
    connection.execute("PRAGMA busy_timeout=3000;")
    return connection


def _sqlite_created_at_to_utc_iso(value: object) -> str:
    text = str(value or "").strip()
    if not text or text.endswith("Z"):
        return text
    if "T" not in text and " " in text:
        text = text.replace(" ", "T", 1)
    return f"{text}Z"


def _matches_search_label(keyword: str, label: str) -> bool:
    raw_keyword = keyword.strip()
    if not raw_keyword:
        return False

    if raw_keyword.casefold() in label.casefold():
        return True

    normalized_keyword = normalize_search_term(raw_keyword)
    label_pinyin = normalize_search_term(to_pinyin(label))
    return bool(normalized_keyword and normalized_keyword in label_pinyin)


def _resolve_matching_search_log_endpoints(keyword: str) -> list[str]:
    return [
        endpoint
        for endpoint, label in SEARCH_LOG_ENDPOINT_LABELS.items()
        if _matches_search_label(keyword, label)
    ]


def _resolve_matching_search_log_sources(keyword: str) -> list[str]:
    matches: list[str] = []
    for source, labels in _SEARCH_LOG_SOURCE_LABELS.items():
        if any(_matches_search_label(keyword, label) for label in labels):
            matches.append(source)
    return matches


def _matches_any_search_log_label(keyword: str, labels: tuple[str, ...]) -> bool:
    return any(_matches_search_label(keyword, label) for label in labels)


def _build_search_log_display_keyword_clauses(keyword: str) -> tuple[list[str], list[object]]:
    clauses: list[str] = []
    params: list[object] = []

    endpoints = _resolve_matching_search_log_endpoints(keyword)
    if endpoints:
        placeholders = ", ".join("?" for _ in endpoints)
        clauses.append(f"endpoint IN ({placeholders})")
        params.extend(endpoints)

    sources = _resolve_matching_search_log_sources(keyword)
    if sources:
        placeholders = ", ".join("?" for _ in sources)
        clauses.append(f"source IN ({placeholders})")
        params.extend(sources)

    has_query = (
        "NULLIF(TRIM(COALESCE(query, '')), '') IS NOT NULL OR "
        "NULLIF(TRIM(COALESCE(normalized_query, '')), '') IS NOT NULL"
    )
    if _matches_any_search_log_label(keyword, _SEARCH_LOG_QUERY_ACTION_LABELS):
        clauses.append(f"({has_query})")

    if _matches_any_search_log_label(keyword, _SEARCH_LOG_FILTER_ACTION_LABELS):
        clauses.append(f"NOT ({has_query})")

    return clauses, params


def _build_search_log_where(
    *,
    user_id: int,
    keyword: str | None,
) -> tuple[str, list[object]]:
    clauses = ["user_id = ?"]
    params: list[object] = [user_id]
    normalized_keyword = (keyword or "").strip()

    if normalized_keyword:
        keyword_clauses = [
            f"{column_name} LIKE ?" for column_name in _SEARCH_LOG_KEYWORD_COLUMNS
        ]
        keyword_params: list[object] = [
            f"%{normalized_keyword}%"
        ] * len(_SEARCH_LOG_KEYWORD_COLUMNS)
        display_clauses, display_params = _build_search_log_display_keyword_clauses(
            normalized_keyword
        )
        keyword_clauses.extend(display_clauses)
        keyword_params.extend(display_params)
        clauses.append(f"({' OR '.join(keyword_clauses)})")
        params.extend(keyword_params)

    return " AND ".join(clauses), params


def _row_to_search_log(row: sqlite3.Row) -> SearchLogRow:
    return SearchLogRow(
        id=int(row["id"]),
        user_id=row["user_id"],
        session_id=row["session_id"],
        source=str(row["source"]),
        endpoint=str(row["endpoint"]),
        query=row["query"],
        normalized_query=row["normalized_query"],
        filters_json=str(row["filters_json"]),
        sort_json=row["sort_json"],
        result_count=int(row["result_count"]),
        latency_ms=row["latency_ms"],
        created_at=_sqlite_created_at_to_utc_iso(row["created_at"]),
    )


def fetch_search_log_rows(
    *,
    user_id: int,
    keyword: str | None,
    skip: int,
    limit: int,
) -> list[SearchLogRow]:
    if limit <= 0:
        return []

    where_clause, params = _build_search_log_where(user_id=user_id, keyword=keyword)
    try:
        with _open_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT {_SEARCH_LOG_SELECT_COLUMNS}
                FROM search_logs
                WHERE {where_clause}
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (*params, limit, max(skip, 0)),
            ).fetchall()
    except sqlite3.Error as exc:
        logger.warning("Search query log read failed: user_id=%s error=%s", user_id, exc)
        return []

    return [_row_to_search_log(row) for row in rows]


def count_search_log_rows(
    *,
    user_id: int,
    keyword: str | None,
) -> int:
    where_clause, params = _build_search_log_where(user_id=user_id, keyword=keyword)
    try:
        with _open_connection() as connection:
            result = connection.execute(
                f"""
                SELECT COUNT(*)
                FROM search_logs
                WHERE {where_clause}
                """,
                params,
            ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Search query log count failed: user_id=%s error=%s", user_id, exc)
        return 0

    return int(result[0] if result else 0)


def init_query_log_db() -> None:
    QUERY_LOG_DIR.mkdir(parents=True, exist_ok=True)
    with _open_connection() as connection:
        connection.executescript(_SEARCH_LOG_SCHEMA)
        _check_query_log_schema_consistency(connection)
        connection.commit()


def _check_query_log_schema_consistency(connection: sqlite3.Connection) -> None:
    mismatch_messages: list[str] = []
    column_rows = connection.execute("PRAGMA table_info(search_logs)").fetchall()
    actual_columns = tuple(str(row["name"]) for row in column_rows)
    if actual_columns != _EXPECTED_SEARCH_LOG_COLUMNS:
        mismatch_messages.append(
            f"search_logs columns mismatch: expected={_EXPECTED_SEARCH_LOG_COLUMNS}, "
            f"db={actual_columns}"
        )

    actual_indexes: dict[str, tuple[str, ...]] = {}
    for index_row in connection.execute("PRAGMA index_list(search_logs)").fetchall():
        index_name = str(index_row["name"])
        column_names = tuple(
            str(column_row["name"])
            for column_row in connection.execute(f'PRAGMA index_info("{index_name}")')
        )
        actual_indexes[index_name] = column_names

    for index_name, expected_columns in _EXPECTED_SEARCH_LOG_INDEXES.items():
        actual_columns_for_index = actual_indexes.get(index_name)
        if actual_columns_for_index != expected_columns:
            mismatch_messages.append(
                f"search_logs index {index_name} mismatch: "
                f"expected={expected_columns}, db={actual_columns_for_index}"
            )

    if mismatch_messages:
        message = " | ".join(mismatch_messages)
        logger.warning("Search query log schema consistency check failed: %s", message)
        if settings.use_secure_runtime():
            raise RuntimeError(
                "Search query log schema consistency check failed: "
                + message
            )


def insert_search_log_row(
    *,
    user_id: int,
    session_id: int,
    source: str,
    endpoint: str,
    query: str | None,
    normalized_query: str | None,
    filters_json: str,
    sort_json: str | None,
    result_count: int,
    latency_ms: int | None,
) -> None:
    insert_search_log_rows(
        rows=[
            (
                user_id,
                session_id,
                source,
                endpoint,
                query,
                normalized_query,
                filters_json,
                sort_json,
                result_count,
                latency_ms,
            )
        ]
    )


def insert_search_log_rows(
    *,
    rows: Iterable[tuple[int, int, str, str, str | None, str | None, str, str | None, int, int | None]],
) -> None:
    with _open_connection() as connection:
        connection.executemany(
            """
            INSERT INTO search_logs (
                user_id,
                session_id,
                source,
                endpoint,
                query,
                normalized_query,
                filters_json,
                sort_json,
                result_count,
                latency_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            list(rows),
        )
        connection.commit()
