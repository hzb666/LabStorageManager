"""Chemical name map APIs for CommonShelf."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import select

from app.core.auth import get_current_user
from app.core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.database import DBSession
from app.models.chemical_name_map import (
    ChemicalNameMap,
    ChemicalNameMapCreate,
    ChemicalNameMapResponse,
    ChemicalNameMapUpdate,
)
from app.models.common_shelf import CommonShelf
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.common_shelf_queries import search_name_map_cas_numbers
from app.services.pinyin_utils import to_pinyin_parts

router = APIRouter(prefix="/chemical-name-map", tags=["Chemical Name Map"])


def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _validate_cas_number(raw_cas_number: str) -> str:
    cas_number = normalize_cas(raw_cas_number)
    is_valid, error_message = validate_cas_format(cas_number)
    if not cas_number or not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid CAS number: {error_message}",
        )
    return cas_number


def _apply_name_map_payload(
    target: ChemicalNameMap,
    *,
    name: Optional[str] = None,
    english_name: Optional[str] = None,
    alias_1: Optional[str] = None,
    alias_2: Optional[str] = None,
    alias_3: Optional[str] = None,
) -> None:
    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
        target.name = normalized_name

    if english_name is not None:
        target.english_name = _normalize_optional_text(english_name)
    if alias_1 is not None:
        target.alias_1 = _normalize_optional_text(alias_1)
    if alias_2 is not None:
        target.alias_2 = _normalize_optional_text(alias_2)
    if alias_3 is not None:
        target.alias_3 = _normalize_optional_text(alias_3)

    name_pinyin, name_initials = to_pinyin_parts(target.name)
    alias_1_pinyin, alias_1_initials = to_pinyin_parts(target.alias_1)
    alias_2_pinyin, alias_2_initials = to_pinyin_parts(target.alias_2)
    alias_3_pinyin, alias_3_initials = to_pinyin_parts(target.alias_3)

    target.name_pinyin = name_pinyin or None
    target.name_initials = name_initials or None
    target.alias_1_pinyin = alias_1_pinyin or None
    target.alias_1_initials = alias_1_initials or None
    target.alias_2_pinyin = alias_2_pinyin or None
    target.alias_2_initials = alias_2_initials or None
    target.alias_3_pinyin = alias_3_pinyin or None
    target.alias_3_initials = alias_3_initials or None


@router.get("", response_model=dict, dependencies=[Depends(get_current_user)])
def list_chemical_name_map(
    db: DBSession,
    search: Optional[str] = Query(default=None, max_length=100),
    search_field: Optional[str] = Query(default=None),
    fuzzy: bool = False,
    skip: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
):
    limit = max(0, min(limit, MAX_PAGE_SIZE))
    skip = max(skip, 0)
    query = select(ChemicalNameMap)

    if search and search.strip():
        matched_cas_numbers = search_name_map_cas_numbers(
            db,
            search=search,
            search_field=search_field,
            fuzzy=fuzzy,
        )
        if not matched_cas_numbers:
            return {"data": [], "total": 0, "skip": skip, "limit": limit}
        query = query.where(ChemicalNameMap.cas_number.in_(matched_cas_numbers))

    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(ChemicalNameMap.updated_at.desc(), ChemicalNameMap.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return {
        "data": [ChemicalNameMapResponse.model_validate(row) for row in rows],
        "total": int(total or 0),
        "skip": skip,
        "limit": limit,
    }


@router.post("", response_model=ChemicalNameMapResponse, dependencies=[Depends(get_current_user)])
def create_chemical_name_map(payload: ChemicalNameMapCreate, db: DBSession):
    cas_number = _validate_cas_number(payload.cas_number)
    existing = db.exec(select(ChemicalNameMap).where(ChemicalNameMap.cas_number == cas_number)).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="CAS master data already exists")

    row = ChemicalNameMap(
        cas_number=cas_number,
        name=payload.name.strip(),
        category=payload.category,
    )
    _apply_name_map_payload(
        row,
        name=payload.name,
        english_name=payload.english_name,
        alias_1=payload.alias_1,
        alias_2=payload.alias_2,
        alias_3=payload.alias_3,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{item_id}", response_model=ChemicalNameMapResponse, dependencies=[Depends(get_current_user)])
def update_chemical_name_map(item_id: int, payload: ChemicalNameMapUpdate, db: DBSession):
    row = db.get(ChemicalNameMap, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chemical name map not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "category" in update_data:
        if update_data["category"] is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category is required")
        row.category = update_data["category"]

    _apply_name_map_payload(
        row,
        name=update_data.get("name"),
        english_name=update_data.get("english_name"),
        alias_1=update_data.get("alias_1"),
        alias_2=update_data.get("alias_2"),
        alias_3=update_data.get("alias_3"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{item_id}", response_model=dict, dependencies=[Depends(get_current_user)])
def delete_chemical_name_map(item_id: int, db: DBSession):
    row = db.get(ChemicalNameMap, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chemical name map not found")

    referenced_item_id = db.exec(
        select(CommonShelf.id)
        .where(CommonShelf.cas_number == row.cas_number)
        .limit(1)
    ).first()
    if referenced_item_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CAS master data is referenced by CommonShelf and cannot be deleted",
        )

    db.delete(row)
    db.commit()
    return {"message": "CAS 主数据已删除", "id": item_id}
