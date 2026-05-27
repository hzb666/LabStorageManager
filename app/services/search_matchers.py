"""Shared search matcher helpers for inventory/order list APIs."""
from datetime import datetime, timedelta
from enum import Enum
import re
from typing import Any, Iterable, Mapping, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlalchemy import false as sql_false
from sqlmodel import func, select

from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.sql_utils import normalize_field_sql, normalize_search_term


CAS_PREFIX_PATTERN = re.compile(r"^[0-9-]{1,50}$")
DATE_DIGITS_PATTERN = re.compile(r"[^0-9]")
TRIGRAM_FTS_MIN_LEN = 3
SQL_IN_CHUNK_SIZE = 500
PRECOMPUTED_LOWERCASE_FIELD_SUFFIXES = (
    "_pinyin",
    "_pinyin_initials",
    "_initials",
)

SEARCH_MULTI_DELIMITER = "&&"


def split_exact_cas_search_terms(search: Optional[str]) -> list[str]:
    """Split && CAS search input into unique normalized CAS terms."""
    if not search or SEARCH_MULTI_DELIMITER not in search:
        return []

    terms: list[str] = []
    seen: set[str] = set()
    for raw_term in search.strip().split(SEARCH_MULTI_DELIMITER):
        normalized = normalize_cas(raw_term)
        if not normalized or normalized in seen:
            continue
        terms.append(normalized)
        seen.add(normalized)
    return terms


def build_multi_search_log_meta(search: Optional[str], *, enabled: bool) -> dict[str, Any]:
    if not enabled:
        return {}
    terms = split_exact_cas_search_terms(search)
    if len(terms) <= 1:
        return {}
    return {
        "search_operator": "multi",
        "search_terms": terms,
        "search_terms_count": len(terms),
    }


def build_chunked_in_clause(field, values: Sequence[str], *, chunk_size: int = SQL_IN_CHUNK_SIZE):
    """Build an IN clause split into chunks to avoid SQLite parameter limits."""
    chunks = [
        tuple(values[index:index + chunk_size])
        for index in range(0, len(values), chunk_size)
    ]
    if not chunks:
        return sql_false()
    return combine_or_clauses(field.in_(chunk) for chunk in chunks)


class CASSearchMode(str, Enum):
    EXACT = "exact"
    PREFIX = "prefix"
    CONTAINS = "contains"


class TextMatchMode(str, Enum):
    CONTAINS = "contains"
    EXACT = "exact"


def combine_or_clauses(clauses: Iterable[Any]):
    """Combine SQLAlchemy clauses with OR."""
    clauses_list = list(clauses)
    if not clauses_list:
        raise ValueError("At least one clause is required")

    expr = clauses_list[0]
    for clause in clauses_list[1:]:
        expr = expr | clause
    return expr


def collect_search_fields(
    field_map: Mapping[str, Sequence[Any]],
    *,
    exclude_keys: Optional[set[str]] = None,
) -> list[Any]:
    """Collect deduplicated SQLModel fields from a configured field-map."""
    excluded = exclude_keys or set()
    deduped: list[Any] = []
    seen: set[Any] = set()
    for key, fields in field_map.items():
        if key in excluded:
            continue
        for field in fields:
            if field in seen:
                continue
            seen.add(field)
            deduped.append(field)
    return deduped


def union_id_subqueries(subqueries: Iterable[Any]):
    """Build a UNION subquery from ``SELECT <id>`` statements."""
    candidates = [subquery for subquery in subqueries if subquery is not None]
    if not candidates:
        return None

    union_query = candidates[0]
    for subquery in candidates[1:]:
        union_query = union_query.union(subquery)
    return union_query


def _get_search_field_name(field: Any) -> str:
    for attr_name in ("key", "name"):
        value = getattr(field, attr_name, None)
        if isinstance(value, str) and value:
            return value

    expression = getattr(field, "expression", None)
    for attr_name in ("key", "name"):
        value = getattr(expression, attr_name, None)
        if isinstance(value, str) and value:
            return value

    return ""


def _is_precomputed_lowercase_field(field: Any) -> bool:
    field_name = _get_search_field_name(field)
    return field_name.endswith(PRECOMPUTED_LOWERCASE_FIELD_SUFFIXES)


