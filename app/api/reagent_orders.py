"""
Reagent Order API Routes - Reagent Purchase Order Management
Separated from Consumable orders for independent workflow
"""
import io
import csv
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func

from app.database import DBSession
from app.core.auth import CurrentUser, AdminUser
from app.core.time_utils import get_utc_now
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderCreate,
    ReagentOrderUpdate,
    ReagentOrderResponse,
    ReagentOrderStatus,
)
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.user_utils import batch_get_user_names
from app.services.sql_utils import normalize_field_sql, normalize_search_term
from app.services.api_utils import (
    clear_cache_by_prefix,
    empty_to_none,
    get_cached_result,
    set_cached_result,
)
from app.api.reagent_orders_workflow import register_workflow_routes

router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 10  # 缓存有效期10秒，与前端refetchInterval匹配
LIST_CACHE_PREFIX = "list:"

def _add_specification(item_dict: dict) -> dict:
    """Add computed specification field to order response dict"""
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict

def get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    """Get reagent order by ID"""
    return db.get(ReagentOrder, order_id)


@router.post("/", response_model=ReagentOrderResponse, status_code=status.HTTP_201_CREATED)
def create_reagent_order(
    order: ReagentOrderCreate,
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Create a new reagent order.
    Critical: CAS Number is normalized automatically.
    """
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
    
    # 计算拼音字段
    pinyin_fields = compute_pinyin_fields(
        name=order.name,
        brand=order.brand,
    )
    
    # Create order
    db_order = ReagentOrder(
        cas_number=normalized_cas,
        name=order.name,
        english_name=order.english_name,
        alias=order.alias,
        category=order.category,
        brand=order.brand,
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
    
    return db_order


# 分页限制常量
MAX_PAGE_SIZE = 100

@router.get("/")
def list_reagent_orders(
    current_user: CurrentUser,
    db: DBSession,
    skip: int = 0,
    limit: int = min(50, MAX_PAGE_SIZE),
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
            ttl_seconds=CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    base = select(ReagentOrder)

    if status_filter:
        base = base.where(ReagentOrder.status == status_filter)

    # 搜索处理
    if search:
        if fuzzy:
            # 模糊搜索：标准化搜索词（移除特殊空格字符和常见分隔符）
            search_normalized = normalize_search_term(search.strip())

            base = base.where(
                (normalize_field_sql(ReagentOrder.cas_number).ilike(f"%{search_normalized}%")) |
                (normalize_field_sql(ReagentOrder.name).ilike(f"%{search_normalized}%")) |
                (normalize_field_sql(ReagentOrder.brand).ilike(f"%{search_normalized}%")) |
                (normalize_field_sql(ReagentOrder.category).ilike(f"%{search_normalized}%"))
            )
        else:
            search_pattern = f"%{search}%"

            if search_field and search_field != 'all':
                field_map = {
                    'name': ReagentOrder.name,
                    'cas_number': ReagentOrder.cas_number,
                    'brand': ReagentOrder.brand,
                    'category': ReagentOrder.category,
                }
                if search_field in field_map:
                    base = base.where(field_map[search_field].ilike(search_pattern))
                else:
                    # 未知字段，回退到搜索所有字段
                    base = base.where(
                        (ReagentOrder.name.ilike(search_pattern)) |
                        (ReagentOrder.cas_number.ilike(search_pattern)) |
                        (ReagentOrder.brand.ilike(search_pattern)) |
                        (ReagentOrder.category.ilike(search_pattern))
                    )
            else:
                base = base.where(
                    (ReagentOrder.name.ilike(search_pattern)) |
                    (ReagentOrder.cas_number.ilike(search_pattern)) |
                    (ReagentOrder.brand.ilike(search_pattern)) |
                    (ReagentOrder.category.ilike(search_pattern))
                )

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

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

    order_direction = sort_order.lower() if sort_order else 'desc'
    order_column = sort_field_map.get(sort_by, ReagentOrder.created_at)

    if order_direction == 'asc':
        order_expr = order_column.asc()
    else:
        order_expr = order_column.desc()

    secondary_order = ReagentOrder.created_at.desc()

    # 第三级排序：按ID降序（确保排序完全稳定）
    tertiary_order = ReagentOrder.id.desc()

    if limit > 0:
        orders = db.exec(base.order_by(order_expr, secondary_order, tertiary_order).offset(skip).limit(limit)).all()
    else:
        orders = db.exec(base.order_by(order_expr, secondary_order, tertiary_order)).all()

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
    statement = select(ReagentOrder).order_by(ReagentOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有申请人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids)

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)

    writer.writerow([
        "CAS号", "名称", "英文名", "别名", "分类", "品牌",
        "规格", "数量", "单价", "申购原因", "状态",
        "是否危险品", "申请人", "申购时间", "备注",
    ])

    for order in orders:
        # 使用公共函数格式化规格
        spec = format_specification(order.initial_quantity, order.unit)
        writer.writerow([
            order.cas_number,
            order.name,
            order.english_name or "",
            order.alias or "",
            order.category or "",
            order.brand or "",
            spec or "",
            order.quantity,
            order.price or "",
            order.order_reason.value if hasattr(order.order_reason, "value") else order.order_reason,
            order.status.value if hasattr(order.status, "value") else order.status,
            "是" if order.is_hazardous else "否",
            all_users_map.get(order.applicant_id, "") if order.applicant_id else "",
            order.created_at.strftime("%Y-%m-%d %H:%M:%S") if order.created_at else "",
            order.notes or "",
        ])

    output.seek(0)
    filename = f"reagent_orders_export_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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
def update_reagent_order(
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
    from app.models.user import UserRole
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can edit this order"
        )
    
    update_data = order_update.model_dump(exclude_unset=True)
    
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
    
    # 如果更新了 name 或 brand，重新计算拼音字段（只保留 name_pinyin 和 brand_pinyin）
    if "name" in update_data or "brand" in update_data:
        name = update_data.get("name", order.name)
        brand = update_data.get("brand", order.brand)
        pinyin_fields = compute_pinyin_fields(name=name, brand=brand)
        # ReagentOrder 有 name_pinyin 和 brand_pinyin 字段
        update_data['name_pinyin'] = pinyin_fields.get('name_pinyin')
        update_data['brand_pinyin'] = pinyin_fields.get('brand_pinyin')
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    db.commit()
    db.refresh(order)
    
    # 清除列表缓存，确保更新后前端立即看到最新数据
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    
    return order


register_workflow_routes(router, SEARCH_CACHE)
