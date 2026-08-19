"""Reagent brand master-data APIs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.core.auth import CurrentUser, NonPublicUser
from app.core.request_utils import get_client_ip, get_request_id, get_request_is_cli
from app.core.time_utils import utc_iso_str
from app.database import DBSession
from app.models.reagent_brand import (
    ReagentBrand,
    ReagentBrandCreate,
    ReagentBrandResponse,
    ReagentBrandUpdate,
)
from app.models.user_operation_log import UserOperationAction
from app.services.api_utils import normalize_pagination
from app.services.reagent_brand_service import (
    build_reagent_brand_pinyin_fields,
    normalize_reagent_brand_key,
    normalize_reagent_brand_name,
)
from app.services.sql_utils import order_with_nulls_last
from app.services.user_operation_logger import log_user_operation

router = APIRouter(prefix="/reagent-brands", tags=["Reagent Brands"])

VALID_REAGENT_BRAND_SORT_FIELDS = {"name", "updated_at"}


class ReagentBrandListResponse(BaseModel):
    data: list[ReagentBrandResponse]
    total: int
    skip: int
    limit: int


def _escape_like_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _apply_brand_name(target: ReagentBrand, raw_name: str) -> None:
    name = normalize_reagent_brand_name(raw_name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brand name is required",
        )

    name_pinyin, name_initials = build_reagent_brand_pinyin_fields(name)
    target.name = name
    target.name_normalized = normalize_reagent_brand_key(name)
    target.name_pinyin = name_pinyin
    target.name_pinyin_initials = name_initials


def _normalize_brand_identity(raw_name: str) -> tuple[str, str]:
    name = normalize_reagent_brand_name(raw_name)
    name_key = normalize_reagent_brand_key(name)
    if not name_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand name is required")
    return name, name_key


def _find_brand_by_normalized_name(
    db: DBSession,
    name_key: str,
    *,
    exclude_brand_id: int | None = None,
) -> ReagentBrand | None:
    query = select(ReagentBrand).where(ReagentBrand.name_normalized == name_key)
    if exclude_brand_id is not None:
        query = query.where(ReagentBrand.id != exclude_brand_id)
    return db.exec(query).first()


def _apply_brand_search(query, search: str | None):
    search_name = normalize_reagent_brand_name(search)
    if not search_name:
        return query

    search_key = normalize_reagent_brand_key(search_name)
    search_pinyin, search_initials = build_reagent_brand_pinyin_fields(search_name)
    clauses = [
        ReagentBrand.name_normalized.like(f"%{_escape_like_value(search_key)}%", escape="\\"),
    ]
    if search_pinyin:
        clauses.append(
            ReagentBrand.name_pinyin.like(f"%{_escape_like_value(search_pinyin)}%", escape="\\")
        )
    if search_initials:
        clauses.append(
            ReagentBrand.name_pinyin_initials.like(
                f"%{_escape_like_value(search_initials)}%",
                escape="\\",
            )
        )
    return query.where(or_(*clauses))


def _build_brand_order_expr(sort_by: str | None, sort_order: str | None):
    sort_direction = sort_order.lower() if sort_order else "asc"
    sort_field_map = {
        "name": ReagentBrand.name_pinyin,
        "updated_at": ReagentBrand.updated_at,
    }
    order_column = sort_field_map.get(sort_by, ReagentBrand.name_pinyin)
    return order_with_nulls_last(order_column, sort_direction)


def _get_active_brand(db: DBSession, brand_id: int) -> ReagentBrand:
    row = db.get(ReagentBrand, brand_id)
    if row is None or not row.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    return row


def _build_reagent_brand_snapshot(row: ReagentBrand) -> dict[str, object]:
    return {
        "bid": row.id,
        "nm": row.name,
        "nn": row.name_normalized,
        "py": row.name_pinyin,
        "pi": row.name_pinyin_initials,
        "ac": row.is_active,
        "cr": utc_iso_str(row.created_at),
        "up": utc_iso_str(row.updated_at),
    }


def _log_reagent_brand_operation(
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
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=detail,
        snapshot=snapshot,
        is_cli=get_request_is_cli(request),
    )


def _commit_brand_with_audit(
    db: DBSession,
    row: ReagentBrand,
    *,
    request: Request,
    current_user: CurrentUser,
    action: UserOperationAction,
    before_snapshot: dict[str, object] | None = None,
) -> None:
    """按 flush、审计日志、commit 的顺序提交品牌写入。"""

    try:
        db.add(row)
        db.flush()
        after_snapshot = _build_reagent_brand_snapshot(row)
        snapshot: dict[str, object]
        if before_snapshot is None:
            snapshot = after_snapshot
        else:
            snapshot = {
                "bf": before_snapshot,
                "af": after_snapshot,
            }
        _log_reagent_brand_operation(
            db,
            request=request,
            current_user=current_user,
            action=action,
            detail=f"品牌={row.name}",
            snapshot=snapshot,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Brand already exists",
        ) from exc


@router.get("", response_model=ReagentBrandListResponse)
def list_reagent_brands(
    current_user: CurrentUser,
    db: DBSession,
    search: str | None = Query(default=None, max_length=100),
    sort_by: str | None = None,
    sort_order: str | None = "asc",
    skip: int = 0,
    limit: int = 500,
    include_inactive: bool = False,
):
    if sort_by and sort_by not in VALID_REAGENT_BRAND_SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort field")

    skip, limit = normalize_pagination(skip, limit)
    query = select(ReagentBrand)
    if not include_inactive:
        query = query.where(ReagentBrand.is_active.is_(True))
    query = _apply_brand_search(query, search)

    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    order_expr = _build_brand_order_expr(sort_by, sort_order)
    rows = db.exec(
        query.order_by(*order_expr, ReagentBrand.name.asc(), ReagentBrand.id.asc())
        .offset(skip)
        .limit(limit)
    ).all()
    return {
        "data": [ReagentBrandResponse.model_validate(row) for row in rows],
        "total": int(total or 0),
        "skip": skip,
        "limit": limit,
    }


@router.post("", response_model=ReagentBrandResponse)
def create_reagent_brand(
    payload: ReagentBrandCreate,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    name, name_key = _normalize_brand_identity(payload.name)

    existing = _find_brand_by_normalized_name(db, name_key)
    if existing is not None:
        if existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Brand already exists",
            )
        _apply_brand_name(existing, name)
        existing.is_active = True
        _commit_brand_with_audit(
            db,
            existing,
            request=request,
            current_user=current_user,
            action=UserOperationAction.CREATE_REAGENT_BRAND,
        )
        db.refresh(existing)
        return existing

    row = ReagentBrand(name=name, name_normalized=name_key)
    _apply_brand_name(row, name)
    _commit_brand_with_audit(
        db,
        row,
        request=request,
        current_user=current_user,
        action=UserOperationAction.CREATE_REAGENT_BRAND,
    )
    db.refresh(row)
    return row


@router.put("/{brand_id}", response_model=ReagentBrandResponse)
def update_reagent_brand(
    brand_id: int,
    payload: ReagentBrandUpdate,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    row = _get_active_brand(db, brand_id)
    before_snapshot = _build_reagent_brand_snapshot(row)
    name, new_name_key = _normalize_brand_identity(payload.name)

    existing = _find_brand_by_normalized_name(
        db,
        new_name_key,
        exclude_brand_id=brand_id,
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Brand already exists")

    _apply_brand_name(row, name)
    _commit_brand_with_audit(
        db,
        row,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_REAGENT_BRAND,
        before_snapshot=before_snapshot,
    )
    db.refresh(row)
    return row


@router.delete("/{brand_id}", response_model=dict)
def delete_reagent_brand(
    brand_id: int,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    row = _get_active_brand(db, brand_id)
    before_snapshot = _build_reagent_brand_snapshot(row)
    row.is_active = False
    db.add(row)
    db.flush()
    _log_reagent_brand_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_REAGENT_BRAND,
        detail=f"品牌={row.name}",
        snapshot={
            "bf": before_snapshot,
            "af": _build_reagent_brand_snapshot(row),
        },
    )
    db.commit()
    return {"message": "品牌已删除", "id": brand_id}
