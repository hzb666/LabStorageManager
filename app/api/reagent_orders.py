# 试剂订单 API 路由：试剂申购流程管理。
# 与耗材订单分离，支持独立工作流。
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Optional, Dict, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.database import DBSession
from app.core.auth import CurrentSession, CurrentUser, get_current_user, require_admin
from app.core.constants import (
    DEFAULT_PAGE_SIZE,
    LIST_CACHE_TTL_SECONDS,
    MAX_PAGE_SIZE,
    SSEEventType,
    SSERoom,
)
from app.core.time_utils import get_utc_now
from app.models import BaseResponse
from app.models.user import User, UserRole
from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderCreate,
    ReagentOrderUpdate,
    ReagentOrderResponse,
    ReagentOrderReason,
    ReagentOrderStatus,
)
from app.services.cas_utils import (
    normalize_cas,
    validate_cas_format,
    is_special_cas_value,
    BIOLOGICAL_REAGENT_CAS,
)
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.search_matchers import (
    CASSearchMode,
    TextMatchMode,
    build_applicant_id_subquery,
    build_cas_search_clause,
    build_date_search_clause,
    build_text_search_clause,
    classify_cas_search,
    collect_search_fields,
    combine_or_clauses,
)
from app.services.user_utils import batch_get_user_names
from app.services.sql_utils import normalize_search_term, order_with_nulls_last
from app.services.sql_utils import order_with_special_last
from app.services.api_utils import (
    clear_cache_by_prefix,
    empty_to_none,
    get_cached_result,
    normalize_pagination,
    set_cached_result,
)
from app.services.order_fts import (
    OrderFTSError,
    build_order_fts_id_clause,
    build_order_fts_rowid_subquery,
    should_use_order_fts,
)
from app.services.inventory_queries import regular_inventory_query
from app.services.sse_manager import sse_manager
from app.core.request_utils import get_request_is_cli, get_sse_client_id
from app.services.order_operation_logger import (
    log_reagent_order_create,
    log_reagent_order_export,
    log_reagent_order_update,
)
from app.services.search_query_log_service import (
    buffer_search_log,
    build_search_log_filters,
    build_search_log_sort,
)
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.api.reagent_orders_workflow import register_workflow_routes

router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])
logger = logging.getLogger(__name__)

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
LIST_CACHE_PREFIX = "list:"
VALID_REAGENT_ORDER_REASONS = {reason.value for reason in ReagentOrderReason}
REAGENT_ORDER_EDITABLE_STATUSES = frozenset(
    {ReagentOrderStatus.PENDING, ReagentOrderStatus.REJECTED}
)
REAGENT_ORDER_ADMIN_EDITABLE_STATUSES = frozenset(
    {*REAGENT_ORDER_EDITABLE_STATUSES, ReagentOrderStatus.APPROVED}
)
APPLICANT_SORT_KEYS = {"applicant", "applicant_name"}
APPLICANT_SEARCH_KEYS = {"applicant", "applicant_name"}
VALID_REAGENT_SORT_FIELDS = {
    "cas_number",
    "name",
    "name_pinyin",
    "category",
    "brand",
    "brand_pinyin",
    "quantity",
    "price",
    "status",
    "order_reason",
    "created_at",
    "updated_at",
    *APPLICANT_SORT_KEYS,
}
REAGENT_ORDER_SEARCH_SQL_FIELD_MAP = {
    'name': [
        ReagentOrder.name,
        ReagentOrder.name_pinyin,
        ReagentOrder.name_pinyin_initials,
    ],
    'cas': [ReagentOrder.cas_number],
    'cas_number': [ReagentOrder.cas_number],
    'brand': [
        ReagentOrder.brand,
        ReagentOrder.brand_pinyin,
        ReagentOrder.brand_pinyin_initials,
    ],
    'created_at': [ReagentOrder.created_at],
    'category': [
        ReagentOrder.category,
        ReagentOrder.category_pinyin,
        ReagentOrder.category_pinyin_initials,
    ],
}
REAGENT_ORDER_SEARCH_FTS_FIELD_MAP = {
    'name': ["name", "name_pinyin", "name_pinyin_initials"],
    'cas': ["cas_number"],
    'cas_number': ["cas_number"],
    'brand': ["brand", "brand_pinyin", "brand_pinyin_initials"],
    'category': ["category", "category_pinyin", "category_pinyin_initials"],
}


