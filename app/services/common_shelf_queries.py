"""CommonShelf grouping/search helpers."""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_
from sqlmodel import Session, select

from app.core.db_compat import exec_delete_returning_first, exec_delete_returning_all
from app.core.time_utils import get_utc_now
from app.models.chemical_name_map import ChemicalNameMap
from app.models.common_shelf import (
    CommonShelf,
    CommonShelfGroupDisplay,
    CommonShelfGroupIdentity,
    CommonShelfGroupListResponse,
    CommonShelfGroupResponse,
    CommonShelfLocationSummaryResponse,
)
from app.services.cas_utils import normalize_cas
from app.services.chemical_name_map_fts import (
    ChemicalNameMapFTSError,
    apply_chemical_name_map_fts_filter,
    should_use_chemical_name_map_fts,
)
from app.services.common_shelf_creation import (
    normalize_storage_for_group,
)
from app.services.search_matchers import (
    TextMatchMode,
    build_cas_search_clause,
    build_text_search_clause,
    combine_or_clauses,
)
from app.services.sql_utils import normalize_search_term


COMMON_SHELF_NOT_FOUND = "CommonShelf group not found"

CHEMICAL_NAME_MAP_SQL_FIELD_MAP = {
    "name": [
        ChemicalNameMap.name,
        ChemicalNameMap.english_name,
        ChemicalNameMap.name_pinyin,
        ChemicalNameMap.name_initials,
    ],
    "alias": [
        ChemicalNameMap.alias_1,
        ChemicalNameMap.alias_2,
        ChemicalNameMap.alias_3,
        ChemicalNameMap.alias_1_pinyin,
        ChemicalNameMap.alias_1_initials,
        ChemicalNameMap.alias_2_pinyin,
        ChemicalNameMap.alias_2_initials,
        ChemicalNameMap.alias_3_pinyin,
        ChemicalNameMap.alias_3_initials,
    ],
    "cas_number": [ChemicalNameMap.cas_number],
}

CHEMICAL_NAME_MAP_FTS_FIELD_MAP = {
    "name": ["name", "english_name", "name_pinyin", "name_initials"],
    "alias": [
        "alias_1",
        "alias_2",
        "alias_3",
        "alias_1_pinyin",
        "alias_1_initials",
        "alias_2_pinyin",
        "alias_2_initials",
        "alias_3_pinyin",
        "alias_3_initials",
    ],
    "cas_number": ["cas_number"],
}


@dataclass(frozen=True)
class CommonShelfGroupFields:
    cas_number: str
    brand_normalized: str
    specification_normalized: str


@dataclass(frozen=True)
class CommonShelfGroupListOptions:
    search: Optional[str]
    search_field: Optional[str]
    fuzzy: bool
    match_mode: TextMatchMode
    skip: int
    limit: int
    sort_by: Optional[str]
    sort_order: Optional[str]


