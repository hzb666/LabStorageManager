"""Chemical name map APIs for CommonShelf."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.core.auth import CurrentUser, NonPublicUser, get_current_user
from app.core.api_errors import ApiErrorCode, api_error
from app.core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.core.request_utils import get_client_ip, get_request_id, get_request_is_cli
from app.core.time_utils import utc_iso_str
from app.database import DBSession
from app.services.api_utils import normalize_optional_text
from app.models.chemical_name_map import (
    ChemicalNameMap,
    ChemicalNameMapCreate,
    ChemicalNameMapResponse,
    ChemicalNameMapUpdate,
)
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.user_operation_log import UserOperationAction
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.common_shelf_queries import search_name_map_cas_numbers
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.services.pinyin_utils import to_pinyin_parts
from app.services.search_matchers import TextMatchMode
from app.services.sql_utils import order_with_nulls_last
from app.services.user_operation_logger import log_user_operation

router = APIRouter(prefix="/chemical-name-map", tags=["Chemical Name Map"])

VALID_CHEMICAL_NAME_MAP_SORT_FIELDS = {
    "cas_number",
    "name",
    "english_name",
    "category",
}


class ChemicalNameMapListResponse(BaseModel):
    data: list[ChemicalNameMapResponse]
    total: int
    skip: int
    limit: int


def _validate_cas_number(raw_cas_number: str) -> str:
    cas_number = normalize_cas(raw_cas_number)
    is_valid, error_message = validate_cas_format(cas_number)
    if not cas_number or not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid CAS number: {error_message}",
        )
    return cas_number


def _build_name_map_order_expr(sort_by: Optional[str], sort_order: Optional[str]):
    sort_direction = sort_order.lower() if sort_order else "desc"
    sort_field_map = {
        "cas_number": ChemicalNameMap.cas_number,
        "name": ChemicalNameMap.name_pinyin,
        "english_name": ChemicalNameMap.english_name,
        "category": ChemicalNameMap.category,
    }
    order_column = sort_field_map.get(sort_by, ChemicalNameMap.updated_at)
    return order_with_nulls_last(order_column, sort_direction)


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
        target.english_name = normalize_optional_text(english_name)
    if alias_1 is not None:
        target.alias_1 = normalize_optional_text(alias_1)
    if alias_2 is not None:
        target.alias_2 = normalize_optional_text(alias_2)
    if alias_3 is not None:
        target.alias_3 = normalize_optional_text(alias_3)

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


def _build_chemical_name_map_snapshot(row: ChemicalNameMap) -> dict[str, object]:
    return {
        "id": row.id,
        "cas_number": row.cas_number,
        "name": row.name,
        "english_name": row.english_name,
        "category": row.category,
        "alias_1": row.alias_1,
        "alias_2": row.alias_2,
        "alias_3": row.alias_3,
        "created_at": utc_iso_str(row.created_at),
        "updated_at": utc_iso_str(row.updated_at),
    }


def _log_chemical_name_map_operation(
    db: DBSession,
    *,
    request: Request,
    current_user: CurrentUser,
    action: UserOperationAction,
    detail: str,
    snapshot: dict[str, object],
) -> None:
    log_user_operation(
        db,
        action=action,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=detail,
        snapshot=snapshot,
        is_cli=get_request_is_cli(request),
    )


@router.get(
    "",
    response_model=ChemicalNameMapListResponse,
    dependencies=[Depends(get_current_user)],
)
def list_chemical_name_map(
    db: DBSession,
    search: Optional[str] = Query(default=None, max_length=100),
    search_field: Optional[str] = Query(default=None),
    fuzzy: bool = False,
    match_mode: TextMatchMode = TextMatchMode.CONTAINS,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    skip: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
):
    limit = max(0, min(limit, MAX_PAGE_SIZE))
    skip = max(skip, 0)
    if sort_by and sort_by not in VALID_CHEMICAL_NAME_MAP_SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort field")

    query = select(ChemicalNameMap)

    if search and search.strip():
        matched_cas_numbers = search_name_map_cas_numbers(
            db,
            search=search,
            search_field=search_field,
            fuzzy=fuzzy,
            match_mode=match_mode,
        )
        if not matched_cas_numbers:
            return {"data": [], "total": 0, "skip": skip, "limit": limit}
        query = query.where(ChemicalNameMap.cas_number.in_(matched_cas_numbers))

    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    order_expr = _build_name_map_order_expr(sort_by, sort_order)
    rows = db.exec(
        query.order_by(*order_expr, ChemicalNameMap.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return {
        "data": [ChemicalNameMapResponse.model_validate(row) for row in rows],
        "total": int(total or 0),
        "skip": skip,
        "limit": limit,
    }


@router.post("", response_model=ChemicalNameMapResponse)
def create_chemical_name_map(
    payload: ChemicalNameMapCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
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
    db.flush()
    _log_chemical_name_map_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.CREATE_CHEMICAL_NAME_MAP,
        detail=f"CAS={row.cas_number} 名称={row.name}",
        snapshot=_build_chemical_name_map_snapshot(row),
    )
    db.commit()
    db.refresh(row)
    enqueue_structure_cache_resolution(
        background_tasks,
        row.cas_number,
        reason="chemical_name_map.create",
    )
    return row


@router.put("/{item_id}", response_model=ChemicalNameMapResponse)
def update_chemical_name_map(
    item_id: int,
    payload: ChemicalNameMapUpdate,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    row = db.get(ChemicalNameMap, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chemical name map not found")

    before_snapshot = _build_chemical_name_map_snapshot(row)
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
    db.flush()
    _log_chemical_name_map_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_CHEMICAL_NAME_MAP,
        detail=f"CAS={row.cas_number} 名称={row.name}",
        snapshot={
            "before": before_snapshot,
            "after": _build_chemical_name_map_snapshot(row),
        },
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{item_id}", response_model=dict)
def delete_chemical_name_map(
    item_id: int,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    row = db.get(ChemicalNameMap, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chemical name map not found")
    before_snapshot = _build_chemical_name_map_snapshot(row)

    referenced_order_id = db.exec(
        select(ReagentOrder.id)
        .where(ReagentOrder.cas_number == row.cas_number)
        .where(ReagentOrder.status != ReagentOrderStatus.STOCKED)
        .limit(1)
    ).first()
    if referenced_order_id is not None:
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            detail="CAS master data is referenced by an unfinished reagent order and cannot be deleted",
            code=ApiErrorCode.CAS_MASTER_DATA_REFERENCED_BY_ORDER,
        )

    referenced_item_id = db.exec(
        select(CommonShelf.id)
        .where(CommonShelf.cas_number == row.cas_number)
        .limit(1)
    ).first()
    referenced_group_id = db.exec(
        select(CommonShelfGroup.id)
        .where(CommonShelfGroup.cas_number == row.cas_number)
        .where(CommonShelfGroup.is_deleted.is_(False))
        .limit(1)
    ).first()
    if referenced_item_id is not None or referenced_group_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CAS master data is referenced by CommonShelf and cannot be deleted",
        )

    db.delete(row)
    _log_chemical_name_map_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_CHEMICAL_NAME_MAP,
        detail=f"CAS={row.cas_number} 名称={row.name}",
        snapshot={
            "before": before_snapshot,
            "after": {},
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "CAS master data is referenced by an unfinished reagent order" in str(exc):
            raise api_error(
                status_code=status.HTTP_409_CONFLICT,
                detail="CAS master data is referenced by an unfinished reagent order and cannot be deleted",
                code=ApiErrorCode.CAS_MASTER_DATA_REFERENCED_BY_ORDER,
            ) from exc
        raise
    return {"message": "CAS 主数据已删除", "id": item_id}