@dataclass(frozen=True)
class ReagentOrderFTSState:
    # 封装试剂订单 FTS 构建结果，减少主筛选函数的分支和临时变量。

    fts_clause: Any
    fts_rowid_subquery: Any


@dataclass(frozen=True)
class ReagentOrderSingleFieldSearchOptions:
    # 封装试剂订单单字段搜索参数，避免 helper 参数过多。

    search_field: Optional[str]
    search_value: str
    fuzzy: bool
    match_mode: TextMatchMode
    applicant_id_subquery: Any
    cas_exact_or_prefix: bool
    fts_clause: Any


class ReagentOrderListQuery(BaseModel):
    # 定义试剂订单列表查询参数，保持 API 查询契约同时精简路由函数签名。

    skip: int = 0
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    status_filter: Optional[ReagentOrderStatus] = None
    search: Optional[str] = Query(default=None, max_length=100)
    search_field: Optional[str] = None
    fuzzy: bool = False
    match_mode: TextMatchMode = TextMatchMode.CONTAINS
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"


class CASOverviewOrderResponse(BaseResponse):
    id: int
    name: str
    applicant_name: str | None
    specification: str
    created_at: datetime
    status: str


class CASOverviewInventoryResponse(BaseResponse):
    id: int
    remaining_quantity: float | None
    specification: str
    storage_location: str | None
    created_at: datetime
    status: str
    borrower_name: str | None


class CASOverviewResponseModel(BaseResponse):
    cas_number: str
    preferred_name: str | None
    preferred_name_source: str | None
    display_name: str | None = None
    has_warning: bool
    orders: dict[str, int | CASOverviewOrderResponse | None]
    inventory: dict[str, int | CASOverviewInventoryResponse | None]


def _validate_order_reason(reason: Optional[str], required: bool = False) -> Optional[ReagentOrderReason]:
    # Validate order reason in API layer and convert to enum for model persistence.
    if reason is None:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="order_reason is required"
            )
        return None

    normalized_reason = reason.strip().lower()
    if not normalized_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="order_reason is required"
        )

    if normalized_reason not in VALID_REAGENT_ORDER_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order_reason"
        )

    return ReagentOrderReason(normalized_reason)


def _ensure_required_brand(brand: Optional[str]) -> str:
    normalized_brand = brand.strip() if isinstance(brand, str) else ""
    if not normalized_brand:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")
    return normalized_brand


def _add_specification(item_dict: dict) -> dict:
    # Add computed specification field to order response dict
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def _serialize_reagent_order(order: ReagentOrder, db: Session) -> dict[str, Any]:
    users_map = batch_get_user_names(db, {order.applicant_id} if order.applicant_id else set())
    return _add_specification({
        **ReagentOrderResponse.model_validate(order).model_dump(mode="json"),
        "applicant_name": users_map.get(order.applicant_id, ""),
    })

def get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    # Get reagent order by ID
    return db.get(ReagentOrder, order_id)


def _normalize_order_search_value(search: Optional[str], *, fuzzy: bool) -> Optional[str]:
    # 标准化订单搜索词，统一 fuzzy 与空输入处理。

    if not search:
        return None
    raw_search = search.strip()
    if not raw_search:
        return None
    if fuzzy:
        return normalize_search_term(raw_search)
    return raw_search


