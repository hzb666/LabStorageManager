import logging
import time
from datetime import datetime, timedelta
from typing import Annotated, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlmodel import Session, select, func, delete

from app.database import DBSession
from app.core.auth import CurrentSession, CurrentUser, get_current_user, require_admin
from app.core.constants import (    DEFAULT_PAGE_SIZE,
    LIST_CACHE_TTL_SECONDS,
    MAX_PAGE_SIZE,
    SSEEventType,
    SSERoom,
)
from app.core.time_utils import get_utc_now, utc_iso_str
from app.core.db_compat import exec_delete_returning_first
from app.core.request_utils import get_request_is_cli, get_sse_client_id
from app.models.consumable_order import (
    ConsumableOrder,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
    ConsumableOrderStatus,
)
from app.models.user import User, UserRole
from app.services.user_utils import batch_get_user_names
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.search_matchers import (
    TextMatchMode,
    build_applicant_id_subquery,
)
from app.services.sql_utils import order_with_nulls_last
from app.services.api_utils import (
    clear_cache_by_prefix,
    empty_to_none,
    get_cached_result,
    normalize_pagination,
    set_cached_result,
)
from app.services.order_list_search import (
    OrderListSearchConfig,
    apply_order_list_single_field_search,
    build_order_list_all_search_clause,
    build_order_list_fts_state,
    normalize_order_list_search_value,
)
from app.services.sse_manager import sse_manager
from app.services.order_operation_logger import (
    log_consumable_order_approve,
    log_consumable_order_arrival_complete,
    log_consumable_order_create,
    log_consumable_order_delete,
    log_consumable_order_export,
    log_consumable_order_reject,
    log_consumable_order_update,
)
from app.services.search_query_log_service import (
    buffer_search_log,
    build_search_log_filters,
    build_search_log_sort,
)

router = APIRouter(prefix="/consumable-orders", tags=["ConsumableOrders"])
logger = logging.getLogger(__name__)

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
LIST_CACHE_PREFIX = "list:"
ORDER_NOT_FOUND = "Order not found"
DELETE_ORDER_FORBIDDEN_DETAIL = "Only the order applicant or admin can delete this order"
DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL = "Public account cannot delete orders"
DELETE_APPROVED_ORDER_FORBIDDEN_DETAIL = "Approved or completed consumable orders cannot be deleted"
CONSUMABLE_ORDER_DELETE_LOCKED_STATUSES = frozenset(
    {
        ConsumableOrderStatus.APPROVED,
        ConsumableOrderStatus.COMPLETED,
    }
)
CONSUMABLE_ORDER_REJECTABLE_STATUSES = frozenset(
    {
        ConsumableOrderStatus.PENDING,
        ConsumableOrderStatus.APPROVED,
    }
)
CONSUMABLE_ORDER_APPROVABLE_STATUSES = frozenset(
    {
        ConsumableOrderStatus.PENDING,
        ConsumableOrderStatus.REJECTED,
    }
)
CONSUMABLE_ORDER_EDITABLE_STATUSES = frozenset(
    {ConsumableOrderStatus.PENDING, ConsumableOrderStatus.REJECTED}
)
CONSUMABLE_ORDER_ADMIN_EDITABLE_STATUSES = frozenset(
    {*CONSUMABLE_ORDER_EDITABLE_STATUSES, ConsumableOrderStatus.APPROVED}
)
DASHBOARD_ACTIVE_REJECTED_DAYS = 7
DASHBOARD_CONSUMABLE_STATUSES = (
    ConsumableOrderStatus.PENDING,
    ConsumableOrderStatus.APPROVED,
    ConsumableOrderStatus.REJECTED,
)
APPLICANT_SORT_KEYS = {"applicant", "applicant_name"}
APPLICANT_SEARCH_KEYS = {"applicant", "applicant_name"}
VALID_CONSUMABLE_SORT_FIELDS = {
    "name",
    "name_pinyin",
    "quantity",
    "price",
    "status",
    "created_at",
    "updated_at",
    *APPLICANT_SORT_KEYS,
}
CONSUMABLE_ORDER_SEARCH_SQL_FIELD_MAP = {
    'name': [
        ConsumableOrder.name,
        ConsumableOrder.name_pinyin,
        ConsumableOrder.name_pinyin_initials,
    ],
    'specification': [ConsumableOrder.specification],
    'created_at': [ConsumableOrder.created_at],
    'communication': [ConsumableOrder.communication],
}
CONSUMABLE_ORDER_SEARCH_FTS_FIELD_MAP = {
    'name': ["name", "name_pinyin", "name_pinyin_initials"],
    'specification': ["specification"],
    'communication': ["communication"],
}
CONSUMABLE_ORDER_SEARCH_CONFIG = OrderListSearchConfig(
    id_column=ConsumableOrder.id,
    applicant_id_column=ConsumableOrder.applicant_id,
    created_at_column=ConsumableOrder.created_at,
    sql_field_map=CONSUMABLE_ORDER_SEARCH_SQL_FIELD_MAP,
    fts_field_map=CONSUMABLE_ORDER_SEARCH_FTS_FIELD_MAP,
    applicant_search_keys=frozenset(APPLICANT_SEARCH_KEYS),
    cas_search_keys=frozenset(),
)


