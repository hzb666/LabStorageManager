"""CommonShelf APIs."""
from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.core.auth import CurrentSession, CurrentUser, NonPublicUser, get_current_user
from app.core.constants import DEFAULT_PAGE_SIZE, SSEEventType, SSERoom
from app.core.request_utils import get_request_is_cli, get_sse_client_id
from app.core.time_utils import get_utc_now
from app.database import DBSession
from app.models.common_shelf import (
    CommonShelf,
    CommonShelfAddBottlesRequest,
    CommonShelfGroup,
    CommonShelfGroupEditRequest,
    CommonShelfGroupItemResponse,
    CommonShelfGroupItemUpdateRequest,
    CommonShelfGroupListResponse,
    CommonShelfLocationSummaryResponse,
    CommonShelfManualCreate,
    CommonShelfRemoveOneRequest,
)
from app.services.api_utils import normalize_optional_text, normalize_pagination
from app.services.cas_utils import normalize_cas
from app.services.common_shelf_creation import (
    create_common_shelf_items_for_group_record,
    create_manual_common_shelf_items,
    normalize_brand_for_group,
    normalize_specification_for_group,
)
from app.services.common_shelf_group_records import (
    get_active_common_shelf_group,
    mark_common_shelf_group_deleted,
    touch_common_shelf_group,
)
from app.services.common_shelf_operation_logger import (
    log_common_shelf_add_bottles,
    log_common_shelf_export_operation,
    log_common_shelf_group_delete,
    log_common_shelf_group_update,
    log_common_shelf_item_update,
    log_common_shelf_remove_one,
    log_common_shelf_stock_in,
)
from app.services.common_shelf_queries import (
    CommonShelfGroupFields,
    CommonShelfGroupListOptions,
    build_group_key,
    get_common_shelf_group_row_payload,
    get_group_identity_from_group,
    get_group_identity_from_item,
    get_group_items,
    get_group_name_map,
    list_group_item_details,
    list_group_location_suggestions,
    list_group_locations,
    list_grouped_common_shelf,
    list_location_suggestions_by_identity,
    locate_merge_target,
    parse_group_key,
    remove_earliest_item_in_location,
)
from app.services.export_rate_limit import EXPORT_SCOPE_COMMON_SHELF, enforce_export_rate_limit
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.search_matchers import TextMatchMode
from app.services.search_query_log_service import (
    buffer_search_log,
    build_search_log_filters,
    build_search_log_sort,
)
from app.services.shelf_utils import normalize_storage_location
from app.services.spec_utils import SpecificationError, parse_specification
from app.services.sse_manager import sse_manager
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.services.xlsx_export import export_common_shelf_xlsx

router = APIRouter(prefix="/common-shelf", tags=["CommonShelf"])


async def _broadcast_common_shelf_change(
    *,
    event_type: str,
    items: list[CommonShelf],
    extra: dict | None = None,
) -> None:
    payload = {"ids": [item.id for item in items if item.id is not None]}
    if extra:
        payload.update(extra)
    await sse_manager.broadcast(SSERoom.COMMON_SHELF, event_type, payload)


def _build_group_row_event_extra(
    db: DBSession,
    *,
    match_group_key: str,
    group_fields: CommonShelfGroupFields,
    extra: dict | None = None,
) -> dict:
    payload = {"id": match_group_key}
    group_row = get_common_shelf_group_row_payload(db, group_fields=group_fields)
    if group_row is not None:
        payload["item"] = group_row
        payload["group_key"] = str(group_row["id"])
    else:
        payload["group_key"] = build_group_key(
            cas_number=group_fields.cas_number,
            brand_normalized=group_fields.brand_normalized,
            specification_normalized=group_fields.specification_normalized,
        )
    if extra:
        payload.update(extra)
    return payload


def _build_manual_create_group_fields(payload: CommonShelfManualCreate) -> CommonShelfGroupFields:
    _, _, specification_normalized, _ = _parse_group_specification_or_400(payload.specification)
    return CommonShelfGroupFields(
        cas_number=normalize_cas(payload.cas_number),
        brand_normalized=normalize_brand_for_group(payload.brand),
        specification_normalized=specification_normalized,
    )


def _normalize_required_brand(value: str | None) -> str:
    normalized = normalize_optional_text(value)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")
    return normalized


def _parse_group_specification_or_400(specification: str) -> tuple[float, str, str, str]:
    try:
        spec_quantity, spec_unit = parse_specification(specification.strip())
    except SpecificationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return normalize_specification_for_group(spec_quantity, spec_unit)


