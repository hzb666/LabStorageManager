"""Common shelf grouped search helpers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.common_name_utils import strip_std_name_marker
from app.services.pinyin_utils import to_pinyin_parts
from app.services.sql_utils import normalize_search_term

_STD_AWARE_FIELDS = {None, "all", "name", "alias"}


@dataclass(frozen=True)
class CommonShelfSearchPrep:
    """Normalized grouped-search input."""

    value: str | None
    marker_only: bool = False


@dataclass(frozen=True)
class CommonShelfSearchMatch:
    """Grouped-row match metadata for UI rendering."""

    matched: bool
    matched_field: str | None = None
    matched_name: str | None = None


def split_common_alias_tokens(alias: str | None) -> list[str]:
    """Split common-shelf alias text by `$` without preserving empty tokens."""

    if not alias:
        return []
    return [token.strip() for token in alias.split("$") if token.strip()]


def prepare_common_shelf_search_term(
    search: str | None,
    *,
    search_field: str | None,
    fuzzy: bool,
) -> CommonShelfSearchPrep:
    """Normalize common-shelf search term and hide `[std]` from search semantics."""

    if not search:
        return CommonShelfSearchPrep(value=None)

    value = search.strip()
    if not value:
        return CommonShelfSearchPrep(value=None)

    if search_field in _STD_AWARE_FIELDS:
        value = strip_std_name_marker(value)
        if not value:
            return CommonShelfSearchPrep(value=None, marker_only=True)

    if fuzzy:
        value = normalize_search_term(value)
        if not value:
            return CommonShelfSearchPrep(value=None)

    return CommonShelfSearchPrep(value=value)


def _contains_query(text: str | None, query: str, *, fuzzy: bool) -> bool:
    if not text:
        return False

    raw_text = text.casefold()
    raw_query = query.casefold()
    if raw_query in raw_text:
        return True

    normalized_query = normalize_search_term(query).casefold()
    if not normalized_query:
        return False

    normalized_text = normalize_search_term(text).casefold()
    if normalized_query in normalized_text:
        return True

    full_pinyin, initials = to_pinyin_parts(text)
    if normalized_query in full_pinyin or normalized_query in initials:
        return True

    if fuzzy:
        return normalized_query in normalized_text

    return False


def _match_name_or_alias(
    name: str | None,
    alias: str | None,
    query: str,
    *,
    search_field: str | None,
    fuzzy: bool,
) -> CommonShelfSearchMatch:
    if search_field in {None, "all", "name"} and _contains_query(name, query, fuzzy=fuzzy):
        return CommonShelfSearchMatch(matched=True, matched_field="name", matched_name=name)

    if search_field in {None, "all", "alias"}:
        for token in split_common_alias_tokens(alias):
            if _contains_query(token, query, fuzzy=fuzzy):
                return CommonShelfSearchMatch(matched=True, matched_field="alias", matched_name=token)

    return CommonShelfSearchMatch(matched=False)


def match_common_shelf_row(
    row: dict[str, Any],
    *,
    search_value: str | None,
    search_field: str | None,
    fuzzy: bool,
) -> CommonShelfSearchMatch:
    """Match one grouped common-shelf row against the current search input."""

    if not search_value:
        return CommonShelfSearchMatch(matched=True)

    if search_field == "cas_number":
        return CommonShelfSearchMatch(
            matched=_contains_query(str(row.get("cas_number") or ""), search_value, fuzzy=fuzzy)
        )

    if search_field == "brand":
        return CommonShelfSearchMatch(
            matched=_contains_query(str(row.get("brand") or ""), search_value, fuzzy=fuzzy)
        )

    if search_field == "category":
        return CommonShelfSearchMatch(
            matched=_contains_query(str(row.get("category") or ""), search_value, fuzzy=fuzzy)
        )

    if search_field == "storage_location":
        return CommonShelfSearchMatch(
            matched=_contains_query(str(row.get("storage_location") or ""), search_value, fuzzy=fuzzy)
        )

    name_alias_match = _match_name_or_alias(
        str(row.get("name") or ""),
        str(row.get("alias") or ""),
        search_value,
        search_field=search_field,
        fuzzy=fuzzy,
    )
    if name_alias_match.matched or search_field in {"name", "alias"}:
        return name_alias_match

    searchable_fields = (
        str(row.get("cas_number") or ""),
        str(row.get("brand") or ""),
        str(row.get("category") or ""),
        str(row.get("storage_location") or ""),
    )
    return CommonShelfSearchMatch(
        matched=any(_contains_query(value, search_value, fuzzy=fuzzy) for value in searchable_fields)
    )