class ConsumableOrderListQuery(BaseModel):
    # 定义耗材订单列表查询参数，保持 API 查询契约并收口路由签名。

    skip: int = 0
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    status_filter: Optional[ConsumableOrderStatus] = None
    search: Optional[str] = Query(default=None, max_length=100)
    search_field: Optional[str] = None
    fuzzy: bool = False
    match_mode: TextMatchMode = TextMatchMode.CONTAINS
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"


def _delete_consumable_order_with_permission(
    db: Session,
    *,
    order_id: int,
    current_user: CurrentUser,
) -> ConsumableOrder:
    # Atomic delete avoids check-then-delete races; explicit existence check preserves 404/403 semantics.
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL,
        )

    delete_stmt = (
        delete(ConsumableOrder)
        .where(ConsumableOrder.id == order_id)
        .where(~ConsumableOrder.status.in_(CONSUMABLE_ORDER_DELETE_LOCKED_STATUSES))
    )
    if current_user.role != UserRole.ADMIN:
        delete_stmt = delete_stmt.where(ConsumableOrder.applicant_id == current_user.id)
    deleted_item = exec_delete_returning_first(db, delete_stmt, ConsumableOrder)
    if deleted_item is not None:
        return deleted_item

    existing_order = get_consumable_order_by_id(db, order_id)
    if existing_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)
    if existing_order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DELETE_ORDER_FORBIDDEN_DETAIL,
        )
    _ensure_consumable_order_deletable(existing_order)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=DELETE_ORDER_FORBIDDEN_DETAIL,
    )


def _ensure_consumable_order_deletable(order: ConsumableOrder) -> None:
    if order.status in CONSUMABLE_ORDER_DELETE_LOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DELETE_APPROVED_ORDER_FORBIDDEN_DETAIL,
        )


def _ensure_consumable_order_rejectable(order: ConsumableOrder) -> None:
    if order.status not in CONSUMABLE_ORDER_REJECTABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject order with status: {order.status}",
        )


def _add_specification(item_dict: dict) -> dict:
    # 补充 specification 展示字段。
    # specification 为用户直接输入的完整规格字符串，无需拼接。
    # specification 字段已包含在 model_dump 中，无需额外处理
    return item_dict


def _serialize_consumable_order(order: ConsumableOrder, db: Session) -> dict[str, Any]:
    users_map = batch_get_user_names(db, {order.applicant_id} if order.applicant_id else set())
    return _add_specification({
        **ConsumableOrderResponse.model_validate(order).model_dump(mode="json"),
        "applicant_name": users_map.get(order.applicant_id, ""),
    })