def _build_reagent_order_fts_state(
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
    cas_exact_or_prefix: bool,
) -> ReagentOrderFTSState:
    # 构建试剂订单 FTS 条件，异常时返回空状态并回退 SQL LIKE。

    use_fts = (
        match_mode == TextMatchMode.CONTAINS
        and (not fuzzy)
        and should_use_order_fts(search_value)
        and not cas_exact_or_prefix
    )
    if not use_fts:
        return ReagentOrderFTSState(fts_clause=None, fts_rowid_subquery=None)
    try:
        return ReagentOrderFTSState(
            fts_clause=build_order_fts_id_clause(
                ReagentOrder.id,
                fts_table="reagent_order_fts",
                search_value=search_value,
                search_field=search_field,
                field_map=REAGENT_ORDER_SEARCH_FTS_FIELD_MAP,
            ),
            fts_rowid_subquery=build_order_fts_rowid_subquery(
                fts_table="reagent_order_fts",
                search_value=search_value,
                search_field='all',
                field_map=REAGENT_ORDER_SEARCH_FTS_FIELD_MAP,
            ),
        )
    except OrderFTSError:
        return ReagentOrderFTSState(fts_clause=None, fts_rowid_subquery=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Reagent order FTS fallback to SQL LIKE due to runtime error: %s",
            exc,
        )
        return ReagentOrderFTSState(fts_clause=None, fts_rowid_subquery=None)


def _apply_reagent_order_single_field_search(
    base,
    *,
    options: ReagentOrderSingleFieldSearchOptions,
):
    # 处理试剂订单单字段搜索，按字段特性选择 applicant/date/cas/fts/like 分支。

    filtered = base
    matched = True
    search_field = options.search_field
    if search_field in APPLICANT_SEARCH_KEYS:
        filtered = base.where(ReagentOrder.applicant_id.in_(options.applicant_id_subquery))
    elif search_field == 'created_at':
        filtered = base.where(build_date_search_clause(ReagentOrder.created_at, options.search_value))
    elif search_field in {'cas', 'cas_number'} and options.cas_exact_or_prefix:
        filtered = base.where(
            build_cas_search_clause(
                ReagentOrder.cas_number,
                options.search_value,
                fuzzy=options.fuzzy,
                match_mode=options.match_mode,
            )
        )
    elif options.fts_clause is not None and search_field in REAGENT_ORDER_SEARCH_FTS_FIELD_MAP:
        filtered = base.where(options.fts_clause)
    elif search_field in REAGENT_ORDER_SEARCH_SQL_FIELD_MAP:
        if search_field in {'cas', 'cas_number'}:
            filtered = base.where(
                build_cas_search_clause(
                    ReagentOrder.cas_number,
                    options.search_value,
                    fuzzy=options.fuzzy,
                    match_mode=options.match_mode,
                )
            )
        else:
            filtered = base.where(
                combine_or_clauses(
                    build_text_search_clause(
                        field,
                        options.search_value,
                        fuzzy=options.fuzzy,
                        match_mode=options.match_mode,
                    )
                    for field in REAGENT_ORDER_SEARCH_SQL_FIELD_MAP[search_field]
                )
            )
    else:
        matched = False
    return filtered, matched


