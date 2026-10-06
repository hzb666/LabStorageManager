from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case
from sqlmodel import Session, func, select

from app.core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.models.inventory import Inventory, InventoryResponse, InventoryStatus
from app.models.user import User
from app.read_only.auth import get_current_user
from app.read_only.database import get_snapshot_db
from app.services.api_utils import normalize_pagination, serialize_inventory_items
from app.services.cas_utils import normalize_cas
from app.services.search_matchers import (
    TextMatchMode,
    build_cas_search_clause,
    build_chunked_in_clause,
    build_text_search_clause,
    combine_and_clauses,
    combine_or_clauses,
    split_exact_cas_search_terms,
    split_segmented_search_terms,
)
from app.services.spec_utils import format_specification
from app.services.sql_utils import normalize_search_term, order_with_nulls_last
from app.services.user_utils import batch_get_user_names
from app.services.xlsx_export import export_inventory_xlsx

router = APIRouter(prefix="/inventory", tags=["Read-only inventory"])

SEARCH_FIELDS = {
    "name": (Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials),
    "cas_number": (Inventory.cas_number,),
    "storage_location": (
        Inventory.storage_location,
        Inventory.storage_location_pinyin,
        Inventory.storage_location_pinyin_initials,
    ),
    "brand": (Inventory.brand, Inventory.brand_pinyin, Inventory.brand_pinyin_initials),
}
VALID_SEARCH_FIELDS = {"all", *SEARCH_FIELDS}
VALID_SORT_FIELDS = {
    "cas_number", "name", "category", "storage_location", "brand",
    "remaining_quantity", "remaining_percent", "initial_quantity", "status", "created_at",
}


class InventoryListQuery(BaseModel):
    skip: int = 0
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    status_filter: InventoryStatus | None = None
    cas_filter: str | None = None
    hazardous_only: bool = False
    search: str | None = Query(default=None, max_length=20_000)
    search_field: str | None = None
    fuzzy: bool = False
    match_mode: TextMatchMode = TextMatchMode.CONTAINS
    sort_by: str | None = None
    sort_order: str | None = "desc"
    structure_search_id: str | None = None
    structure_match_mode: str | None = None
    structure_query: str | None = None
    structure_query_format: str | None = None
    structure_only_in_stock: bool = False


def _selected_field_groups(search_field: str | None):
    if search_field and search_field != "all":
        return (SEARCH_FIELDS[search_field],)
    return tuple(SEARCH_FIELDS.values())


def _text_clause(field, value: str, *, fuzzy: bool, match_mode: TextMatchMode):
    if field is Inventory.cas_number:
        return build_cas_search_clause(
            field,
            value,
            fuzzy=fuzzy,
            match_mode=match_mode,
        )
    return build_text_search_clause(field, value, fuzzy=fuzzy, match_mode=match_mode)


def _apply_search(statement, query: InventoryListQuery):
    raw_search = (query.search or "").strip()
    if not raw_search:
        return statement
    multi_cas = split_exact_cas_search_terms(raw_search)
    if multi_cas and query.search_field in {None, "all", "cas_number"}:
        return statement.where(build_chunked_in_clause(Inventory.cas_number, multi_cas))

    search_value = normalize_search_term(raw_search) if query.fuzzy else raw_search
    terms = split_segmented_search_terms(raw_search, match_mode=query.match_mode)
    groups = _selected_field_groups(query.search_field)
    if terms:
        group_clauses = []
        for fields in groups:
            group_clauses.append(combine_and_clauses(
                combine_or_clauses(
                    _text_clause(field, term, fuzzy=query.fuzzy, match_mode=query.match_mode)
                    for field in fields
                )
                for term in terms
            ))
        return statement.where(combine_or_clauses(group_clauses))

    clauses = [
        _text_clause(field, search_value, fuzzy=query.fuzzy, match_mode=query.match_mode)
        for fields in groups
        for field in fields
    ]
    return statement.where(combine_or_clauses(clauses))


def _apply_filters(statement, query: InventoryListQuery):
    if (
        query.structure_search_id
        or query.structure_query
        or query.structure_match_mode
        or query.structure_query_format
        or query.structure_only_in_stock
    ):
        raise HTTPException(status_code=503, detail="维护期间不提供结构检索")
    if query.search_field and query.search_field not in VALID_SEARCH_FIELDS:
        raise HTTPException(status_code=400, detail="Invalid search field")
    if query.sort_by and query.sort_by not in VALID_SORT_FIELDS:
        raise HTTPException(status_code=400, detail="Invalid sort field")
    if query.status_filter:
        statement = statement.where(Inventory.status == query.status_filter)
    if query.cas_filter:
        statement = statement.where(Inventory.cas_number == normalize_cas(query.cas_filter))
    if query.hazardous_only:
        statement = statement.where(Inventory.is_hazardous.is_(True))
    return _apply_search(statement, query)


def _order_by(query: InventoryListQuery):
    computed_percent = Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    fields = {
        "cas_number": Inventory.cas_number,
        "name": Inventory.name_pinyin,
        "category": Inventory.category_pinyin,
        "storage_location": Inventory.storage_location_pinyin,
        "brand": Inventory.brand_pinyin,
        "remaining_quantity": Inventory.remaining_quantity,
        "remaining_percent": func.coalesce(Inventory.remaining_percent, computed_percent),
        "initial_quantity": Inventory.initial_quantity,
        "status": Inventory.status,
        "created_at": Inventory.created_at,
    }
    direction = (query.sort_order or "desc").lower()
    field = fields.get(query.sort_by or "created_at", Inventory.created_at)
    if query.sort_by == "cas_number":
        prefix = case((Inventory.cas_number.op("GLOB")("[0-9]*"), 0), else_=1)
        ordered = (prefix.asc(), *order_with_nulls_last(field, direction))
    else:
        ordered = order_with_nulls_last(field, direction)
    if query.sort_by != "created_at":
        return (*ordered, Inventory.created_at.desc(), Inventory.id.desc())
    return (*ordered, Inventory.id.desc())


@router.get("/")
def list_inventory(
    query: Annotated[InventoryListQuery, Depends()],
    _current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    skip, limit = normalize_pagination(query.skip, query.limit)
    filtered = _apply_filters(select(Inventory), query)
    total = db.exec(select(func.count()).select_from(filtered.subquery())).one()
    items = (
        list(db.exec(filtered.order_by(*_order_by(query)).offset(skip).limit(limit)).all())
        if limit
        else []
    )
    return {
        "data": serialize_inventory_items(db, items),
        "total": total,
        "skip": skip,
        "limit": limit,
    }


def _serialize_one(db: Session, item: Inventory) -> dict:
    return serialize_inventory_items(db, [item])[0]


@router.get("/export")
def export_inventory(
    _current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    items = list(db.exec(select(Inventory).order_by(Inventory.created_at.desc())).all())
    keeper_ids = {item.temporary_keeper_id for item in items if item.temporary_keeper_id}
    return export_inventory_xlsx(items, temporary_keeper_names=batch_get_user_names(db, keeper_ids))


@router.get("/code/{internal_code}", response_model=InventoryResponse)
def get_inventory_by_code(
    internal_code: str,
    _current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    item = db.exec(
        select(Inventory).where(Inventory.internal_code == internal_code.strip())
    ).first()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    return _serialize_one(db, item)


@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(
    inventory_id: int,
    _current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    item = db.get(Inventory, inventory_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    return _serialize_one(db, item)
