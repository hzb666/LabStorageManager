"""Inventory FTS helpers for high-performance substring search on SQLite."""
from collections.abc import Mapping, Sequence

from sqlalchemy import bindparam, text
from sqlmodel import select

from app.models.inventory import Inventory
from app.services.search_matchers import should_use_trigram_fts


class InventoryFTSError(RuntimeError):
    """Raised when building or applying inventory FTS expressions fails."""


def should_use_inventory_fts(search_value: str) -> bool:
    """Use trigram FTS for >=3-char non-fuzzy terms (ASCII + Chinese)."""
    return should_use_trigram_fts(search_value, fuzzy=False)


def _quote_fts_phrase(term: str) -> str:
    escaped = term.replace('"', '""')
    return f'"{escaped}"'


def _collect_target_columns(
    field_map: Mapping[str, Sequence[str]],
    search_field: str | None,
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
    search_field: str | None,
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
    search_field: str | None,
    field_map: Mapping[str, Sequence[str]],
):
    """Apply `inventory_fts MATCH ...` filter onto an inventory SQLModel query."""
    rowid_subquery = build_inventory_fts_rowid_subquery(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )
    return base.where(Inventory.id.in_(rowid_subquery))


def build_inventory_fts_rowid_subquery(
    *,
    search_value: str,
    search_field: str | None,
    field_map: Mapping[str, Sequence[str]],
):
    """Build `SELECT rowid FROM inventory_fts WHERE MATCH ...` subquery."""
    match_query = build_inventory_match_query(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )

    match_expr = text("inventory_fts MATCH :match_query").bindparams(
        bindparam("match_query", match_query)
    )
    return (
        select(text("rowid"))
        .select_from(text("inventory_fts"))
        .where(match_expr)
    )