def _join_unique_texts(values: list[Optional[str]]) -> Optional[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = (value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return "; ".join(ordered) if ordered else None


def _collect_group_display_texts(
    db: Session,
    *,
    filtered_subquery,
    page_rows_subquery,
) -> dict[str, dict[str, Optional[str]]]:
    items = db.exec(
        select(
            filtered_subquery.c.cas_number,
            filtered_subquery.c.brand_normalized,
            filtered_subquery.c.specification_normalized,
            filtered_subquery.c.purity,
            filtered_subquery.c.notes,
            filtered_subquery.c.created_at,
            filtered_subquery.c.id,
        )
        .select_from(filtered_subquery)
        .join(
            page_rows_subquery,
            and_(
                filtered_subquery.c.cas_number == page_rows_subquery.c.cas_number,
                filtered_subquery.c.brand_normalized == page_rows_subquery.c.brand_normalized,
                filtered_subquery.c.specification_normalized == page_rows_subquery.c.specification_normalized,
            ),
        )
        .order_by(filtered_subquery.c.created_at.asc(), filtered_subquery.c.id.asc())
    ).all()

    grouped: dict[str, dict[str, list[Optional[str]]]] = {}
    for item in items:
        group_key = build_group_key(
            cas_number=item.cas_number,
            brand_normalized=item.brand_normalized,
            specification_normalized=item.specification_normalized,
        )
        current = grouped.setdefault(group_key, {"purity": [], "notes": []})
        current["purity"].append(item.purity)
        current["notes"].append(item.notes)

    return {
        group_key: {
            "purity": _join_unique_texts(values["purity"]),
            "notes": _join_unique_texts(values["notes"]),
        }
        for group_key, values in grouped.items()
    }


def build_group_key(*, cas_number: str, brand_normalized: str, specification_normalized: str) -> str:
    payload = {"c": cas_number, "b": brand_normalized, "s": specification_normalized}
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def parse_group_key(group_key: str) -> CommonShelfGroupFields:
    try:
        padding = "=" * ((4 - len(group_key) % 4) % 4)
        raw = base64.urlsafe_b64decode(f"{group_key}{padding}").decode("utf-8")
        payload = json.loads(raw)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid group_key") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid group_key")

    cas_number = normalize_cas(str(payload.get("c") or ""))
    brand_normalized = str(payload.get("b") or "")
    specification_normalized = str(payload.get("s") or "")
    if not cas_number or specification_normalized == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid group_key")

    return CommonShelfGroupFields(
        cas_number=cas_number,
        brand_normalized=brand_normalized,
        specification_normalized=specification_normalized,
    )


def get_group_identity_from_item(item: CommonShelf) -> CommonShelfGroupIdentity:
    return CommonShelfGroupIdentity(
        group_key=build_group_key(
            cas_number=item.cas_number,
            brand_normalized=item.brand_normalized,
            specification_normalized=item.specification_normalized,
        ),
        cas_number=item.cas_number,
        brand=item.brand,
        brand_normalized=item.brand_normalized,
        specification_text=item.specification_text,
        specification_normalized=item.specification_normalized,
    )


def get_group_items(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
) -> list[CommonShelf]:
    return db.exec(
        select(CommonShelf)
        .where(CommonShelf.cas_number == group_fields.cas_number)
        .where(CommonShelf.brand_normalized == group_fields.brand_normalized)
        .where(CommonShelf.specification_normalized == group_fields.specification_normalized)
        .order_by(CommonShelf.created_at.asc(), CommonShelf.id.asc())
    ).all()


def get_latest_group_item(db: Session, *, group_fields: CommonShelfGroupFields) -> CommonShelf:
    item = db.exec(
        select(CommonShelf)
        .where(CommonShelf.cas_number == group_fields.cas_number)
        .where(CommonShelf.brand_normalized == group_fields.brand_normalized)
        .where(CommonShelf.specification_normalized == group_fields.specification_normalized)
        .order_by(CommonShelf.created_at.desc(), CommonShelf.id.desc())
    ).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=COMMON_SHELF_NOT_FOUND)
    return item


def get_latest_group_item_from_key(db: Session, group_key: str) -> CommonShelf:
    return get_latest_group_item(db, group_fields=parse_group_key(group_key))


def get_group_name_map(db: Session, *, cas_number: str) -> Optional[ChemicalNameMap]:
    return db.exec(select(ChemicalNameMap).where(ChemicalNameMap.cas_number == cas_number)).first()


def locate_merge_target(
    db: Session,
    *,
    current_group_fields: CommonShelfGroupFields,
    target_group_fields: CommonShelfGroupFields,
) -> Optional[CommonShelf]:
    if current_group_fields == target_group_fields:
        return None

    return db.exec(
        select(CommonShelf)
        .where(CommonShelf.cas_number == target_group_fields.cas_number)
        .where(CommonShelf.brand_normalized == target_group_fields.brand_normalized)
        .where(CommonShelf.specification_normalized == target_group_fields.specification_normalized)
        .order_by(CommonShelf.created_at.desc(), CommonShelf.id.desc())
    ).first()


