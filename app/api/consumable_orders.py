"""
Consumable Order API Routes - Consumables Purchase Order Management
Separated from Reagent orders (no stock-in needed)
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
from app.core.time_utils import get_utc_now, to_china_time
from app.models.consumable_order import (
    ConsumableOrder,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
    ConsumableOrderStatus,
)
from app.models.user import User, UserRole
from app.services.csv_utils import escape_csv_formula
from app.services.user_utils import batch_get_user_names
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.sql_utils import normalize_field_sql, normalize_search_term, order_with_nulls_last
from app.services.api_utils import (
    clear_cache_by_prefix,
    empty_to_none,
    get_cached_result,
    set_cached_result,
)

router = APIRouter(prefix="/consumable-orders", tags=["ConsumableOrders"])

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 10  # 缓存有效期10秒，与前端refetchInterval匹配
LIST_CACHE_PREFIX = "list:"
ORDER_NOT_FOUND = "Order not found"
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

def _add_specification(item_dict: dict) -> dict:
    """Add specification field to order response dict
    注意：specification 是用户直接输入的完整规格字符串，无需拼接
    """
    # specification 字段已包含在 model_dump 中，无需额外处理
    return item_dict


def get_consumable_order_by_id(db: Session, order_id: int) -> Optional[ConsumableOrder]:
    """Get consumable order by ID"""
    return db.get(ConsumableOrder, order_id)


def _apply_consumable_order_filters(
    base,
    status_filter: Optional[ConsumableOrderStatus],
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
):
    """Apply shared list filters for consumable order listing."""
    if status_filter:
        base = base.where(ConsumableOrder.status == status_filter)

    if not search:
        return base

    search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
    if not search_value:
        return base

    search_pattern = f"%{search_value}%"
    field_map = {
        'name': [
            ConsumableOrder.name,
            ConsumableOrder.name_pinyin,
            ConsumableOrder.name_pinyin_initials,
        ],
        'specification': [ConsumableOrder.specification],
        'created_at': [func.strftime('%Y-%m-%d %H:%M:%S', ConsumableOrder.created_at)],
        'communication': [ConsumableOrder.communication],
    }
    applicant_match = _combine_search_clauses([
        _build_search_clause(User.full_name, search_pattern, fuzzy=fuzzy),
        _build_search_clause(User.full_name_pinyin, search_pattern, fuzzy=fuzzy),
        _build_search_clause(User.full_name_pinyin_initials, search_pattern, fuzzy=fuzzy),
    ])
    applicant_id_subquery = select(User.id).where(applicant_match)

    if search_field and search_field != 'all':
        if search_field in APPLICANT_SEARCH_KEYS:
            return base.where(ConsumableOrder.applicant_id.in_(applicant_id_subquery))
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
    all_clauses.append(ConsumableOrder.applicant_id.in_(applicant_id_subquery))
    return base.where(_combine_search_clauses(all_clauses))


@router.post("/", response_model=ConsumableOrderResponse, status_code=status.HTTP_201_CREATED)
def create_consumable_order(
    order: ConsumableOrderCreate,
    current_user: CurrentUser,
    db: DBSession,
):
    """Create a new consumable order"""
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="公用账户不能创建订单")

    # 处理可选字段：空字符串和纯空格转为 None
    optional_string_fields = ['english_name', 'product_number', 'unit', 'communication', 'notes']
    normalized = empty_to_none(order.model_dump(), optional_string_fields)

    pinyin_fields = compute_pinyin_fields(name=normalized.get('name', order.name))

    db_order = ConsumableOrder(
        name=normalized.get('name', order.name),
        english_name=normalized.get('english_name'),
        specification=order.specification,
        unit=normalized.get('unit'),
        quantity=order.quantity,
        price=order.price,
        communication=normalized.get('communication'),
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
def list_consumable_orders(
    current_user: CurrentUser,
    db: DBSession,
    skip: int = 0,
    limit: int = min(50, MAX_PAGE_SIZE),
    status_filter: Optional[ConsumableOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
):
    """List consumable orders with optional filters, pagination, search, sort and applicant name"""
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
        base = _apply_consumable_order_filters(base, status_filter, search, search_field, fuzzy)

        order_column = func.coalesce(User.full_name_pinyin, User.full_name)
    else:
        base = _apply_consumable_order_filters(base, status_filter, search, search_field, fuzzy)
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
        orders = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order)).all()

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
def export_consumable_orders(
    db: DBSession,
    current_user: AdminUser,
):
    """Export consumable orders as a downloadable CSV file."""
    statement = select(ConsumableOrder).order_by(ConsumableOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有订购人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids)

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)

    writer.writerow([
        "名称", "英文名", "规格", "数量", "单价", "状态",
        "订购人", "申购时间", "备注",
    ])

    for order in orders:
        # 使用直接存储的规格字符串
        spec = getattr(order, 'specification', '') or ''
        writer.writerow([
            escape_csv_formula(order.name),
            escape_csv_formula(order.english_name or ""),
            escape_csv_formula(spec or ""),
            order.quantity,
            order.price or "",
            order.status.value if hasattr(order.status, "value") else order.status,
            escape_csv_formula(all_users_map.get(order.applicant_id, "") if order.applicant_id else ""),
            to_china_time(order.created_at).strftime("%Y-%m-%d %H:%M:%S") if order.created_at else "",
            escape_csv_formula(order.notes or ""),
        ])

    output.seek(0)
    filename = f"consumable_orders_export_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{order_id}", response_model=ConsumableOrderResponse)
def get_consumable_order(
    order_id: int,
    current_user: CurrentUser,
    db: DBSession,
):
    """Get consumable order by ID"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    return order