def get_consumable_order_by_id(db: Session, order_id: int) -> Optional[ConsumableOrder]:
    # Get consumable order by ID
    return db.get(ConsumableOrder, order_id)


def _apply_consumable_order_filters(
    base,
    status_filter: Optional[ConsumableOrderStatus],
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    # 应用耗材订单列表筛选，保持搜索语义并降低主流程复杂度。

    if status_filter:
        base = base.where(ConsumableOrder.status == status_filter)

    search_value = normalize_order_list_search_value(search, fuzzy=fuzzy)
    if not search_value:
        return base

    applicant_id_subquery = build_applicant_id_subquery(
        search_value,
        fuzzy=fuzzy,
        match_mode=match_mode,
    )
    fts_state = build_order_list_fts_state(
        config=CONSUMABLE_ORDER_SEARCH_CONFIG,
        fts_table="consumable_order_fts",
        search_value=search_value,
        search_field=search_field,
        fuzzy=fuzzy,
        match_mode=match_mode,
        allow_fts=True,
        logger=logger,
        log_label="Consumable order",
    )

    if search_field and search_field != 'all':
        single_field_filtered, matched = apply_order_list_single_field_search(
            base,
            config=CONSUMABLE_ORDER_SEARCH_CONFIG,
            search_field=search_field,
            search_value=search_value,
            fuzzy=fuzzy,
            match_mode=match_mode,
            applicant_id_subquery=applicant_id_subquery,
            fts_clause=fts_state.fts_clause,
        )
        if matched:
            return single_field_filtered

    all_search_clause = build_order_list_all_search_clause(
        config=CONSUMABLE_ORDER_SEARCH_CONFIG,
        search_value=search_value,
        fuzzy=fuzzy,
        match_mode=match_mode,
        applicant_id_subquery=applicant_id_subquery,
        fts_rowid_subquery=fts_state.fts_rowid_subquery,
    )
    if all_search_clause is None:
        return base
    return base.where(all_search_clause)


@router.post("/", response_model=ConsumableOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_consumable_order(
    order: ConsumableOrderCreate,
    request: Request,
    current_user: CurrentUser,
    db: DBSession,
):
    # Create a new consumable order
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public account cannot create orders")

    # 处理可选字段：空字符串和纯空格转为 None
    optional_string_fields = ['english_name', 'product_number', 'unit', 'communication', 'notes']
    normalized = empty_to_none(order.model_dump(), optional_string_fields)

    pinyin_fields = compute_pinyin_fields(name=normalized.get('name', order.name))

    db_order = ConsumableOrder(
        name=normalized.get('name', order.name),
        english_name=normalized.get('english_name'),
        product_number=normalized.get('product_number'),
        specification=order.specification,
        unit=normalized.get('unit'),
        quantity=order.quantity,
        price=order.price,
        communication=normalized.get('communication'),
        notes=normalized.get('notes'),
        applicant_id=current_user.id,
        **pinyin_fields,
    )
    
    db.add(db_order)
    db.flush()
    log_consumable_order_create(
        db,
        order=db_order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(db_order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_CREATED,
        {"id": db_order.id, "item": _serialize_consumable_order(db_order, db)},
    )
    
    return db_order


@router.get("/")
def list_consumable_orders(
    request: Request,
    db: DBSession,
    query: Annotated[ConsumableOrderListQuery, Depends()],
    current_session: CurrentSession,
):
    # 按查询参数返回耗材订单列表，保持分页/搜索/排序行为兼容。

    _current_user, session = current_session
    started = time.perf_counter()
    skip, limit = normalize_pagination(query.skip, query.limit)
    status_filter = query.status_filter
    search = query.search
    search_field = query.search_field
    fuzzy = query.fuzzy
    match_mode = query.match_mode
    sort_by = query.sort_by
    sort_order = query.sort_order

    if sort_by and sort_by not in VALID_CONSUMABLE_SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的排序字段")

    # 生成缓存key（包含所有搜索参数，包括分页和排序）
    cache_key = (
        f"{LIST_CACHE_PREFIX}{skip}:{limit}:{search or ''}:{status_filter or ''}:"
        f"{search_field or ''}:{fuzzy}:{match_mode.value}:{sort_by or ''}:{sort_order or ''}"
    )

    # 尝试从缓存获取（仅当是第一页且无搜索条件时）
    is_first_page = skip == 0
    has_search = bool(search or status_filter or sort_by)
    should_use_cache = is_first_page and not has_search

    if should_use_cache:
        cached = get_cached_result(
            SEARCH_CACHE,
            cache_key,
            now=get_utc_now,
            ttl_seconds=LIST_CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    base = select(ConsumableOrder)

    # 排序处理
    sort_field_map = {
        'name': ConsumableOrder.name,
        'name_pinyin': ConsumableOrder.name_pinyin,
        'quantity': ConsumableOrder.quantity,
        'price': ConsumableOrder.price,
        'status': ConsumableOrder.status,
        'created_at': ConsumableOrder.created_at,
        'updated_at': ConsumableOrder.updated_at,
    }

    # 处理申请人排序（需要 JOIN User 表）
    use_applicant_join = sort_by in APPLICANT_SORT_KEYS

    if use_applicant_join:
        # 需要 JOIN User 表来按申请人姓名拼音排序
        from sqlmodel import join as sqljoin

        # 重新构建 base 查询，包含 JOIN
        base = select(ConsumableOrder).select_from(
            sqljoin(ConsumableOrder, User, ConsumableOrder.applicant_id == User.id)
        )
        base = _apply_consumable_order_filters(
            base,
            status_filter,
            search,
            search_field,
            fuzzy,
            match_mode,
        )

        order_column = func.coalesce(User.full_name_pinyin, User.full_name)
    else:
        base = _apply_consumable_order_filters(
            base,
            status_filter,
            search,
            search_field,
            fuzzy,
            match_mode,
        )
        order_column = sort_field_map.get(sort_by, ConsumableOrder.created_at)

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

    order_direction = sort_order.lower() if sort_order else 'desc'

    order_expr = order_with_nulls_last(order_column, order_direction)

    secondary_order = ConsumableOrder.created_at.desc()

    # 第三级排序：按ID降序（确保排序完全稳定）
    tertiary_order = ConsumableOrder.id.desc()

    if limit > 0:
        orders = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order).offset(skip).limit(limit)).all()
    else:
        orders = []

    # Enrich with applicant names
    applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    users_map = batch_get_user_names(db, applicant_ids)

    result = {
        "data": [
            _add_specification({**ConsumableOrderResponse.model_validate(o).model_dump(), "applicant_name": users_map.get(o.applicant_id, "")})
            for o in orders
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
    include_search_options = bool(search and len(search.strip()) >= 2)

    # 缓存查询结果（仅当是第一页且无搜索条件时）
    if should_use_cache:
        cache_data = {
            "data": result["data"],
            "total": result["total"],
        }
        set_cached_result(SEARCH_CACHE, cache_key, cache_data, now=get_utc_now)

    buffer_search_log(
        user_id=session.user_id,
        session_id=session.id or 0,
        source="cli" if get_request_is_cli(request) else "web",
        endpoint="/consumable-orders/",
        client_slot="cli" if get_request_is_cli(request) else (get_sse_client_id(request) or "web"),
        raw_query=search,
        filters=build_search_log_filters(
            search_field=search_field if include_search_options else None,
            fuzzy=fuzzy if include_search_options else False,
            match_mode=match_mode if include_search_options else None,
            extra_filters={"status_filter": status_filter},
        ),
        has_effective_filter=bool(status_filter),
        sort=build_search_log_sort(sort_by=sort_by, sort_order=sort_order),
        result_count=total,
        latency_ms=max(0, int((time.perf_counter() - started) * 1000)),
    )
    return result


# --- Export ---

@router.get("/export", dependencies=[Depends(require_admin)])
def export_consumable_orders(
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Export consumable orders as a downloadable XLSX file.
    from app.services.xlsx_export import export_consumable_orders_xlsx

    statement = select(ConsumableOrder).order_by(ConsumableOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有订购人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids) if all_applicant_ids else {}

    response = export_consumable_orders_xlsx(orders, all_users_map)
    log_consumable_order_export(
        db,
        exported_count=len(orders),
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    return response


@router.get("/{order_id}", response_model=ConsumableOrderResponse, dependencies=[Depends(get_current_user)])
def get_consumable_order(
    order_id: int,
    db: DBSession,
):
    # Get consumable order by ID
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    return order


@router.put("/{order_id}", response_model=ConsumableOrderResponse)
async def update_consumable_order(
    order_id: int,
    order_update: ConsumableOrderUpdate,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Update consumable order information
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )

    # 检查权限：只有订购人和管理员可以更新
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public account cannot edit orders"
        )
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can update this order"
        )

    editable_statuses = (
        CONSUMABLE_ORDER_ADMIN_EDITABLE_STATUSES
        if current_user.role == UserRole.ADMIN
        else CONSUMABLE_ORDER_EDITABLE_STATUSES
    )
    if order.status not in editable_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only pending, rejected, or admin-approved orders can be edited"
        )

    before_order = ConsumableOrder.model_validate(order)
    update_data = order_update.model_dump(exclude_unset=True)
    if "status" in update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be changed via workflow endpoints",
        )
    
    optional_string_fields = [
        'english_name', 'product_number', 'unit', 'communication', 'notes',
    ]
    normalized_strings = empty_to_none(update_data, optional_string_fields)
    for field in optional_string_fields:
        if field in update_data:
            update_data[field] = normalized_strings[field]
    
    # 如果更新了 name，重新计算拼音字段（只保留 name_pinyin）
    if "name" in update_data:
        name = update_data.get("name")
        pinyin_fields = compute_pinyin_fields(name=name)
        # ConsumableOrder 保留名称的拼音搜索字段
        update_data['name_pinyin'] = pinyin_fields.get('name_pinyin')
        update_data['name_pinyin_initials'] = pinyin_fields.get('name_pinyin_initials')
    should_resubmit = order.status in {
        ConsumableOrderStatus.APPROVED,
        ConsumableOrderStatus.REJECTED,
    }

    for field, value in update_data.items():
        setattr(order, field, value)
    if should_resubmit:
        order.status = ConsumableOrderStatus.PENDING

    log_consumable_order_update(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    
    db.commit()
    db.refresh(order)
    
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_consumable_order(order, db)},
    )
    
    return order


@router.post("/{order_id}/approve", dependencies=[Depends(require_admin)])
async def approve_consumable_order(
    order_id: int,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Approve a consumable order (Admin only)
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    if order.status not in CONSUMABLE_ORDER_APPROVABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve order with status: {order.status}"
        )
    
    before_order = ConsumableOrder.model_validate(order)
    order.status = ConsumableOrderStatus.APPROVED
    log_consumable_order_approve(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_consumable_order(order, db)},
    )
    
    return order