def list_group_locations(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
) -> list[CommonShelfLocationSummaryResponse]:
    items = get_group_items(db, group_fields=group_fields)
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=COMMON_SHELF_NOT_FOUND)

    grouped: dict[str, dict[str, object]] = {}
    for item in items:
        location_key = item.storage_location_normalized or ""
        current = grouped.get(location_key)
        created_at = item.created_at or get_utc_now()
        if current is None:
            grouped[location_key] = {
                "storage_location": item.storage_location,
                "bottle_count": 1,
                "oldest_created_at": created_at,
            }
            continue

        current["bottle_count"] = int(current["bottle_count"]) + 1
        if created_at < current["oldest_created_at"]:
            current["oldest_created_at"] = created_at
        if current["storage_location"] in {None, ""} and item.storage_location:
            current["storage_location"] = item.storage_location

    rows = [
        CommonShelfLocationSummaryResponse(
            storage_location=data["storage_location"],
            bottle_count=int(data["bottle_count"]),
            oldest_created_at=data["oldest_created_at"],
        )
        for data in grouped.values()
    ]
    rows.sort(
        key=lambda row: (
            -(row.bottle_count or 0),
            row.storage_location or "",
            row.oldest_created_at,
        )
    )
    return rows


def list_group_location_suggestions(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
) -> list[str]:
    locations = list_group_locations(db, group_fields=group_fields)
    return [location.storage_location for location in locations if location.storage_location]


def list_group_item_details(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
) -> list[CommonShelf]:
    """Return stable bottle rows for per-item edit mode."""
    return get_group_items(db, group_fields=group_fields)


def list_location_suggestions_by_identity(
    db: Session,
    *,
    cas_number: str,
    brand_normalized: str,
    specification_normalized: str,
) -> list[str]:
    """Return existing location suggestions for an already-normalized group identity."""
    rows = db.exec(
        select(
            CommonShelf.storage_location,
            func.count(CommonShelf.id).label("bottle_count"),
            func.min(CommonShelf.created_at).label("oldest_created_at"),
        )
        .where(CommonShelf.cas_number == cas_number)
        .where(CommonShelf.brand_normalized == brand_normalized)
        .where(CommonShelf.specification_normalized == specification_normalized)
        .where(CommonShelf.storage_location.is_not(None))
        .group_by(CommonShelf.storage_location)
        .order_by(func.count(CommonShelf.id).desc(), func.min(CommonShelf.created_at).asc())
    ).all()
    return [row.storage_location for row in rows if row.storage_location]


def remove_earliest_item_in_location(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
    storage_location: Optional[str],
) -> CommonShelf:
    normalized_location = normalize_storage_for_group(storage_location)
    filters = [
        CommonShelf.cas_number == group_fields.cas_number,
        CommonShelf.brand_normalized == group_fields.brand_normalized,
        CommonShelf.specification_normalized == group_fields.specification_normalized,
    ]
    if normalized_location is None:
        filters.append(CommonShelf.storage_location_normalized.is_(None))
    else:
        filters.append(CommonShelf.storage_location_normalized == normalized_location)

    candidate_id_subquery = (
        select(CommonShelf.id)
        .where(and_(*filters))
        .order_by(CommonShelf.created_at.asc(), CommonShelf.id.asc())
        .limit(1)
        .scalar_subquery()
    )
    delete_stmt = (
        delete(CommonShelf)
        .where(CommonShelf.id == candidate_id_subquery)
    )
    deleted_item = exec_delete_returning_first(db, delete_stmt, CommonShelf)
    if deleted_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No bottle found at selected location")
    return deleted_item


def delete_group_items_returning(
    db: Session,
    *,
    group_fields: CommonShelfGroupFields,
) -> list[CommonShelf]:
    delete_stmt = (
        delete(CommonShelf)
        .where(CommonShelf.cas_number == group_fields.cas_number)
        .where(CommonShelf.brand_normalized == group_fields.brand_normalized)
        .where(CommonShelf.specification_normalized == group_fields.specification_normalized)
    )
    return exec_delete_returning_all(db, delete_stmt, CommonShelf)


