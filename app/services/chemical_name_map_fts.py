"""Chemical name map FTS helpers."""
from __future__ import annotations

from typing import Mapping, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlmodel import select

from app.models.chemical_name_map import ChemicalNameMap
from app.services.search_matchers import should_use_trigram_fts


class ChemicalNameMapFTSError(RuntimeError):
    """Raised when building or applying chemical-name-map FTS expressions fails."""


def should_use_chemical_name_map_fts(search_value: str) -> bool:
    """Use trigram FTS for >=3-char non-fuzzy terms."""
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


def build_chemical_name_map_match_query(
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
) -> str:
    """Build a safe FTS5 MATCH expression for chemical-name-map search."""
    target_columns = _collect_target_columns(field_map, search_field)
    if not target_columns:
        raise ChemicalNameMapFTSError("No chemical name map FTS target columns configured")

    phrase = _quote_fts_phrase(search_value)
    return " OR ".join(f"{column}:{phrase}" for column in target_columns)


def build_chemical_name_map_fts_rowid_subquery(
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
):
    """Build `SELECT rowid FROM chemical_name_map_fts WHERE MATCH ...` subquery."""
    match_query = build_chemical_name_map_match_query(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )

    match_expr = text("chemical_name_map_fts MATCH :match_query").bindparams(
        bindparam("match_query", match_query)
    )
    return (
        select(text("rowid"))
        .select_from(text("chemical_name_map_fts"))
        .where(match_expr)
    )


def apply_chemical_name_map_fts_filter(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    field_map: Mapping[str, Sequence[str]],
):
    """Apply `chemical_name_map_fts MATCH ...` filter onto a name-map query."""
    rowid_subquery = build_chemical_name_map_fts_rowid_subquery(
        search_value=search_value,
        search_field=search_field,
        field_map=field_map,
    )
    return base.where(ChemicalNameMap.id.in_(rowid_subquery))
