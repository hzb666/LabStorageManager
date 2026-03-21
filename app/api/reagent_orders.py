"""
Reagent Order API Routes - Reagent Purchase Order Management
Separated from Consumable orders for independent workflow
"""
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, status
from sqlmodel import Session, select, func

from app.database import DBSession
from app.core.auth import CurrentUser, AdminUser
from app.core.constants import (
    DEFAULT_PAGE_SIZE,
    LIST_CACHE_TTL_SECONDS,
    MAX_PAGE_SIZE,
    SSEEventType,
    SSERoom,
)
from app.core.time_utils import get_utc_now
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
from app.services.user_utils import batch_get_user_names
from app.services.sql_utils import normalize_field_sql, normalize_search_term, order_with_nulls_last
from app.services.sql_utils import order_with_special_last
from app.services.api_utils import (
    clear_cache_by_prefix,
    empty_to_none,
    get_cached_result,
    set_cached_result,
)
from app.services.sse_manager import sse_manager
from app.api.reagent_orders_workflow import register_workflow_routes

router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
LIST_CACHE_PREFIX = "list:"
VALID_REAGENT_ORDER_REASONS = {reason.value for reason in ReagentOrderReason}
APPLICANT_SORT_KEYS = {"applicant", "applicant_name"}
APPLICANT_SEARCH_KEYS = {"applicant", "applicant_name"}


def _build_search_clause(field, pattern: str, *, fuzzy: bool):
    column = func.coalesce(field, "")
    if fuzzy:
        return normalize_field_sql(column).ilike(pattern)
    return column.ilike(pattern)


def _combine_search_clauses(clauses: list[Any]):
    expr = clauses[0]
    for clause in clauses[1:]:
        expr = expr | clause
    return expr


def _validate_order_reason(reason: Optional[str], required: bool = False) -> Optional[ReagentOrderReason]:
    """Validate order reason in API layer and convert to enum for model persistence."""
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

def _add_specification(item_dict: dict) -> dict:
    """Add computed specification field to order response dict"""
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict

def get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    """Get reagent order by ID"""
    return db.get(ReagentOrder, order_id)


def _apply_reagent_order_filters(
    base,
    status_filter: Optional[ReagentOrderStatus],
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
):
    """Apply shared list filters for reagent order listing."""
    if status_filter:
        base = base.where(ReagentOrder.status == status_filter)

    if not search:
        return base

    search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
    if not search_value:
        return base

    search_pattern = f"%{search_value}%"
    field_map = {
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
        'created_at': [func.strftime('%Y-%m-%d %H:%M:%S', ReagentOrder.created_at)],
        'category': [
            ReagentOrder.category,
            ReagentOrder.category_pinyin,
            ReagentOrder.category_pinyin_initials,
        ],
    }
    applicant_match = _combine_search_clauses([
        _build_search_clause(User.full_name, search_pattern, fuzzy=fuzzy),
        _build_search_clause(User.full_name_pinyin, search_pattern, fuzzy=fuzzy),
        _build_search_clause(User.full_name_pinyin_initials, search_pattern, fuzzy=fuzzy),
    ])
    applicant_id_subquery = select(User.id).where(applicant_match)

    if search_field and search_field != 'all':
        if search_field in APPLICANT_SEARCH_KEYS:
            return base.where(ReagentOrder.applicant_id.in_(applicant_id_subquery))
        if search_field in field_map:
            clauses = [
                _build_search_clause(field, search_pattern, fuzzy=fuzzy)
                for field in field_map[search_field]
            ]
            return base.where(_combine_search_clauses(clauses))

    all_clauses = []
    for fields in field_map.values():
        all_clauses.extend(
            _build_search_clause(field, search_pattern, fuzzy=fuzzy)
            for field in fields
        )
    all_clauses.append(ReagentOrder.applicant_id.in_(applicant_id_subquery))
    return base.where(_combine_search_clauses(all_clauses))