@router.post("/{order_id}/reject", dependencies=[Depends(require_admin)])
async def reject_consumable_order(
    order_id: int,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Reject a consumable order (Admin only). Does not modify notes.
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    _ensure_consumable_order_rejectable(order)
    before_order = ConsumableOrder.model_validate(order)
    order.status = ConsumableOrderStatus.REJECTED
    log_consumable_order_reject(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_consumable_order(order, db)},
    )
    
    return order


@router.post("/{order_id}/complete")
async def complete_consumable_order(
    order_id: int,
    request: Request,
    current_user: CurrentUser,
    db: DBSession,
):
    # 完成耗材订单（耗材不需要入库）。
    # 仅申请人或管理员可执行该操作。
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    # Check if user is the applicant or admin
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can complete this order"
        )
    
    if order.status != ConsumableOrderStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot complete order with status: {order.status}. Order must be APPROVED first."
        )
    
    before_order = ConsumableOrder.model_validate(order)
    # Consumables complete directly (no stock-in)
    order.status = ConsumableOrderStatus.COMPLETED
    log_consumable_order_arrival_complete(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_consumable_order(order, db)},
    )
    
    return {
        "message": "耗材订单已完成",
        "order_id": order.id,
        "status": order.status
    }


def _build_consumable_dashboard_groups(
    orders: list[ConsumableOrder],
    users_map: dict[int, str],
) -> dict[str, dict[str, Any]]:
    grouped_orders: dict[str, dict[str, Any]] = {
        status.value: {
            "status": status.value,
            "orders": [],
            "count": 0,
        }
        for status in DASHBOARD_CONSUMABLE_STATUSES
    }

    for order in orders:
        order_data = {
            "order_id": order.id,
            "name": order.name,
            "english_name": order.english_name,
            "specification": getattr(order, 'specification', '') or '',
            "unit": order.unit,
            "quantity": order.quantity,
            "price": order.price,
            "communication": order.communication,
            "notes": order.notes,
            "applicant_id": order.applicant_id,
            "applicant_name": users_map.get(order.applicant_id) if order.applicant_id else "",
            "created_at": utc_iso_str(order.created_at),
            "updated_at": utc_iso_str(order.updated_at),
        }

        status_key = order.status.value if hasattr(order.status, "value") else str(order.status)
        if status_key not in grouped_orders:
            grouped_orders[status_key] = {"status": status_key, "orders": [], "count": 0}
        grouped_orders[status_key]["orders"].append(order_data)

    for key in grouped_orders:
        grouped_orders[key]["count"] = len(grouped_orders[key]["orders"])

    return grouped_orders


