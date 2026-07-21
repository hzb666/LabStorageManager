"""搜索补全预测数据的 SQLite 操作。"""
from __future__ import annotations

import logging
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.services.sql_utils import normalize_search_term

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_MEMORY_USER_ID = 0
ALL_SEARCH_FIELD = ""
ENTITY_INDEX_STALE_KEY = "entity_index_stale"
ENTITY_INDEX_VERSION_KEY = "entity_index_version"
ENTITY_INDEX_VERSION = "2"
QUERY_MEMORY_PRUNE_META_KEY = "query_memory_last_pruned"
QUERY_MEMORY_PERSONAL_SCOPE_LIMIT = 1_000
QUERY_MEMORY_GLOBAL_SCOPE_LIMIT = 5_000
QUERY_MEMORY_TOTAL_LIMIT = 100_000
QUERY_MEMORY_STALE_DAYS = 180
QUERY_MEMORY_STALE_MAX_FREQUENCY = 2
QUERY_MEMORY_PRUNE_INTERVAL_SECONDS = 60 * 60
INVENTORY_COMPLETION_ENDPOINT = "/inventory/"
REAGENT_ORDER_COMPLETION_ENDPOINT = "/reagent-orders/"
CONSUMABLE_ORDER_COMPLETION_ENDPOINT = "/consumable-orders/"


def _resolve_query_log_dir(path_value: str) -> Path:
    path = Path(path_value)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


QUERY_LOG_DIR = _resolve_query_log_dir(settings.query_log_dir)
QUERY_LOG_DB_PATH = QUERY_LOG_DIR / "query_logs.db"

TARGET_ENDPOINTS = (
    INVENTORY_COMPLETION_ENDPOINT,
    REAGENT_ORDER_COMPLETION_ENDPOINT,
    CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
)