def _get_group_or_404(db: DBSession, group_key: str) -> tuple[CommonShelfGroupFields, CommonShelfGroup]:
    group_fields = parse_group_key(group_key)
    group = get_active_common_shelf_group(
        db,
        cas_number=group_fields.cas_number,
        brand_normalized=group_fields.brand_normalized,
        specification_normalized=group_fields.specification_normalized,
    )
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CommonShelf group not found")
    return group_fields, group


def _get_group_items_or_404(db: DBSession, group_key: str) -> tuple[CommonShelfGroupFields, list[CommonShelf]]:
    group_fields, _group = _get_group_or_404(db, group_key)
    return group_fields, get_group_items(db, group_fields=group_fields)


def _commit_and_refresh_items(db: DBSession, items: list[CommonShelf]) -> None:
    # 广播前先提交并刷新，避免 SSE 收到的组键或 id 仍是未持久化状态。
    db.commit()
    for item in items:
        db.refresh(item)


class CommonShelfGroupListQuery(BaseModel):
    search: str | None = Query(default=None, max_length=100)
    search_field: str | None = None
    fuzzy: bool = False
    match_mode: TextMatchMode = TextMatchMode.CONTAINS
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE
    sort_by: str | None = None
    sort_order: str | None = "desc"


class CommonShelfLocationSuggestionQuery(BaseModel):
    cas_number: str = Query(..., max_length=50)
    brand: str | None = Query(default=None, max_length=100)
    specification: str = Query(..., max_length=50)


@router.get("/groups", response_model=CommonShelfGroupListResponse)
def list_common_shelf_groups(
    request: Request,
    db: DBSession,
    query: Annotated[CommonShelfGroupListQuery, Depends()],
    current_session: CurrentSession,
):
    _current_user, session = current_session
    started = time.perf_counter()
    include_search_options = bool(query.search and len(query.search.strip()) >= 2)
    skip, limit = normalize_pagination(query.skip, query.limit)
    result = list_grouped_common_shelf(
        db,
        options=CommonShelfGroupListOptions(
            search=query.search,
            search_field=query.search_field,
            fuzzy=query.fuzzy,
            match_mode=query.match_mode,
            skip=skip,
            limit=limit,
            sort_by=query.sort_by,
            sort_order=query.sort_order,
        ),
    )
    buffer_search_log(
        user_id=session.user_id,
        session_id=session.id or 0,
        source="cli" if get_request_is_cli(request) else "web",
        endpoint="/common-shelf/groups",
        client_slot="cli" if get_request_is_cli(request) else (get_sse_client_id(request) or "web"),
        raw_query=query.search,
        filters=build_search_log_filters(
            search_field=query.search_field if include_search_options else None,
            fuzzy=query.fuzzy if include_search_options else False,
            match_mode=query.match_mode if include_search_options else None,
        ),
        has_effective_filter=False,
        sort=build_search_log_sort(sort_by=query.sort_by, sort_order=query.sort_order),
        result_count=result.total,
        latency_ms=max(0, int((time.perf_counter() - started) * 1000)),
    )
    return result


@router.get(
    "/groups/{group_key}/locations",
    response_model=list[CommonShelfLocationSummaryResponse],
    dependencies=[Depends(get_current_user)],
)
def get_common_shelf_group_locations(group_key: str, db: DBSession):
    return list_group_locations(db, group_fields=parse_group_key(group_key))


@router.get(
    "/groups/{group_key}/location-suggestions",
    response_model=list[str],
    dependencies=[Depends(get_current_user)],
)
def get_common_shelf_group_location_suggestions(group_key: str, db: DBSession):
    return list_group_location_suggestions(db, group_fields=parse_group_key(group_key))


@router.get("/location-suggestions", response_model=list[str], dependencies=[Depends(get_current_user)])
def get_common_shelf_location_suggestions_by_fields(
    db: DBSession,
    query: Annotated[CommonShelfLocationSuggestionQuery, Depends()],
):
    _, _, specification_normalized, _ = _parse_group_specification_or_400(query.specification)
    return list_location_suggestions_by_identity(
        db,
        cas_number=query.cas_number.strip(),
        brand_normalized=normalize_brand_for_group(query.brand),
        specification_normalized=specification_normalized,
    )


