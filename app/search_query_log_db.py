"""SQLite helpers for lightweight search query logging."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
QUERY_LOG_DIR = PROJECT_ROOT / "logs"
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


def _open_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(str(QUERY_LOG_DB_PATH), timeout=1.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA synchronous=NORMAL;")
    connection.execute("PRAGMA busy_timeout=1000;")
    return connection


def init_query_log_db() -> None:
    QUERY_LOG_DIR.mkdir(parents=True, exist_ok=True)
    with _open_connection() as connection:
        connection.executescript(_SEARCH_LOG_SCHEMA)
        connection.commit()


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