def build_text_search_clause(
    field,
    search_value: str,
    *,
    fuzzy: bool,
    match_mode: TextMatchMode = TextMatchMode.CONTAINS,
):
    """Build a text search clause while preserving fast paths for normalized fields."""
    if _is_precomputed_lowercase_field(field):
        normalized_value = normalize_search_term(search_value) if fuzzy else search_value
        lowered_value = normalized_value.lower()
        if match_mode == TextMatchMode.EXACT:
            return field == lowered_value
        return field.like(f"%{lowered_value}%")

    column = func.coalesce(field, "")
    if match_mode == TextMatchMode.EXACT:
        if fuzzy:
            normalized_value = normalize_search_term(search_value).lower()
            return func.lower(normalize_field_sql(column)) == normalized_value
        return func.lower(column) == search_value.lower()

    pattern = f"%{search_value}%"
    if fuzzy:
        return normalize_field_sql(column).ilike(pattern)
    return column.ilike(pattern)


def classify_cas_search(search_value: str, *, fuzzy: bool) -> tuple[CASSearchMode, str]:
    """Classify CAS query into exact/prefix/contains and return normalized term."""
    term = search_value.strip()
    if not term:
        return CASSearchMode.CONTAINS, term

    if fuzzy:
        return CASSearchMode.CONTAINS, normalize_search_term(term)

    normalized = normalize_cas(term)
    is_valid, _ = validate_cas_format(normalized)
    if is_valid:
        return CASSearchMode.EXACT, normalized

    prefix_candidate = term.replace(" ", "")
    if CAS_PREFIX_PATTERN.fullmatch(prefix_candidate):
        return CASSearchMode.PREFIX, prefix_candidate

    return CASSearchMode.CONTAINS, term


def build_cas_search_clause(
    field,
    search_value: str,
    *,
    fuzzy: bool,
    match_mode: TextMatchMode = TextMatchMode.CONTAINS,
):
    """Build CAS-aware clause: exact(=) / prefix(LIKE xxx%) / contains(ILIKE)."""
    if match_mode == TextMatchMode.EXACT:
        term = search_value.strip()
        if not term:
            return func.coalesce(field, "").ilike("%%")
        if fuzzy:
            normalized_term = normalize_search_term(term)
            return normalize_field_sql(func.coalesce(field, "")) == normalized_term
        return field == normalize_cas(term)

    mode, term = classify_cas_search(search_value, fuzzy=fuzzy)
    if not term:
        return func.coalesce(field, "").ilike("%%")

    if mode == CASSearchMode.EXACT:
        return field == term

    if mode == CASSearchMode.PREFIX:
        # 前缀 LIKE 可命中标准化 CAS 列上的 B-Tree 索引。
        return field.like(f"{term}%")

    return build_text_search_clause(field, term, fuzzy=fuzzy, match_mode=match_mode)


def normalize_date_search_term(search_value: str) -> str:
    """Normalize date-like search input by removing non-digits.

    Examples:
    - ``2026-03-23`` -> ``20260323``
    - ``2026/03`` -> ``202603``
    - ``2026-03-23 14:20`` -> ``20260323`` (ignore time part)
    """
    term = search_value.strip()
    if not term:
        return ""

    digits = DATE_DIGITS_PATTERN.sub("", term)
    if not digits:
        return ""

    # 忽略时分秒，最多取 yyyyMMdd。
    if len(digits) >= 8:
        return digits[:8]
    return digits


def build_date_search_clause(field, search_value: str):
    """Build date-only search clause on datetime field.

    Uses range query so SQLite can utilize created_at indexes:
    - YYYY      -> [YYYY-01-01, YYYY+1-01-01)
    - YYYYMM    -> [YYYY-MM-01, next month)
    - YYYYMMDD  -> [YYYY-MM-DD, next day)
    """
    normalized = normalize_date_search_term(search_value)
    if len(normalized) < 4:
        return sql_false()

    try:
        if len(normalized) == 4:
            year = int(normalized)
            start = datetime(year, 1, 1)
            end = datetime(year + 1, 1, 1)
        elif len(normalized) == 6:
            year = int(normalized[:4])
            month = int(normalized[4:6])
            start = datetime(year, month, 1)
            if month == 12:
                end = datetime(year + 1, 1, 1)
            else:
                end = datetime(year, month + 1, 1)
        else:
            year = int(normalized[:4])
            month = int(normalized[4:6])
            day = int(normalized[6:8])
            start = datetime(year, month, day)
            end = start + timedelta(days=1)
    except ValueError:
        return sql_false()

    return (field >= start) & (field < end)