@router.post("/", response_model=ReagentOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_reagent_order(
    order: ReagentOrderCreate,
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Create a new reagent order.
    Critical: CAS Number is normalized automatically.
    """
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
    optional_string_fields = ['english_name', 'alias', 'category', 'brand', 'notes']
    normalized = empty_to_none(order.model_dump(), optional_string_fields)

    # 计算拼音字段
    pinyin_fields = compute_pinyin_fields(
        name=normalized.get('name', order.name),
        category=normalized.get('category'),
        brand=normalized.get('brand'),
    )

    # Create order
    db_order = ReagentOrder(
        cas_number=normalized_cas,
        name=normalized.get('name', order.name),
        english_name=normalized.get('english_name'),
        alias=normalized.get('alias'),
        category=normalized.get('category'),
        brand=normalized.get('brand'),
        initial_quantity=initial_quantity,
        unit=unit,
        quantity=order.quantity,
        price=order.price,
        order_reason=order.order_reason,
        is_hazardous=order.is_hazardous,
        applicant_id=current_user.id,
        **pinyin_fields,
    )
    
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.REAGENT_ORDERS,
        SSEEventType.REAGENT_ORDER_CREATED,
        {"id": db_order.id},
    )
    
    return db_order


@router.get("/")
def list_reagent_orders(
    current_user: CurrentUser,
    db: DBSession,
    skip: int = 0,
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    status_filter: Optional[ReagentOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
):
    """List reagent orders with optional filters, pagination, search, sort and applicant name"""
    del current_user  # 仅用于鉴权

    # 生成缓存key（包含所有搜索参数，包括分页和排序）
    cache_key = f"{LIST_CACHE_PREFIX}{skip}:{limit}:{search or ''}:{status_filter or ''}:{search_field or ''}:{fuzzy}:{sort_by or ''}:{sort_order or ''}"

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
        base = _apply_reagent_order_filters(base, status_filter, search, search_field, fuzzy)

        order_column = func.coalesce(User.full_name_pinyin, User.full_name)
    else:
        base = _apply_reagent_order_filters(base, status_filter, search, search_field, fuzzy)
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
        orders = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order)).all()

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

    # 缓存查询结果（仅当是第一页且无搜索条件时）
    if should_use_cache:
        cache_data = {
            "data": result["data"],
            "total": result["total"],
        }
        set_cached_result(SEARCH_CACHE, cache_key, cache_data, now=get_utc_now)

    return result


# --- Export ---

@router.get("/export")
def export_reagent_orders(
    db: DBSession,
    current_user: AdminUser,
):
    """Export reagent orders as a downloadable CSV file."""
    from app.services.csv_export import export_reagent_orders_csv

    statement = select(ReagentOrder).order_by(ReagentOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有订购人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids) if all_applicant_ids else {}

    return export_reagent_orders_csv(orders, all_users_map)


@router.get("/cas-overview/{cas_number}")
def get_cas_overview(
    cas_number: str,
    current_user: CurrentUser,
    db: DBSession,
    exclude_order_id: Optional[int] = None,
):
    """Get CAS overview for duplicate-check hints in forms and expanded rows."""
    del current_user  # 仅用于鉴权

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
    inventory_base = select(Inventory).where(
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

    display_name = None
    if latest_order and latest_order.name:
        display_name = latest_order.name
    elif latest_inventory and latest_inventory.name:
        display_name = latest_inventory.name

    return {
        "cas_number": normalized_cas,
        "display_name": display_name,
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


@router.get("/{order_id}", response_model=ReagentOrderResponse)
def get_reagent_order(
    order_id: int,
    current_user: CurrentUser,
    db: DBSession,
):
    """Get reagent order by ID"""
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
    db: DBSession,
    current_user: CurrentUser,
):
    """Update reagent order information"""
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    # 检查权限：普通用户只能编辑自己的订单，管理员可以编辑所有人的订单
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
    
    update_data = order_update.model_dump(exclude_unset=True)
    if "status" in update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be changed via workflow endpoints",
        )
    
    optional_string_fields = [
        'english_name', 'alias', 'category', 'brand', 'unit', 'notes',
    ]
    normalized_strings = empty_to_none(update_data, optional_string_fields)
    for field in optional_string_fields:
        if field in update_data:
            update_data[field] = normalized_strings[field]
    
    # Normalize CAS if being updated
    if "cas_number" in update_data and update_data["cas_number"]:
        normalized_cas = normalize_cas(update_data["cas_number"])
        is_valid, error = validate_cas_format(normalized_cas)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid CAS format: {error}"
            )
        update_data["cas_number"] = normalized_cas

    # order_reason 已在模型层验证（枚举类型），直接使用
    # 如果更新了 name 或 brand，重新计算拼音字段（只保留 name_pinyin 和 brand_pinyin）
    if "name" in update_data or "category" in update_data or "brand" in update_data:
        name = update_data.get("name", order.name)
        category = update_data.get("category", order.category)
        brand = update_data.get("brand", order.brand)
        pinyin_fields = compute_pinyin_fields(name=name, category=category, brand=brand)
        # ReagentOrder 保留搜索/排序需要的拼音字段
        update_data['name_pinyin'] = pinyin_fields.get('name_pinyin')
        update_data['name_pinyin_initials'] = pinyin_fields.get('name_pinyin_initials')
        update_data['category_pinyin'] = pinyin_fields.get('category_pinyin')
        update_data['category_pinyin_initials'] = pinyin_fields.get('category_pinyin_initials')
        update_data['brand_pinyin'] = pinyin_fields.get('brand_pinyin')
        update_data['brand_pinyin_initials'] = pinyin_fields.get('brand_pinyin_initials')
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    db.commit()
    db.refresh(order)
    
    # 清除列表缓存，确保更新后前端立即看到最新数据
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.REAGENT_ORDERS,
        SSEEventType.REAGENT_ORDER_UPDATED,
        {"id": order_id},
    )
    
    return order


register_workflow_routes(router, SEARCH_CACHE)