def _build_reagent_order_all_search_clause(
    *,
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
    applicant_id_subquery,
    fts_rowid_subquery,
):
    # 构建试剂订单 ALL 搜索条件，保留 applicant/date/fts/like 召回但避免多路 UNION。

    all_clauses = [
        ReagentOrder.applicant_id.in_(applicant_id_subquery),
        build_date_search_clause(ReagentOrder.created_at, search_value),
    ]

    if fts_rowid_subquery is not None:
        all_clauses.append(
            ReagentOrder.id.in_(fts_rowid_subquery)
        )
    else:
        all_clauses.append(
            build_cas_search_clause(
                ReagentOrder.cas_number,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )
        text_fields = collect_search_fields(
            REAGENT_ORDER_SEARCH_SQL_FIELD_MAP,
            exclude_keys={'cas', 'cas_number', 'created_at'},
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


def _apply_reagent_order_filters(
    base,
    status_filter: Optional[ReagentOrderStatus],
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    # 应用试剂订单列表筛选，保持搜索语义并降低主流程复杂度。

    if status_filter:
        base = base.where(ReagentOrder.status == status_filter)

    search_value = _normalize_order_search_value(search, fuzzy=fuzzy)
    if not search_value:
        return base

    applicant_id_subquery = build_applicant_id_subquery(
        search_value,
        fuzzy=fuzzy,
        match_mode=match_mode,
    )
    cas_mode, _ = classify_cas_search(search_value, fuzzy=fuzzy)
    cas_exact_or_prefix = cas_mode in (CASSearchMode.EXACT, CASSearchMode.PREFIX)
    fts_state = _build_reagent_order_fts_state(
        search_value=search_value,
        search_field=search_field,
        fuzzy=fuzzy,
        match_mode=match_mode,
        cas_exact_or_prefix=cas_exact_or_prefix,
    )

    if search_field and search_field != 'all':
        single_field_filtered, matched = _apply_reagent_order_single_field_search(
            base,
            options=ReagentOrderSingleFieldSearchOptions(
                search_field=search_field,
                search_value=search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
                applicant_id_subquery=applicant_id_subquery,
                cas_exact_or_prefix=cas_exact_or_prefix,
                fts_clause=fts_state.fts_clause,
            ),
        )
        if matched:
            return single_field_filtered

    all_search_clause = _build_reagent_order_all_search_clause(
        search_value=search_value,
        fuzzy=fuzzy,
        match_mode=match_mode,
        applicant_id_subquery=applicant_id_subquery,
        fts_rowid_subquery=fts_state.fts_rowid_subquery,
    )
    if all_search_clause is None:
        return base
    return base.where(all_search_clause)


@router.post("/", response_model=ReagentOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_reagent_order(
    order: ReagentOrderCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    db: DBSession,
):
    # 创建试剂订单，并自动执行 CAS 标准化。
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public account cannot create orders")

    # Normalize CAS Number
    normalized_cas = normalize_cas(order.cas_number)
    is_valid, error = validate_cas_format(normalized_cas)
    
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid CAS format: {error}"
        )
    
    # Parse specification to get initial_quantity and unit
    try:
        initial_quantity, unit = parse_specification(order.specification)
    except SpecificationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid specification format: {e}"
        )

    # order_reason 已在模型层验证（枚举类型），直接使用

    # 处理可选字段：空字符串和纯空格转为 None
    optional_string_fields = ['english_name', 'alias', 'category', 'purity', 'notes']
    normalized = empty_to_none(order.model_dump(), optional_string_fields)
    normalized_brand = _ensure_required_brand(order.brand)

    # 计算拼音字段
    pinyin_fields = compute_pinyin_fields(
        name=normalized.get('name', order.name),
        category=normalized.get('category'),
        brand=normalized_brand,
    )

    # Create order
    db_order = ReagentOrder(
        cas_number=normalized_cas,
        name=normalized.get('name', order.name),
        english_name=normalized.get('english_name'),
        alias=normalized.get('alias'),
        category=normalized.get('category'),
        brand=normalized_brand,
        purity=normalized.get('purity'),
        initial_quantity=initial_quantity,
        unit=unit,
        quantity=order.quantity,
        price=order.price,
        order_reason=order.order_reason,
        is_hazardous=order.is_hazardous,
        applicant_id=current_user.id,
        notes=normalized.get('notes'),
        **pinyin_fields,
    )
    
    db.add(db_order)
    db.flush()
    log_reagent_order_create(
        db,
        order=db_order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(db_order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.REAGENT_ORDERS,
        SSEEventType.REAGENT_ORDER_CREATED,
        {"id": db_order.id, "item": _serialize_reagent_order(db_order, db)},
    )
    enqueue_structure_cache_resolution(
        background_tasks,
        db_order.cas_number,
        reason="reagent_order.create",
    )
    
    return db_order


@router.get("/")
def list_reagent_orders(
    request: Request,
    db: DBSession,
    query: Annotated[ReagentOrderListQuery, Depends()],
    current_session: CurrentSession,
):
    # 按查询参数返回试剂订单列表，保持分页/搜索/排序行为兼容。

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

    if sort_by and sort_by not in VALID_REAGENT_SORT_FIELDS:
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

    base = select(ReagentOrder)

    # 排序处理
    sort_field_map = {
        'cas_number': ReagentOrder.cas_number,
        'name': ReagentOrder.name,
        'name_pinyin': ReagentOrder.name_pinyin,
        'category': ReagentOrder.category,
        'brand': ReagentOrder.brand,
        'brand_pinyin': ReagentOrder.brand_pinyin,
        'quantity': ReagentOrder.quantity,
        'price': ReagentOrder.price,
        'status': ReagentOrder.status,
        'order_reason': ReagentOrder.order_reason,
        'created_at': ReagentOrder.created_at,
        'updated_at': ReagentOrder.updated_at,
    }

    # 处理申请人排序（需要 JOIN User 表）
    use_applicant_join = sort_by in APPLICANT_SORT_KEYS

    if use_applicant_join:
        # 需要 JOIN User 表来按申请人姓名拼音排序
        from sqlmodel import join as sqljoin

        # 重新构建 base 查询，包含 JOIN
        base = select(ReagentOrder).select_from(
            sqljoin(ReagentOrder, User, ReagentOrder.applicant_id == User.id)
        )
        base = _apply_reagent_order_filters(
            base,
            status_filter,
            search,
            search_field,
            fuzzy,
            match_mode,
        )

        order_column = func.coalesce(User.full_name_pinyin, User.full_name)
    else:
        base = _apply_reagent_order_filters(
            base,
            status_filter,
            search,
            search_field,
            fuzzy,
            match_mode,
        )
        order_column = sort_field_map.get(sort_by, ReagentOrder.created_at)

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

    order_direction = sort_order.lower() if sort_order else 'desc'

    if sort_by == 'cas_number':
        order_expr = order_with_special_last(order_column, BIOLOGICAL_REAGENT_CAS, order_direction)
    else:
        order_expr = order_with_nulls_last(order_column, order_direction)

    secondary_order = ReagentOrder.created_at.desc()

    # 第三级排序：按ID降序（确保排序完全稳定）
    tertiary_order = ReagentOrder.id.desc()

    if limit > 0:
        orders = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order).offset(skip).limit(limit)).all()
    else:
        orders = []

    # Enrich with applicant names
    applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    users_map = batch_get_user_names(db, applicant_ids)

    result = {
        "data": [
            _add_specification({**ReagentOrderResponse.model_validate(o).model_dump(), "applicant_name": users_map.get(o.applicant_id, "")})
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
        endpoint="/reagent-orders/",
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
def export_reagent_orders(
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    # Export reagent orders as a downloadable XLSX file.
    from app.services.xlsx_export import export_reagent_orders_xlsx

    statement = select(ReagentOrder).order_by(ReagentOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有订购人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids) if all_applicant_ids else {}

    response = export_reagent_orders_xlsx(orders, all_users_map)
    log_reagent_order_export(
        db,
        exported_count=len(orders),
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    return response


@router.get(
    "/cas-overview/{cas_number}",
    response_model=CASOverviewResponseModel,
    dependencies=[Depends(get_current_user)],
)
def get_cas_overview(
    cas_number: str,
    db: DBSession,
    exclude_order_id: Optional[int] = None,
):
    # Get CAS overview for duplicate-check hints in forms and expanded rows.
    normalized_cas = normalize_cas(cas_number)

    if is_special_cas_value(normalized_cas):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Biological reagents do not support CAS query",
        )

    is_valid, error = validate_cas_format(normalized_cas)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid CAS format: {error}",
        )

    # 订单：匹配同 CAS 的所有订单。
    # 统一排除已到货/已入库（避免与库存重复），
    # 供“新建查重”和“展开行”复用同一口径。
    order_filters = [ReagentOrder.cas_number == normalized_cas]
    order_filters.append(
        ReagentOrder.status.notin_([
            ReagentOrderStatus.ARRIVED,
            ReagentOrderStatus.STOCKED,
        ])
    )
    if exclude_order_id is not None:
        order_filters.append(ReagentOrder.id != exclude_order_id)
    orders_base = select(ReagentOrder).where(*order_filters)
    orders_count = db.exec(select(func.count()).select_from(orders_base.subquery())).one()
    latest_order = db.exec(
        orders_base.order_by(ReagentOrder.created_at.desc(), ReagentOrder.id.desc()).limit(1)
    ).first()

    # 库存：过滤掉已消耗或剩余量为 0 的库存，取最近一条 + 总数
    inventory_base = regular_inventory_query().where(
        Inventory.cas_number == normalized_cas,
        Inventory.status != InventoryStatus.CONSUMED,
        (Inventory.remaining_quantity.is_(None)) | (Inventory.remaining_quantity > 0),
    )
    inventory_count = db.exec(select(func.count()).select_from(inventory_base.subquery())).one()
    latest_inventory = db.exec(
        inventory_base.order_by(Inventory.created_at.desc(), Inventory.id.desc()).limit(1)
    ).first()

    # 补齐涉及人员姓名
    user_ids: set[int] = set()
    if latest_order and latest_order.applicant_id:
        user_ids.add(latest_order.applicant_id)
    if latest_inventory and latest_inventory.borrower_id:
        user_ids.add(latest_inventory.borrower_id)
    users_map = batch_get_user_names(db, user_ids)

    latest_order_payload = None
    if latest_order:
        latest_order_payload = {
            "id": latest_order.id,
            "name": latest_order.name,
            "applicant_name": users_map.get(latest_order.applicant_id),
            "specification": format_specification(latest_order.initial_quantity, latest_order.unit) or "-",
            "created_at": latest_order.created_at,
            "status": latest_order.status.value
            if hasattr(latest_order.status, "value")
            else latest_order.status,
        }

    latest_inventory_payload = None
    if latest_inventory:
        latest_inventory_payload = {
            "id": latest_inventory.id,
            "remaining_quantity": latest_inventory.remaining_quantity,
            "specification": format_specification(
                latest_inventory.initial_quantity,
                latest_inventory.unit,
            ) or "-",
            "storage_location": latest_inventory.storage_location,
            "created_at": latest_inventory.created_at,
            "status": latest_inventory.status.value
            if hasattr(latest_inventory.status, "value")
            else latest_inventory.status,
            "borrower_name": users_map.get(latest_inventory.borrower_id),
        }

    preferred_name = None
    preferred_name_source = None
    if latest_order and latest_order.name:
        preferred_name = latest_order.name
        preferred_name_source = "latest_order_name"
    elif latest_inventory and latest_inventory.name:
        preferred_name = latest_inventory.name
        preferred_name_source = "latest_inventory_name"

    return {
        "cas_number": normalized_cas,
        "preferred_name": preferred_name,
        "preferred_name_source": preferred_name_source,
        "display_name": preferred_name,
        "has_warning": orders_count > 0 or inventory_count > 0,
        "orders": {
            "total_count": orders_count,
            "latest": latest_order_payload,
        },
        "inventory": {
            "total_count": inventory_count,
            "latest": latest_inventory_payload,
        },
    }


@router.get("/{order_id}", response_model=ReagentOrderResponse, dependencies=[Depends(get_current_user)])
def get_reagent_order(
    order_id: int,
    db: DBSession,
):
    # Get reagent order by ID
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    return order


@router.put("/{order_id}", response_model=ReagentOrderResponse)
async def update_reagent_order(
    order_id: int,
    order_update: ReagentOrderUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession,
    current_user: CurrentUser,
):
    # 更新试剂订单信息，保持权限、字段校验与缓存刷新语义不变。

    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )

    _ensure_reagent_order_edit_permission(order, current_user=current_user)
    before_order = ReagentOrder.model_validate(order)
    update_data = _normalize_reagent_order_update_data(order_update)
    _ensure_required_brand(update_data.get("brand", order.brand))
    _apply_reagent_order_pinyin_updates(order, update_data=update_data)
    should_resubmit = order.status in {
        ReagentOrderStatus.APPROVED,
        ReagentOrderStatus.REJECTED,
    }

    for field, value in update_data.items():
        setattr(order, field, value)
    if should_resubmit:
        order.status = ReagentOrderStatus.PENDING

    log_reagent_order_update(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    
    db.commit()
    db.refresh(order)
    
    # 清除列表缓存，确保更新后前端立即看到最新数据
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.REAGENT_ORDERS,
        SSEEventType.REAGENT_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_reagent_order(order, db)},
    )
    if "cas_number" in update_data:
        enqueue_structure_cache_resolution(
            background_tasks,
            order.cas_number,
            reason="reagent_order.update",
        )
    
    return order


def _ensure_reagent_order_edit_permission(order: ReagentOrder, *, current_user: CurrentUser) -> None:
    # 校验试剂订单编辑权限，保持申请人/管理员的既有边界。

    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public account cannot edit orders"
        )
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can edit this order"
        )
    editable_statuses = (
        REAGENT_ORDER_ADMIN_EDITABLE_STATUSES
        if current_user.role == UserRole.ADMIN
        else REAGENT_ORDER_EDITABLE_STATUSES
    )
    if order.status not in editable_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only pending, rejected, or admin-approved orders can be edited"
        )