@router.get(
    "/groups/{group_key}/items",
    response_model=list[CommonShelfGroupItemResponse],
    dependencies=[Depends(get_current_user)],
)
def get_common_shelf_group_items(group_key: str, db: DBSession):
    _get_group_or_404(db, group_key)
    items = list_group_item_details(db, group_fields=parse_group_key(group_key))
    return [
        CommonShelfGroupItemResponse(
            id=item.id or 0,
            internal_code=item.internal_code,
            purity=item.purity,
            storage_location=item.storage_location,
            notes=item.notes,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post("/manual-add", response_model=dict)
async def manual_add_common_shelf(
    payload: CommonShelfManualCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: NonPublicUser,
    db: DBSession,
):
    target_group_fields = _build_manual_create_group_fields(payload)
    group_existed_before = (
        get_active_common_shelf_group(
            db,
            cas_number=target_group_fields.cas_number,
            brand_normalized=target_group_fields.brand_normalized,
            specification_normalized=target_group_fields.specification_normalized,
        )
        is not None
    )
    created_items = create_manual_common_shelf_items(db, payload, created_by_id=current_user.id)
    for item in created_items:
        log_common_shelf_stock_in(
            db,
            item=item,
            operator_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
    _commit_and_refresh_items(db, created_items)

    await _broadcast_common_shelf_change(
        event_type=(
            SSEEventType.COMMON_SHELF_UPDATED
            if group_existed_before
            else SSEEventType.COMMON_SHELF_CREATED
        ),
        items=created_items,
        extra=_build_group_row_event_extra(
            db,
            match_group_key=build_group_key(
                cas_number=target_group_fields.cas_number,
                brand_normalized=target_group_fields.brand_normalized,
                specification_normalized=target_group_fields.specification_normalized,
            ),
            group_fields=target_group_fields,
        ),
    )
    if created_items:
        enqueue_structure_cache_resolution(
            background_tasks,
            created_items[0].cas_number,
            reason="common_shelf.manual_add",
        )
    return {
        "message": "常用货架新增成功",
        "items_created": len(created_items),
        "item_ids": [item.id for item in created_items],
        "group_key": get_group_identity_from_item(created_items[0]).group_key if created_items else None,
    }


@router.put("/groups/{group_key}", response_model=dict)
async def update_common_shelf_group(
    group_key: str,
    payload: CommonShelfGroupEditRequest,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    current_group_fields, current_group = _get_group_or_404(db, group_key)
    items = get_group_items(db, group_fields=current_group_fields)
    normalized_quantity, normalized_unit, specification_normalized, specification_text = (
        _parse_group_specification_or_400(payload.specification)
    )
    target_brand = _normalize_required_brand(payload.brand)
    target_group_fields = CommonShelfGroupFields(
        cas_number=current_group_fields.cas_number,
        brand_normalized=normalize_brand_for_group(target_brand),
        specification_normalized=specification_normalized,
    )
    merge_target = locate_merge_target(
        db,
        current_group_fields=current_group_fields,
        target_group_fields=target_group_fields,
    )
    # 编辑分组可能把当前整组“并入”另一组；未确认前先返回提示，避免用户无感知地改写分组边界。
    if merge_target is not None and not payload.confirm_merge:
        return {
            "requires_confirmation": True,
            "message": "修改后将与另一分组合并，请确认",
            "target_group_key": build_group_key(
                cas_number=merge_target.cas_number,
                brand_normalized=merge_target.brand_normalized,
                specification_normalized=merge_target.specification_normalized,
            ),
            "target_bottle_count": len(get_group_items(db, group_fields=target_group_fields)),
        }

    before_group = CommonShelfGroup.model_validate(current_group)
    before_items = [CommonShelf.model_validate(item) for item in items]
    brand = merge_target.brand if merge_target is not None else target_brand
    target_group = merge_target or current_group

    if merge_target is None:
        current_group.brand = brand
        current_group.brand_normalized = target_group_fields.brand_normalized
        current_group.spec_quantity = normalized_quantity
        current_group.spec_unit = normalized_unit
        current_group.specification_normalized = specification_normalized
        current_group.specification_text = specification_text
        current_group.updated_at = get_utc_now()
        db.add(current_group)
    else:
        mark_common_shelf_group_deleted(db, current_group)
        touch_common_shelf_group(
            db,
            cas_number=target_group_fields.cas_number,
            brand_normalized=target_group_fields.brand_normalized,
            specification_normalized=target_group_fields.specification_normalized,
        )

    for item in items:
        item.brand = brand
        item.brand_normalized = target_group_fields.brand_normalized
        item.spec_quantity = normalized_quantity
        item.spec_unit = normalized_unit
        item.specification_normalized = specification_normalized
        item.specification_text = specification_text

    if items:
        for before_item, after_item in zip(before_items, items):
            log_common_shelf_group_update(
                db,
                before_item=before_item,
                after_item=after_item,
                operator_id=current_user.id,
                merged=merge_target is not None,
                is_cli=get_request_is_cli(request),
            )
    else:
        log_common_shelf_group_update(
            db,
            before_item=before_group,
            after_item=target_group,
            operator_id=current_user.id,
            merged=merge_target is not None,
            is_cli=get_request_is_cli(request),
        )

    db.commit()
    if items:
        for item in items:
            db.refresh(item)
    db.refresh(target_group)
    next_group_key = get_group_identity_from_group(target_group).group_key
    event_extra = {"group_key": next_group_key, "merged": merge_target is not None}
    if merge_target is None:
        event_extra = _build_group_row_event_extra(
            db,
            match_group_key=group_key,
            group_fields=target_group_fields,
            extra=event_extra,
        )
    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_UPDATED,
        items=items,
        extra=event_extra,
    )
    return {
        "message": "常用货架分组已更新",
        "requires_confirmation": False,
        "updated_count": len(items),
        "group_key": next_group_key,
    }


@router.put(
    "/groups/{group_key}/items/{item_id}",
    response_model=dict,
)
async def update_common_shelf_item(
    group_key: str,
    item_id: int,
    payload: CommonShelfGroupItemUpdateRequest,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    group_fields, items = _get_group_items_or_404(db, group_key)
    item = next((current for current in items if current.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CommonShelf item not found")

    before_item = CommonShelf.model_validate(item)
    item.purity = normalize_optional_text(payload.purity)
    item.storage_location = normalize_storage_location(payload.storage_location)
    item.storage_location_normalized = (
        item.storage_location.casefold() if item.storage_location is not None else None
    )
    pinyin_fields = compute_pinyin_fields(storage_location=item.storage_location)
    item.storage_location_pinyin = pinyin_fields.get("storage_location_pinyin")
    item.storage_location_pinyin_initials = pinyin_fields.get(
        "storage_location_pinyin_initials"
    )
    item.notes = normalize_optional_text(payload.notes)
    touch_common_shelf_group(
        db,
        cas_number=group_fields.cas_number,
        brand_normalized=group_fields.brand_normalized,
        specification_normalized=group_fields.specification_normalized,
    )

    log_common_shelf_item_update(
        db,
        before_item=before_item,
        after_item=item,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    _commit_and_refresh_items(db, [item])

    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_UPDATED,
        items=[item],
        extra=_build_group_row_event_extra(
            db,
            match_group_key=group_key,
            group_fields=group_fields,
        ),
    )
    return {
        "message": "常用货架条目已更新",
        "item_id": item.id,
        "group_key": group_key,
    }


@router.post("/groups/{group_key}/add-bottles", response_model=dict, dependencies=[Depends(get_current_user)])
async def add_common_shelf_bottles(
    group_key: str,
    payload: CommonShelfAddBottlesRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    db: DBSession,
):
    group_fields, group = _get_group_or_404(db, group_key)
    existing_items = get_group_items(db, group_fields=group_fields)
    normalized_location = normalize_storage_location(payload.storage_location)
    created_items = create_common_shelf_items_for_group_record(
        db,
        group,
        count=payload.count,
        storage_location=normalized_location,
        purity=payload.purity,
        notes=payload.notes,
        created_by_id=current_user.id,
    )
    log_common_shelf_add_bottles(
        db,
        sample_item=existing_items[-1] if existing_items else group,
        operator_id=current_user.id,
        count=payload.count,
        location=normalized_location,
        is_cli=get_request_is_cli(request),
    )
    _commit_and_refresh_items(db, created_items)

    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_UPDATED,
        items=created_items,
        extra=_build_group_row_event_extra(
            db,
            match_group_key=group_key,
            group_fields=group_fields,
        ),
    )
    enqueue_structure_cache_resolution(
        background_tasks,
        group.cas_number,
        reason="common_shelf.add_bottles",
    )
    return {
        "message": "常用货架已加瓶",
        "items_created": len(created_items),
        "item_ids": [item.id for item in created_items],
        "group_key": get_group_identity_from_item(created_items[0]).group_key
        if created_items
        else get_group_identity_from_group(group).group_key,
    }


@router.post("/groups/{group_key}/remove-one", response_model=dict, dependencies=[Depends(get_current_user)])
async def remove_one_common_shelf(
    group_key: str,
    payload: CommonShelfRemoveOneRequest,
    request: Request,
    current_user: CurrentUser,
    db: DBSession,
):
    group_fields, _items = _get_group_items_or_404(db, group_key)
    removed_item = remove_earliest_item_in_location(
        db,
        group_fields=group_fields,
        storage_location=payload.storage_location,
    )
    log_common_shelf_remove_one(
        db,
        item=removed_item,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    touch_common_shelf_group(
        db,
        cas_number=group_fields.cas_number,
        brand_normalized=group_fields.brand_normalized,
        specification_normalized=group_fields.specification_normalized,
    )
    removed_item_id = removed_item.id
    fallback_name = removed_item.name_snapshot
    db.commit()

    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_UPDATED,
        items=[removed_item],
        extra=_build_group_row_event_extra(
            db,
            match_group_key=group_key,
            group_fields=group_fields,
            extra={"removed_item_id": removed_item_id},
        ),
    )

    remaining_items = get_group_items(db, group_fields=group_fields)
    name_map = get_group_name_map(db, cas_number=group_fields.cas_number)
    preferred_name = name_map.name if name_map and name_map.name else fallback_name
    return {
        "message": "已扣减 1 瓶",
        "removed_item_id": removed_item_id,
        "remaining_bottle_count": len(remaining_items),
        "group_exists": True,
        "preferred_name": preferred_name,
        "preferred_name_source": "chemical_name_map" if name_map and name_map.name else "name_snapshot",
        "display_name": preferred_name,
    }


@router.delete(
    "/groups/{group_key}/items/{item_id}",
    response_model=dict,
)
async def delete_common_shelf_item(
    group_key: str,
    item_id: int,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    group_fields, items = _get_group_items_or_404(db, group_key)
    item = next((current for current in items if current.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CommonShelf item not found")

    removed_snapshot = CommonShelf.model_validate(item)
    log_common_shelf_remove_one(
        db,
        item=removed_snapshot,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    removed_item_id = item.id
    db.delete(item)
    touch_common_shelf_group(
        db,
        cas_number=group_fields.cas_number,
        brand_normalized=group_fields.brand_normalized,
        specification_normalized=group_fields.specification_normalized,
    )
    db.commit()

    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_UPDATED,
        items=[removed_snapshot],
        extra=_build_group_row_event_extra(
            db,
            match_group_key=group_key,
            group_fields=group_fields,
            extra={"removed_item_id": removed_item_id},
        ),
    )

    remaining_items = get_group_items(db, group_fields=group_fields)
    return {
        "message": "常用货架条目已删除",
        "removed_item_id": removed_item_id,
        "remaining_bottle_count": len(remaining_items),
        "group_exists": True,
        "group_key": group_key,
    }


@router.delete("/groups/{group_key}", response_model=dict)
async def delete_common_shelf_group(
    group_key: str,
    request: Request,
    current_user: NonPublicUser,
    db: DBSession,
):
    group_fields, group = _get_group_or_404(db, group_key)
    existing_items = get_group_items(db, group_fields=group_fields)
    if existing_items:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only empty common shelf groups can be deleted",
        )

    mark_common_shelf_group_deleted(db, group)
    log_common_shelf_group_delete(
        db,
        group=group,
        deleted_count=0,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()

    await _broadcast_common_shelf_change(
        event_type=SSEEventType.COMMON_SHELF_DELETED,
        items=[],
        extra={"group_key": group_key, "deleted_ids": []},
    )
    return {
        "message": "常用货架分组已删除",
        "group_key": group_key,
        "deleted_count": 0,
        "deleted_ids": [],
    }


@router.get("/export", dependencies=[Depends(get_current_user)])
def export_common_shelf(request: Request, db: DBSession, current_user: CurrentUser):
    enforce_export_rate_limit(current_user.id, EXPORT_SCOPE_COMMON_SHELF)
    # 导出复用分组查询，保证页面看到的聚合口径和 Excel 导出口径一致。
    response = list_grouped_common_shelf(
        db,
        options=CommonShelfGroupListOptions(
            search=None,
            search_field=None,
            fuzzy=False,
            match_mode=TextMatchMode.CONTAINS,
            skip=0,
            limit=0,
            sort_by="updated_at",
            sort_order="desc",
        ),
    )
    log_common_shelf_export_operation(
        db,
        operator_id=current_user.id,
        exported_count=len(response.data),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    return export_common_shelf_xlsx(response.data)