def _quote_fts_phrase(term: str) -> str:
    escaped = term.replace('"', '""')
    return f'"{escaped}"'


def should_use_trigram_fts(search_value: str, *, fuzzy: bool) -> bool:
    """Whether the term should use SQLite trigram FTS.

    Rules:
    - Fuzzy mode keeps existing LIKE-normalization behavior.
    - Require at least 3 chars for trigram tokenizer effectiveness.
    - ASCII terms still require simple safe characters.
    - Non-ASCII terms (e.g. Chinese) are allowed for direct FTS matching.
    """
    if fuzzy:
        return False

    term = search_value.strip()
    if len(term) < TRIGRAM_FTS_MIN_LEN:
        return False

    if not term.isascii():
        return True

    allowed = {" ", "_", "-", "."}
    return all((ch.isascii() and (ch.isalnum() or ch in allowed)) for ch in term)


def build_applicant_id_subquery(
    search_value: str,
    *,
    fuzzy: bool,
    match_mode: TextMatchMode = TextMatchMode.CONTAINS,
):
    """Build unified applicant-id subquery for order pages.

    Priority:
    1) exact match on username/full_name/pinyin/initials.
    2) trigram FTS for >=3-char terms (ASCII + Chinese).
    3) fallback LIKE for short terms.
    """
    from app.models.user import User

    raw_term = search_value.strip()
    if not raw_term:
        return select(User.id).where(sql_false())

    if match_mode == TextMatchMode.EXACT:
        return select(User.id).where(
            combine_or_clauses([
                build_text_search_clause(
                    User.username,
                    raw_term,
                    fuzzy=fuzzy,
                    match_mode=TextMatchMode.EXACT,
                ),
                build_text_search_clause(
                    User.full_name,
                    raw_term,
                    fuzzy=fuzzy,
                    match_mode=TextMatchMode.EXACT,
                ),
                build_text_search_clause(
                    User.full_name_pinyin,
                    raw_term,
                    fuzzy=fuzzy,
                    match_mode=TextMatchMode.EXACT,
                ),
                build_text_search_clause(
                    User.full_name_pinyin_initials,
                    raw_term,
                    fuzzy=fuzzy,
                    match_mode=TextMatchMode.EXACT,
                ),
            ])
        )

    if fuzzy:
        term = normalize_search_term(raw_term)
        return select(User.id).where(
            combine_or_clauses([
                build_text_search_clause(User.full_name, term, fuzzy=True),
                build_text_search_clause(User.full_name_pinyin, term, fuzzy=True),
                build_text_search_clause(User.full_name_pinyin_initials, term, fuzzy=True),
            ])
        )

    pinyin_term = raw_term.lower()
    exact_match_clause = combine_or_clauses([
        User.username == raw_term,
        User.full_name == raw_term,
        User.full_name_pinyin == pinyin_term,
        User.full_name_pinyin_initials == pinyin_term,
    ])
    exact_subquery = select(User.id).where(exact_match_clause)

    if should_use_trigram_fts(raw_term, fuzzy=False):
        phrase = _quote_fts_phrase(raw_term)
        match_query = " OR ".join([
            f"full_name:{phrase}",
            f"full_name_pinyin:{phrase}",
            f"full_name_pinyin_initials:{phrase}",
        ])
        match_expr = text("users_fts MATCH :users_match_query").bindparams(
            bindparam("users_match_query", match_query)
        )
        fts_subquery = select(text("rowid")).select_from(text("users_fts")).where(match_expr)
        return exact_subquery.union(fts_subquery)

    return select(User.id).where(
        combine_or_clauses([
            exact_match_clause,
            build_text_search_clause(User.full_name, raw_term, fuzzy=False),
            build_text_search_clause(User.full_name_pinyin, raw_term, fuzzy=False),
            build_text_search_clause(User.full_name_pinyin_initials, raw_term, fuzzy=False),
        ])
    )