def _normalize_reagent_order_update_data(order_update: ReagentOrderUpdate) -> dict:
    # 标准化试剂订单更新载荷，集中处理状态保护、空字符串与 CAS 校验。

    update_data = order_update.model_dump(exclude_unset=True)
    if "status" in update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be changed via workflow endpoints",
        )

    if "specification" in update_data:
        specification = update_data.pop("specification")
        if specification is not None:
            try:
                initial_quantity, unit = parse_specification(specification)
            except SpecificationError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
            update_data["initial_quantity"] = initial_quantity
            update_data["unit"] = unit

    optional_string_fields = ['english_name', 'alias', 'category', 'brand', 'purity', 'unit', 'notes']
    normalized_strings = empty_to_none(update_data, optional_string_fields)
    for field in optional_string_fields:
        if field in update_data:
            update_data[field] = normalized_strings[field]

    if "cas_number" in update_data and update_data["cas_number"]:
        normalized_cas = normalize_cas(update_data["cas_number"])
        is_valid, error = validate_cas_format(normalized_cas)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid CAS format: {error}"
            )
        update_data["cas_number"] = normalized_cas
    return update_data


def _apply_reagent_order_pinyin_updates(order: ReagentOrder, *, update_data: dict) -> None:
    # 在名称/类别/品牌变更时刷新拼音字段，保证搜索和排序索引持续正确。

    if not any(key in update_data for key in ("name", "category", "brand")):
        return
    name = update_data.get("name", order.name)
    category = update_data.get("category", order.category)
    brand = update_data.get("brand", order.brand)
    pinyin_fields = compute_pinyin_fields(name=name, category=category, brand=brand)
    update_data['name_pinyin'] = pinyin_fields.get('name_pinyin')
    update_data['name_pinyin_initials'] = pinyin_fields.get('name_pinyin_initials')
    update_data['category_pinyin'] = pinyin_fields.get('category_pinyin')
    update_data['category_pinyin_initials'] = pinyin_fields.get('category_pinyin_initials')
    update_data['brand_pinyin'] = pinyin_fields.get('brand_pinyin')
    update_data['brand_pinyin_initials'] = pinyin_fields.get('brand_pinyin_initials')


register_workflow_routes(router, SEARCH_CACHE)