def _apply_chemical_name_like_filter(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    if search_field == "cas_number":
        return base.where(
            build_cas_search_clause(
                ChemicalNameMap.cas_number,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )

    if search_field and search_field != "all" and search_field in CHEMICAL_NAME_MAP_SQL_FIELD_MAP:
        return base.where(
            combine_or_clauses(
                build_text_search_clause(
                    field,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
                for field in CHEMICAL_NAME_MAP_SQL_FIELD_MAP[search_field]
            )
        )

    clauses = [
        build_cas_search_clause(
            ChemicalNameMap.cas_number,
            search_value,
            fuzzy=fuzzy,
            match_mode=match_mode,
        )
    ]
    for field in (
        ChemicalNameMap.name,
        ChemicalNameMap.english_name,
        ChemicalNameMap.alias_1,
        ChemicalNameMap.alias_2,
        ChemicalNameMap.alias_3,
        ChemicalNameMap.name_pinyin,
        ChemicalNameMap.name_initials,
        ChemicalNameMap.alias_1_pinyin,
        ChemicalNameMap.alias_1_initials,
        ChemicalNameMap.alias_2_pinyin,
        ChemicalNameMap.alias_2_initials,
        ChemicalNameMap.alias_3_pinyin,
        ChemicalNameMap.alias_3_initials,
    ):
        clauses.append(
            build_text_search_clause(
                field,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )
    return base.where(combine_or_clauses(clauses))


def search_name_map_cas_numbers(
    db: Session,
    *,
    search: str,
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode = TextMatchMode.CONTAINS,
) -> set[str]:
    search_value = normalize_search_term(search) if fuzzy else search.strip()
    if not search_value:
        return set()

    base = select(ChemicalNameMap)
    use_fts = (
        match_mode == TextMatchMode.CONTAINS
        and search_field != "cas_number"
        and should_use_chemical_name_map_fts(search_value)
    )
    if use_fts:
        try:
            base = apply_chemical_name_map_fts_filter(
                base,
                search_value=search_value,
                search_field=search_field,
                field_map=CHEMICAL_NAME_MAP_FTS_FIELD_MAP,
            )
        except ChemicalNameMapFTSError:
            base = _apply_chemical_name_like_filter(
                base,
                search_value=search_value,
                search_field=search_field,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
    else:
        base = _apply_chemical_name_like_filter(
            base,
            search_value=search_value,
            search_field=search_field,
            fuzzy=fuzzy,
            match_mode=match_mode,
        )

    rows = db.exec(base).all()
    return {row.cas_number for row in rows if row.cas_number}


def _filter_common_shelf_query(
    base,
    *,
    db: Session,
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    if not search:
        return base

    search_value = normalize_search_term(search) if fuzzy else search.strip()
    if not search_value:
        return base

    if search_field == "cas_number":
        return base.where(
            build_cas_search_clause(
                CommonShelf.cas_number,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )

    if search_field == "brand":
        return base.where(
            or_(
                build_text_search_clause(
                    CommonShelf.brand,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                ),
                build_text_search_clause(
                    CommonShelf.brand_normalized,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                ),
            )
        )

    matched_cas_numbers = search_name_map_cas_numbers(
        db,
        search=search_value,
        search_field=search_field if search_field in {"name", "alias", "cas_number"} else None,
        fuzzy=fuzzy,
        match_mode=match_mode,
    )

    if search_field in {"name", "alias"}:
        cas_clause = (
            CommonShelf.id == -1
            if not matched_cas_numbers
            else CommonShelf.cas_number.in_(matched_cas_numbers)
        )
        return base.where(cas_clause)

    direct_clauses = [
        build_cas_search_clause(
            CommonShelf.cas_number,
            search_value,
            fuzzy=fuzzy,
            match_mode=match_mode,
        ),
        build_text_search_clause(
            CommonShelf.brand,
            search_value,
            fuzzy=fuzzy,
            match_mode=match_mode,
        ),
        build_text_search_clause(
            CommonShelf.brand_normalized,
            search_value,
            fuzzy=fuzzy,
            match_mode=match_mode,
        ),
    ]
    if matched_cas_numbers:
        direct_clauses.append(CommonShelf.cas_number.in_(matched_cas_numbers))
    return base.where(combine_or_clauses(direct_clauses))


def _build_group_order_expressions(
    *,
    sort_by: Optional[str],
    sort_order: Optional[str],
    grouped_subquery,
    latest_subquery,
):
    reverse = sort_order != "asc"
    sort_expr_map = {
        "cas_number": grouped_subquery.c.cas_number,
        "name": func.coalesce(ChemicalNameMap.name, latest_subquery.c.name_snapshot),
        "category": func.coalesce(ChemicalNameMap.category, ""),
        "brand": func.coalesce(latest_subquery.c.brand, ""),
        "specification": func.coalesce(latest_subquery.c.specification_text, ""),
        "bottle_count": grouped_subquery.c.bottle_count,
        "location_count": grouped_subquery.c.location_count,
        "created_at": grouped_subquery.c.created_at,
        "updated_at": grouped_subquery.c.updated_at,
    }
    sort_expr = sort_expr_map.get(sort_by or "", sort_expr_map["updated_at"])
    if reverse:
        return [sort_expr.desc(), grouped_subquery.c.updated_at.desc(), grouped_subquery.c.cas_number.asc()]
    return [sort_expr.asc(), grouped_subquery.c.updated_at.desc(), grouped_subquery.c.cas_number.asc()]


def list_grouped_common_shelf(
    db: Session,
    *,
    options: CommonShelfGroupListOptions,
) -> CommonShelfGroupListResponse:
    filtered_base = _filter_common_shelf_query(
        select(CommonShelf),
        db=db,
        search=options.search,
        search_field=options.search_field,
        fuzzy=options.fuzzy,
        match_mode=options.match_mode,
    )
    filtered_subquery = filtered_base.subquery("filtered_common_shelf")

    grouped_subquery = (
        select(
            filtered_subquery.c.cas_number.label("cas_number"),
            filtered_subquery.c.brand_normalized.label("brand_normalized"),
            filtered_subquery.c.specification_normalized.label("specification_normalized"),
            func.count(filtered_subquery.c.id).label("bottle_count"),
            func.count(func.distinct(func.coalesce(filtered_subquery.c.storage_location_normalized, ""))).label(
                "location_count"
            ),
            func.min(filtered_subquery.c.created_at).label("created_at"),
            func.max(filtered_subquery.c.updated_at).label("updated_at"),
        )
        .group_by(
            filtered_subquery.c.cas_number,
            filtered_subquery.c.brand_normalized,
            filtered_subquery.c.specification_normalized,
        )
        .subquery("grouped_common_shelf")
    )

    # Keep window ranking constrained to the filtered subset to avoid full-table scans.
    latest_ranked_subquery = (
        select(
            filtered_subquery.c.cas_number.label("cas_number"),
            filtered_subquery.c.brand_normalized.label("brand_normalized"),
            filtered_subquery.c.specification_normalized.label("specification_normalized"),
            filtered_subquery.c.brand.label("brand"),
            filtered_subquery.c.specification_text.label("specification_text"),
            filtered_subquery.c.name_snapshot.label("name_snapshot"),
            filtered_subquery.c.id.label("id"),
            func.row_number()
            .over(
                partition_by=(
                    filtered_subquery.c.cas_number,
                    filtered_subquery.c.brand_normalized,
                    filtered_subquery.c.specification_normalized,
                ),
                order_by=(filtered_subquery.c.created_at.desc(), filtered_subquery.c.id.desc()),
            )
            .label("rn"),
        )
        .subquery("latest_group_ranked")
    )
    latest_group_subquery = (
        select(
            latest_ranked_subquery.c.cas_number,
            latest_ranked_subquery.c.brand_normalized,
            latest_ranked_subquery.c.specification_normalized,
            latest_ranked_subquery.c.brand,
            latest_ranked_subquery.c.specification_text,
            latest_ranked_subquery.c.name_snapshot,
        )
        .where(latest_ranked_subquery.c.rn == 1)
        .subquery("latest_group_item")
    )

    total = int(
        db.exec(
            select(func.count()).select_from(grouped_subquery)
        ).one()
        or 0
    )
    if total == 0:
        return CommonShelfGroupListResponse(
            data=[],
            current=0,
            total=0,
            skip=options.skip,
            limit=options.limit,
        )

    page_query = (
        select(
            grouped_subquery.c.cas_number,
            grouped_subquery.c.brand_normalized,
            grouped_subquery.c.specification_normalized,
            grouped_subquery.c.bottle_count,
            grouped_subquery.c.location_count,
            grouped_subquery.c.created_at,
            grouped_subquery.c.updated_at,
            latest_group_subquery.c.brand,
            latest_group_subquery.c.specification_text,
            latest_group_subquery.c.name_snapshot,
            ChemicalNameMap.name.label("map_name"),
            ChemicalNameMap.english_name.label("map_english_name"),
            ChemicalNameMap.category.label("map_category"),
        )
        .select_from(grouped_subquery)
        .join(
            latest_group_subquery,
            and_(
                latest_group_subquery.c.cas_number == grouped_subquery.c.cas_number,
                latest_group_subquery.c.brand_normalized == grouped_subquery.c.brand_normalized,
                latest_group_subquery.c.specification_normalized == grouped_subquery.c.specification_normalized,
            ),
        )
        .join(ChemicalNameMap, ChemicalNameMap.cas_number == grouped_subquery.c.cas_number, isouter=True)
    )
    page_query = page_query.order_by(
        *_build_group_order_expressions(
            sort_by=options.sort_by,
            sort_order=options.sort_order,
            grouped_subquery=grouped_subquery,
            latest_subquery=latest_group_subquery,
        )
    )
    if options.skip > 0:
        page_query = page_query.offset(options.skip)
    if options.limit > 0:
        page_query = page_query.limit(options.limit)

    page_rows_subquery = page_query.subquery("page_group_rows")
    rows = db.exec(page_query).all()
    group_display_texts = _collect_group_display_texts(
        db,
        filtered_subquery=filtered_subquery,
        page_rows_subquery=page_rows_subquery,
    )
    data: list[CommonShelfGroupResponse] = []
    for row in rows:
        group_key = build_group_key(
            cas_number=row.cas_number,
            brand_normalized=row.brand_normalized,
            specification_normalized=row.specification_normalized,
        )
        display_texts = group_display_texts.get(group_key, {})
        data.append(
            CommonShelfGroupResponse(
                group=CommonShelfGroupIdentity(
                    group_key=group_key,
                    cas_number=row.cas_number,
                    brand=row.brand,
                    brand_normalized=row.brand_normalized,
                    specification_text=row.specification_text,
                    specification_normalized=row.specification_normalized,
                ),
                display=CommonShelfGroupDisplay(
                    name=row.map_name or row.name_snapshot,
                    english_name=row.map_english_name,
                    category=row.map_category,
                    purity=display_texts.get("purity"),
                    notes=display_texts.get("notes"),
                ),
                bottle_count=int(row.bottle_count or 0),
                location_count=int(row.location_count or 0),
                latest_name_snapshot=row.name_snapshot,
                created_at=row.created_at or get_utc_now(),
                updated_at=row.updated_at or row.created_at or get_utc_now(),
            )
        )
    return CommonShelfGroupListResponse(
        data=data,
        current=len(data),
        total=total,
        skip=options.skip,
        limit=options.limit,
    )
