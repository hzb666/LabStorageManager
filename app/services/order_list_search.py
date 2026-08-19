"""Shared helpers for reagent/consumable order list search."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.services.order_fts import (
    OrderFTSError,
    build_order_fts_id_clause,
    build_order_fts_rowid_subquery,
    should_use_order_fts,
)
from app.services.search_matchers import (
    TextMatchMode,
    build_cas_search_clause,
    build_date_search_clause,
    build_text_search_clause,
    collect_search_fields,
    combine_or_clauses,
)
from app.services.sql_utils import normalize_search_term


@dataclass(frozen=True)
class OrderListFTSState:
    fts_clause: Any
    fts_rowid_subquery: Any


@dataclass(frozen=True)
class OrderListSearchConfig:
    id_column: Any
    applicant_id_column: Any
    created_at_column: Any
    sql_field_map: dict[str, list[Any]]
    fts_field_map: dict[str, list[str]]
    applicant_search_keys: frozenset[str]
    cas_search_keys: frozenset[str]
    cas_column: Any | None = None


def normalize_order_list_search_value(search: str | None, *, fuzzy: bool) -> str | None:
    if not search:
        return None
    raw_search = search.strip()
    if not raw_search:
        return None
    if fuzzy:
        return normalize_search_term(raw_search)
    return raw_search


def build_order_list_fts_state(
    *,
    config: OrderListSearchConfig,
    fts_table: str,
    search_value: str,
    search_field: str | None,
    fuzzy: bool,
    match_mode: TextMatchMode,
    allow_fts: bool,
    logger: logging.Logger,
    log_label: str,
) -> OrderListFTSState:
    use_fts = (
        allow_fts
        and match_mode == TextMatchMode.CONTAINS
        and (not fuzzy)
        and should_use_order_fts(search_value)
    )
    if not use_fts:
        return OrderListFTSState(fts_clause=None, fts_rowid_subquery=None)
    try:
        return OrderListFTSState(
            fts_clause=build_order_fts_id_clause(
                config.id_column,
                fts_table=fts_table,
                search_value=search_value,
                search_field=search_field,
                field_map=config.fts_field_map,
            ),
            fts_rowid_subquery=build_order_fts_rowid_subquery(
                fts_table=fts_table,
                search_value=search_value,
                search_field="all",
                field_map=config.fts_field_map,
            ),
        )
    except OrderFTSError:
        return OrderListFTSState(fts_clause=None, fts_rowid_subquery=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("%s FTS fallback to SQL LIKE due to runtime error: %s", log_label, exc)
        return OrderListFTSState(fts_clause=None, fts_rowid_subquery=None)


def apply_order_list_single_field_search(
    base,
    *,
    config: OrderListSearchConfig,
    search_field: str | None,
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
    applicant_id_subquery,
    fts_clause,
    cas_exact_or_prefix: bool = False,
):
    filtered = base
    matched = True
    if search_field in config.applicant_search_keys:
        filtered = base.where(config.applicant_id_column.in_(applicant_id_subquery))
    elif search_field == "created_at":
        filtered = base.where(build_date_search_clause(config.created_at_column, search_value))
    elif (
        search_field in config.cas_search_keys
        and config.cas_column is not None
        and cas_exact_or_prefix
    ):
        filtered = base.where(
            build_cas_search_clause(
                config.cas_column,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )
    elif fts_clause is not None and search_field in config.fts_field_map:
        filtered = base.where(fts_clause)
    elif search_field in config.sql_field_map:
        if search_field in config.cas_search_keys and config.cas_column is not None:
            filtered = base.where(
                build_cas_search_clause(
                    config.cas_column,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
            )
        else:
            filtered = base.where(
                combine_or_clauses(
                    build_text_search_clause(
                        field,
                        search_value,
                        fuzzy=fuzzy,
                        match_mode=match_mode,
                    )
                    for field in config.sql_field_map[search_field]
                )
            )
    else:
        matched = False
    return filtered, matched


def build_order_list_all_search_clause(
    *,
    config: OrderListSearchConfig,
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
    applicant_id_subquery,
    fts_rowid_subquery,
):
    all_clauses = [
        config.applicant_id_column.in_(applicant_id_subquery),
        build_date_search_clause(config.created_at_column, search_value),
    ]
    if fts_rowid_subquery is not None:
        all_clauses.append(config.id_column.in_(fts_rowid_subquery))
    else:
        if config.cas_column is not None:
            all_clauses.append(
                build_cas_search_clause(
                    config.cas_column,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
            )
        text_fields = collect_search_fields(
            config.sql_field_map,
            exclude_keys={*config.cas_search_keys, "created_at"},
        )
        if text_fields:
            all_clauses.append(
                combine_or_clauses(
                    build_text_search_clause(
                        field,
                        search_value,
                        fuzzy=fuzzy,
                        match_mode=match_mode,
                    )
                    for field in text_fields
                )
            )
    return combine_or_clauses(all_clauses)