@router.put("/{order_id}", response_model=ConsumableOrderResponse)
def update_consumable_order(
    order_id: int,
    order_update: ConsumableOrderUpdate,
    db: DBSession,
    current_user: CurrentUser,
):
    """Update consumable order information"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )

    # 检查权限：只有订购人和管理员可以更新
    from app.models.user import UserRole
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can update this order"
        )

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
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    db.commit()
    db.refresh(order)
    
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    
    return order


@router.post("/{order_id}/approve")
def approve_consumable_order(
    order_id: int,
    admin_user: AdminUser,
    db: DBSession,
):
    """Approve a consumable order (Admin only)"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    if order.status != ConsumableOrderStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve order with status: {order.status}"
        )
    
    order.status = ConsumableOrderStatus.APPROVED
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    
    return order


@router.post("/{order_id}/reject")
def reject_consumable_order(
    order_id: int,
    admin_user: AdminUser,
    db: DBSession,
):
    """Reject a consumable order (Admin only). Does not modify notes."""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    order.status = ConsumableOrderStatus.REJECTED
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    
    return order


@router.post("/{order_id}/complete")
def complete_consumable_order(
    order_id: int,
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Complete consumable order (consumables don't need stock-in)
    Only order applicant or admin can complete.
    """
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    # Check if user is the applicant or admin
    from app.models.user import UserRole
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
    
    # Consumables complete directly (no stock-in)
    order.status = ConsumableOrderStatus.COMPLETED
    
    db.commit()
    db.refresh(order)
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    
    return {
        "message": "耗材订单已完成",
        "order_id": order.id,
        "status": order.status
    }


@router.get("/dashboard/my-consumable-orders")
def get_my_consumable_orders(
    current_user: CurrentUser,
    db: DBSession,
):
    """Get current user's consumable order progress"""
    statement = select(ConsumableOrder).where(
        ConsumableOrder.applicant_id == current_user.id,
        ConsumableOrder.status.in_([ConsumableOrderStatus.PENDING, ConsumableOrderStatus.APPROVED])
    ).order_by(ConsumableOrder.created_at.desc())
    
    orders = db.exec(statement).all()
    
    # Group by status
    pending = []
    approved = []
    
    for order in orders:
        order_data = {
            "order_id": order.id,
            "name": order.name,
            "english_name": order.english_name,
            "specification": getattr(order, 'specification', '') or '',
            "quantity": order.quantity,
            "price": order.price,
            "notes": order.notes,
            "created_at": order.created_at.isoformat() + 'Z' if order.created_at else None,
            "updated_at": order.updated_at.isoformat() + 'Z' if order.updated_at else None
        }
        
        if order.status == ConsumableOrderStatus.PENDING:
            pending.append(order_data)
        elif order.status == ConsumableOrderStatus.APPROVED:
            approved.append(order_data)
    
    return {
        "data": {
            "pending": {
                "orders": pending,
                "count": len(pending),
                "label": "已申购"
            },
            "approved": {
                "orders": approved,
                "count": len(approved),
                "label": "已审批"
            }
        },
        "total": len(orders)
    }


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_consumable_order(
    order_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    """Delete a consumable order (only applicant or admin can delete)"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ORDER_NOT_FOUND
        )
    
    # Check if user is the applicant or admin
    from app.models.user import UserRole
    if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the order applicant or admin can delete this order"
        )
    
    db.delete(order)
    db.commit()
    clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
