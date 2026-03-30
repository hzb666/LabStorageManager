"""Order FTS helpers for high-performance search on SQLite."""
from typing import Mapping, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlmodel import select

from app.services.search_matchers import should_use_trigram_fts


class OrderFTSError(RuntimeError):
    """Raised when building or applying order FTS expressions fails."""


def should_use_order_fts(search_value: str) -> bool:
    """Use trigram FTS for >=3-char non-fuzzy terms (ASCII + Chinese)."""
    return should_use_trigram_fts(search_value, fuzzy=False)


def _quote_fts_phrase(term: str) -> str:
    escaped = term.replace('"', '""')
    return f'"{escaped}"'


def _collect_target_columns(
    field_map: Mapping[str, Sequence[str]],
    search_field: Optional[str],
) -> list[str]:
    if search_field and search_field != "all" and search_field in field_map:
        return list(field_map[search_field])

    deduped: list[str] = []
    seen: set[str] = set()
    for columns in field_map.values():
        for column in columns:
            if column in seen:
                continue
            seen.add(column)
            deduped.append(column)
    return deduped


def build_order_match_query(
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
) -> str:
    """Build a safe FTS5 MATCH expression."""
    target_columns = _collect_target_columns(field_map, search_field)
    if not target_columns:
        raise OrderFTSError("No order FTS target columns configured")

    phrase = _quote_fts_phrase(search_value)
    return " OR ".join(f"{column}:{phrase}" for column in target_columns)


def build_order_fts_id_clause(
    id_column,
    *,
    fts_table: str,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
):
    """Build `id IN (SELECT rowid FROM <fts_table> WHERE MATCH ...)` clause."""
    rowid_subquery = build_order_fts_rowid_subquery(
        fts_table=fts_table,
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )
    return id_column.in_(rowid_subquery)


def build_order_fts_rowid_subquery(
    *,
    fts_table: str,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
):
    """Build `SELECT rowid FROM <fts_table> WHERE MATCH ...` subquery."""
    match_query = build_order_match_query(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )
    match_param_name = f"{fts_table}_match_query"
    match_expr = text(f"{fts_table} MATCH :{match_param_name}").bindparams(
        bindparam(match_param_name, match_query)
    )
    return select(text("rowid")).select_from(text(fts_table)).where(match_expr)