_COMPLETION_SCHEMA = """
CREATE TABLE IF NOT EXISTS search_query_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    endpoint TEXT NOT NULL,
    search_field TEXT NOT NULL DEFAULT '',
    query TEXT NOT NULL,
    normalized_query TEXT NOT NULL,
    frequency INTEGER NOT NULL DEFAULT 1,
    last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accept_count INTEGER NOT NULL DEFAULT 0,
    reject_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_search_query_memory_personal_prefix
ON search_query_memory(user_id, endpoint, search_field, normalized_query);

CREATE INDEX IF NOT EXISTS idx_search_query_memory_global_prefix
ON search_query_memory(endpoint, search_field, normalized_query)
WHERE user_id = 0;

CREATE UNIQUE INDEX IF NOT EXISTS ux_search_query_memory_scope_query
ON search_query_memory(user_id, endpoint, search_field, normalized_query);

CREATE TABLE IF NOT EXISTS entity_completion_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    display_meta TEXT,
    operational_score REAL NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entity_completion_scope_prefix
ON entity_completion_index(endpoint, field, normalized_value);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_completion_identity
ON entity_completion_index(endpoint, field, entity_type, entity_id, value);

CREATE TABLE IF NOT EXISTS user_search_preferences (
    user_id INTEGER PRIMARY KEY,
    personalization_enabled BOOLEAN NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_completion_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


@dataclass(frozen=True)
class SearchPreferences:
    user_id: int
    personalization_enabled: bool


@dataclass(frozen=True)
class QueryMemoryRow:
    id: int
    user_id: int | None
    endpoint: str
    search_field: str | None
    query: str
    normalized_query: str
    frequency: int
    last_used_at: str
    accept_count: int
    reject_count: int


@dataclass(frozen=True)
class EntityCompletionRow:
    id: int
    endpoint: str
    field: str
    value: str
    normalized_value: str
    entity_type: str
    entity_id: str
    display_meta: str | None
    operational_score: float
    updated_at: str


def _open_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(str(QUERY_LOG_DB_PATH), timeout=3.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA synchronous=NORMAL;")
    connection.execute("PRAGMA busy_timeout=3000;")
    return connection


def _db_user_id(user_id: int | None) -> int:
    return user_id if user_id is not None else GLOBAL_MEMORY_USER_ID


def _api_user_id(user_id: int) -> int | None:
    return None if user_id == GLOBAL_MEMORY_USER_ID else user_id


def _db_search_field(search_field: str | None) -> str:
    return search_field or ALL_SEARCH_FIELD


def _api_search_field(search_field: str) -> str | None:
    return None if search_field == ALL_SEARCH_FIELD else search_field


def _normalize_query_key(query: str) -> str:
    return normalize_search_term(query).casefold()


def _entity_completion_stale_key(endpoint: str) -> str:
    return f"{ENTITY_INDEX_STALE_KEY}:{endpoint}"


def _entity_completion_endpoints(endpoint: str | None) -> tuple[str, ...]:
    if endpoint is None:
        return TARGET_ENDPOINTS
    if endpoint not in TARGET_ENDPOINTS:
        raise ValueError(f"Unsupported search completion endpoint: {endpoint}")
    return (endpoint,)


def _mark_entity_completion_endpoints_stale(
    connection: sqlite3.Connection,
    endpoints: tuple[str, ...],
) -> None:
    connection.executemany(
        """
        INSERT INTO search_completion_meta (key, value, updated_at)
        VALUES (?, '1', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = '1',
            updated_at = CURRENT_TIMESTAMP
        """,
        [(_entity_completion_stale_key(endpoint),) for endpoint in endpoints],
    )


def _normalize_search_memory_scope(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT id, user_id, endpoint, search_field, query, normalized_query,
               frequency, last_used_at, accept_count, reject_count
        FROM search_query_memory
        """
    ).fetchall()
    if not rows:
        return

    merged: dict[tuple[int, str, str, str], dict[str, object]] = {}
    for row in rows:
        key = (
            _db_user_id(row["user_id"]),
            str(row["endpoint"]),
            _db_search_field(row["search_field"]),
            _normalize_query_key(str(row["normalized_query"])),
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = {
                "query": str(row["query"]),
                "frequency": int(row["frequency"]),
                "last_used_at": str(row["last_used_at"]),
                "accept_count": int(row["accept_count"]),
                "reject_count": int(row["reject_count"]),
            }
            continue

        existing["frequency"] = int(existing["frequency"]) + int(row["frequency"])
        existing["accept_count"] = int(existing["accept_count"]) + int(row["accept_count"])
        existing["reject_count"] = int(existing["reject_count"]) + int(row["reject_count"])
        if str(row["last_used_at"]) >= str(existing["last_used_at"]):
            existing["last_used_at"] = str(row["last_used_at"])
            existing["query"] = str(row["query"])

    connection.execute("DELETE FROM search_query_memory")
    connection.executemany(
        """
        INSERT INTO search_query_memory
            (user_id, endpoint, search_field, query, normalized_query,
             frequency, last_used_at, accept_count, reject_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                user_id,
                endpoint,
                search_field,
                values["query"],
                normalized_query,
                values["frequency"],
                values["last_used_at"],
                values["accept_count"],
                values["reject_count"],
            )
            for (user_id, endpoint, search_field, normalized_query), values in merged.items()
        ],
    )


def _normalize_entity_index_stale_scope(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT value FROM search_completion_meta WHERE key = ?",
        (ENTITY_INDEX_STALE_KEY,),
    ).fetchone()
    if not row or row["value"] != "1":
        return

    _mark_entity_completion_endpoints_stale(connection, TARGET_ENDPOINTS)
    connection.execute(
        """
        INSERT INTO search_completion_meta (key, value, updated_at)
        VALUES (?, '0', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = '0',
            updated_at = CURRENT_TIMESTAMP
        """,
        (ENTITY_INDEX_STALE_KEY,),
    )


def _ensure_entity_completion_index_version(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT value FROM search_completion_meta WHERE key = ?",
        (ENTITY_INDEX_VERSION_KEY,),
    ).fetchone()
    if row and row["value"] == ENTITY_INDEX_VERSION:
        return

    _mark_entity_completion_endpoints_stale(connection, TARGET_ENDPOINTS)
    connection.execute(
        """
        INSERT INTO search_completion_meta (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        """,
        (ENTITY_INDEX_VERSION_KEY, ENTITY_INDEX_VERSION),
    )


def init_search_completion_db() -> None:
    QUERY_LOG_DIR.mkdir(parents=True, exist_ok=True)
    with _open_connection() as connection:
        connection.executescript(_COMPLETION_SCHEMA)
        _normalize_search_memory_scope(connection)
        _normalize_entity_index_stale_scope(connection)
        _ensure_entity_completion_index_version(connection)
        connection.commit()
    logger.info("Search completion tables initialized in query_logs.db")


# ---------- user_search_preferences ----------


def get_user_preferences(user_id: int) -> SearchPreferences:
    with _open_connection() as connection:
        row = connection.execute(
            "SELECT user_id, personalization_enabled FROM user_search_preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if row:
        return SearchPreferences(
            user_id=int(row["user_id"]),
            personalization_enabled=bool(row["personalization_enabled"]),
        )
    return SearchPreferences(user_id=user_id, personalization_enabled=True)


def upsert_user_preferences(user_id: int, personalization_enabled: bool) -> SearchPreferences:
    with _open_connection() as connection:
        connection.execute(
            """
            INSERT INTO user_search_preferences (user_id, personalization_enabled, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                personalization_enabled = excluded.personalization_enabled,
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, int(personalization_enabled)),
        )
        connection.commit()
    return SearchPreferences(user_id=user_id, personalization_enabled=personalization_enabled)


# ---------- search_query_memory ----------


def upsert_query_memory(
    *,
    user_id: int | None,
    endpoint: str,
    search_field: str | None,
    query: str,
    normalized_query: str,
) -> None:
    db_user_id = _db_user_id(user_id)
    db_search_field = _db_search_field(search_field)
    db_normalized_query = _normalize_query_key(normalized_query)
    with _open_connection() as connection:
        connection.execute(
            """
            INSERT INTO search_query_memory
                (user_id, endpoint, search_field, query, normalized_query, frequency, last_used_at)
            VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, endpoint, search_field, normalized_query) DO UPDATE SET
                frequency = frequency + 1,
                last_used_at = CURRENT_TIMESTAMP,
                query = excluded.query
            """,
            (db_user_id, endpoint, db_search_field, query, db_normalized_query),
        )
        connection.commit()


def _is_query_memory_prune_due(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        """
        SELECT updated_at >= datetime('now', ?) AS recently_pruned
        FROM search_completion_meta
        WHERE key = ?
        """,
        (f"-{QUERY_MEMORY_PRUNE_INTERVAL_SECONDS} seconds", QUERY_MEMORY_PRUNE_META_KEY),
    ).fetchone()
    return not bool(row and row["recently_pruned"])


def _delete_stale_query_memory(connection: sqlite3.Connection) -> int:
    changes_before = connection.total_changes
    connection.execute(
        """
        DELETE FROM search_query_memory
        WHERE frequency <= ?
          AND last_used_at <= datetime('now', ?)
        """,
        (QUERY_MEMORY_STALE_MAX_FREQUENCY, f"-{QUERY_MEMORY_STALE_DAYS} days"),
    )
    return connection.total_changes - changes_before


def _delete_query_memory_beyond_scope_limit(
    connection: sqlite3.Connection,
    *,
    global_scope: bool,
    limit: int,
) -> int:
    scope_filter = "user_id = ?" if global_scope else "user_id <> ?"
    partition_columns = "endpoint, search_field"
    if not global_scope:
        partition_columns = f"user_id, {partition_columns}"

    changes_before = connection.total_changes
    connection.execute(
        f"""
        DELETE FROM search_query_memory
        WHERE id IN (
            SELECT id
            FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY {partition_columns}
                    ORDER BY frequency DESC, last_used_at DESC, id DESC
                ) AS keep_rank
                FROM search_query_memory
                WHERE {scope_filter}
            )
            WHERE keep_rank > ?
        )
        """,
        (GLOBAL_MEMORY_USER_ID, limit),
    )
    return connection.total_changes - changes_before


def _delete_query_memory_beyond_total_limit(connection: sqlite3.Connection) -> int:
    changes_before = connection.total_changes
    connection.execute(
        """
        DELETE FROM search_query_memory
        WHERE id IN (
            SELECT id
            FROM (
                SELECT id, ROW_NUMBER() OVER (
                    ORDER BY frequency DESC, last_used_at DESC, id DESC
                ) AS keep_rank
                FROM search_query_memory
            )
            WHERE keep_rank > ?
        )
        """,
        (QUERY_MEMORY_TOTAL_LIMIT,),
    )
    return connection.total_changes - changes_before


def _record_query_memory_prune(connection: sqlite3.Connection, deleted_rows: int) -> None:
    connection.execute(
        """
        INSERT INTO search_completion_meta (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        """,
        (QUERY_MEMORY_PRUNE_META_KEY, str(deleted_rows)),
    )


def prune_query_memory_if_due() -> int | None:
    """Prune persisted query memory when the cross-process throttle allows it."""
    with closing(_open_connection()) as connection:
        if not _is_query_memory_prune_due(connection):
            return None

        connection.execute("BEGIN IMMEDIATE")
        if not _is_query_memory_prune_due(connection):
            connection.commit()
            return None

        deleted_rows = _delete_stale_query_memory(connection)
        deleted_rows += _delete_query_memory_beyond_scope_limit(
            connection,
            global_scope=False,
            limit=QUERY_MEMORY_PERSONAL_SCOPE_LIMIT,
        )
        deleted_rows += _delete_query_memory_beyond_scope_limit(
            connection,
            global_scope=True,
            limit=QUERY_MEMORY_GLOBAL_SCOPE_LIMIT,
        )
        deleted_rows += _delete_query_memory_beyond_total_limit(connection)
        _record_query_memory_prune(connection, deleted_rows)
        connection.commit()
    return deleted_rows


def increment_feedback(
    *,
    user_id: int | None,
    endpoint: str,
    search_field: str | None,
    normalized_query: str,
    accepted: bool,
) -> None:
    column = "accept_count" if accepted else "reject_count"
    db_user_id = _db_user_id(user_id)
    db_search_field = _db_search_field(search_field)
    db_normalized_query = _normalize_query_key(normalized_query)
    with _open_connection() as connection:
        connection.execute(
            f"""
            UPDATE search_query_memory
            SET {column} = {column} + 1
            WHERE user_id = ? AND endpoint = ? AND search_field = ?
                AND normalized_query = ?
            """,
            (db_user_id, endpoint, db_search_field, db_normalized_query),
        )
        connection.commit()


def query_memory_by_prefix(
    *,
    user_id: int | None,
    endpoint: str,
    search_field: str | None,
    prefix: str,
    limit: int = 20,
) -> list[QueryMemoryRow]:
    db_user_id = _db_user_id(user_id)
    db_search_field = _db_search_field(search_field)
    db_prefix = _normalize_query_key(prefix)
    with _open_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, user_id, endpoint, search_field, query, normalized_query,
                   frequency, last_used_at, accept_count, reject_count
            FROM search_query_memory
            WHERE user_id = ? AND endpoint = ? AND search_field = ?
                AND normalized_query LIKE ? || '%'
            ORDER BY frequency DESC, last_used_at DESC
            LIMIT ?
            """,
            (db_user_id, endpoint, db_search_field, db_prefix, limit),
        ).fetchall()
    return [
        QueryMemoryRow(
            id=int(r["id"]),
            user_id=_api_user_id(int(r["user_id"])),
            endpoint=str(r["endpoint"]),
            search_field=_api_search_field(str(r["search_field"])),
            query=str(r["query"]),
            normalized_query=str(r["normalized_query"]),
            frequency=int(r["frequency"]),
            last_used_at=str(r["last_used_at"]),
            accept_count=int(r["accept_count"]),
            reject_count=int(r["reject_count"]),
        )
        for r in rows
    ]


def mark_entity_completion_index_stale(endpoint: str | None = None) -> None:
    endpoints = _entity_completion_endpoints(endpoint)
    with _open_connection() as connection:
        _mark_entity_completion_endpoints_stale(connection, endpoints)
        connection.commit()


def is_entity_completion_index_stale(endpoint: str) -> bool:
    endpoint_key = _entity_completion_stale_key(_entity_completion_endpoints(endpoint)[0])
    with _open_connection() as connection:
        row = connection.execute(
            "SELECT value FROM search_completion_meta WHERE key = ?",
            (endpoint_key,),
        ).fetchone()
    return bool(row and row["value"] == "1")


def clear_entity_completion_index_stale(endpoint: str | None = None) -> None:
    endpoints = _entity_completion_endpoints(endpoint)
    with _open_connection() as connection:
        connection.executemany(
            """
            INSERT INTO search_completion_meta (key, value, updated_at)
            VALUES (?, '0', CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = '0',
                updated_at = CURRENT_TIMESTAMP
            """,
            [(_entity_completion_stale_key(current),) for current in endpoints],
        )
        connection.commit()


# ---------- entity_completion_index ----------


def query_entity_by_prefix(
    *,
    endpoint: str,
    field: str,
    prefix: str,
    limit: int = 30,
) -> list[EntityCompletionRow]:
    with _open_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, endpoint, field, value, normalized_value,
                   entity_type, entity_id, display_meta, operational_score, updated_at
            FROM entity_completion_index
            WHERE endpoint = ? AND field = ? AND normalized_value LIKE ? || '%'
            ORDER BY operational_score DESC, value ASC
            LIMIT ?
            """,
            (endpoint, field, prefix, limit),
        ).fetchall()
    return [
        EntityCompletionRow(
            id=int(r["id"]),
            endpoint=str(r["endpoint"]),
            field=str(r["field"]),
            value=str(r["value"]),
            normalized_value=str(r["normalized_value"]),
            entity_type=str(r["entity_type"]),
            entity_id=str(r["entity_id"]),
            display_meta=r["display_meta"],
            operational_score=float(r["operational_score"]),
            updated_at=str(r["updated_at"]),
        )
        for r in rows
    ]


def clear_entity_completion_index(endpoint: str | None = None) -> None:
    with _open_connection() as connection:
        if endpoint is None:
            connection.execute("DELETE FROM entity_completion_index")
        else:
            connection.execute("DELETE FROM entity_completion_index WHERE endpoint = ?", (endpoint,))
        connection.commit()


def replace_entity_completions_for_entity(
    endpoint: str,
    entity_type: str,
    entity_id: str,
    rows: list[tuple[str, str, str, str, str, str, str | None, float]],
) -> None:
    with _open_connection() as connection:
        connection.execute(
            """
            DELETE FROM entity_completion_index
            WHERE endpoint = ? AND entity_type = ? AND entity_id = ?
            """,
            (endpoint, entity_type, entity_id),
        )
        if rows:
            connection.executemany(
                """
                INSERT OR REPLACE INTO entity_completion_index
                    (endpoint, field, value, normalized_value, entity_type, entity_id,
                     display_meta, operational_score, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                rows,
            )
        connection.commit()


def delete_entity_completions_for_entity(
    endpoint: str,
    entity_type: str,
    entity_id: str,
) -> None:
    with _open_connection() as connection:
        connection.execute(
            """
            DELETE FROM entity_completion_index
            WHERE endpoint = ? AND entity_type = ? AND entity_id = ?
            """,
            (endpoint, entity_type, entity_id),
        )
        connection.commit()


def bulk_insert_entity_completions(
    rows: list[tuple[str, str, str, str, str, str, str | None, float]],
) -> None:
    with _open_connection() as connection:
        connection.executemany(
            """
            INSERT OR REPLACE INTO entity_completion_index
                (endpoint, field, value, normalized_value, entity_type, entity_id,
                 display_meta, operational_score, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            rows,
        )
        connection.commit()