def _admin_consumable_dashboard_clause(cutoff):
    return or_(
        ConsumableOrder.status.in_(
            [ConsumableOrderStatus.PENDING, ConsumableOrderStatus.APPROVED]
        ),
        and_(
            ConsumableOrder.status == ConsumableOrderStatus.REJECTED,
            ConsumableOrder.updated_at >= cutoff,
        ),
    )


@router.get("/dashboard/my-consumable-orders")
def get_my_consumable_orders(
    current_user: CurrentUser,
    db: DBSession,
):
    # Get current user's consumable order progress
    statement = select(ConsumableOrder).where(
        ConsumableOrder.applicant_id == current_user.id,
        ConsumableOrder.status.in_(DASHBOARD_CONSUMABLE_STATUSES),
    ).order_by(ConsumableOrder.created_at.desc())

    orders = db.exec(statement).all()
    users_map = {current_user.id: current_user.full_name}

    return {
        "data": _build_consumable_dashboard_groups(orders, users_map),
        "total": len(orders)
    }


@router.get("/dashboard/admin/consumable-orders", dependencies=[Depends(require_admin)])
def get_admin_consumable_orders(db: DBSession):
    cutoff = get_utc_now() - timedelta(days=DASHBOARD_ACTIVE_REJECTED_DAYS)
    statement = (
        select(ConsumableOrder)
        .where(_admin_consumable_dashboard_clause(cutoff))
        .order_by(ConsumableOrder.created_at.desc())
    )

    orders = db.exec(statement).all()
    applicant_ids = {order.applicant_id for order in orders if order.applicant_id}
    users_map = batch_get_user_names(db, applicant_ids)

    return {
        "data": _build_consumable_dashboard_groups(orders, users_map),
        "total": len(orders),
    }


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_consumable_order(
    order_id: int,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Delete a consumable order (only applicant or admin can delete).
    order = _delete_consumable_order_with_permission(
        db,
        order_id=order_id,
        current_user=current_user,
    )

    log_consumable_order_delete(
        db,
        order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )

    db.commit()
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.CONSUMABLE_ORDERS,
        SSEEventType.CONSUMABLE_ORDER_DELETED,
        {"id": order_id},
    )
