"""Inventory FTS helpers for high-performance substring search on SQLite."""
from typing import Mapping, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlmodel import select

from app.models.inventory import Inventory


MIN_FTS_TERM_LENGTH = 3


class InventoryFTSError(RuntimeError):
    """Raised when building or applying inventory FTS expressions fails."""


def should_use_inventory_fts(search_value: str) -> bool:
    """Use FTS only for ASCII pinyin/initial keywords.

    Chinese-word matching keeps legacy LIKE path to avoid tokenizer edge cases.
    """
    if len(search_value) < MIN_FTS_TERM_LENGTH:
        return False

    allowed = {" ", "_", "-"}
    return all((ch.isascii() and (ch.isalnum() or ch in allowed)) for ch in search_value)


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


def build_inventory_match_query(
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
) -> str:
    """Build a safe FTS5 MATCH expression for inventory search."""
    target_columns = _collect_target_columns(field_map, search_field)
    if not target_columns:
        raise InventoryFTSError("No inventory FTS target columns configured")

    phrase = _quote_fts_phrase(search_value)
    return " OR ".join(f"{column}:{phrase}" for column in target_columns)


def apply_inventory_fts_filter(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
):
    """Apply `inventory_fts MATCH ...` filter onto an inventory SQLModel query."""
    match_query = build_inventory_match_query(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )

    match_expr = text("inventory_fts MATCH :match_query").bindparams(
        bindparam("match_query", match_query)
    )
    rowid_subquery = (
        select(text("rowid"))
        .select_from(text("inventory_fts"))
        .where(match_expr)
    )
    return base.where(Inventory.id.in_(rowid_subquery))
