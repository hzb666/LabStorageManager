"""
Consumable Order API Routes - Consumables Purchase Order Management
Separated from Reagent orders (no stock-in needed)
"""
import io
import csv
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func

from app.database import get_db
from app.core.auth import get_current_user, require_admin
from app.core.time_utils import get_utc_now
from app.models.consumable_order import (
    ConsumableOrder,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
    ConsumableOrderStatus,
)
from app.models.user import User
from app.services.image_service import process_uploaded_image
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.services.user_utils import batch_get_user_names
from app.services.pinyin_utils import compute_pinyin_fields

router = APIRouter(prefix="/consumable-orders", tags=["ConsumableOrders"])

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
REAGENT_ORDER_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 10  # 缓存有效期10秒，与前端refetchInterval匹配


def _get_cached_result(cache_key: str) -> Optional[Dict[str, Any]]:
    """从缓存获取结果"""
    if cache_key in REAGENT_ORDER_CACHE:
        cached_result, cached_time = REAGENT_ORDER_CACHE[cache_key]
        if (get_utc_now() - cached_time).total_seconds() < CACHE_TTL_SECONDS:
            return cached_result
        else:
            # 缓存过期，删除
            del REAGENT_ORDER_CACHE[cache_key]
    return None


def _set_cached_result(cache_key: str, result: Dict[str, Any]) -> None:
    """设置缓存结果"""
    REAGENT_ORDER_CACHE[cache_key] = (result, get_utc_now())
    # 简单清理：只保留最近100个缓存项
    if len(REAGENT_ORDER_CACHE) > 100:
        # 删除最旧的10个
        oldest_keys = sorted(REAGENT_ORDER_CACHE.keys(), key=lambda k: REAGENT_ORDER_CACHE[k][1])[:10]
        for key in oldest_keys:
            del REAGENT_ORDER_CACHE[key]


def _clear_reagent_order_cache() -> None:
    """清除所有列表缓存（当订单数据发生变化时调用）"""
    # 清除所有以 "list:" 开头的缓存键
    keys_to_delete = [key for key in REAGENT_ORDER_CACHE.keys() if key.startswith("list:")]
    for key in keys_to_delete:
        del REAGENT_ORDER_CACHE[key]


def _add_specification(item_dict: dict) -> dict:
    """Add computed specification field to order response dict"""
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def get_consumable_order_by_id(db: Session, order_id: int) -> Optional[ConsumableOrder]:
    """Get consumable order by ID"""
    return db.get(ConsumableOrder, order_id)


@router.post("/", response_model=ConsumableOrderResponse, status_code=status.HTTP_201_CREATED)
def create_consumable_order(
    order: ConsumableOrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new consumable order"""
    # Parse specification to get initial_quantity and unit
    try:
        initial_quantity, unit = parse_specification(order.specification)
    except SpecificationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid specification format: {e}"
        )
    
    # 计算拼音字段
    pinyin_fields = compute_pinyin_fields(name=order.name)

    # Create order
    db_order = ConsumableOrder(
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
    
    return db_order


@router.post("/{order_id}/upload-image")
async def upload_consumable_order_image(
    order_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload and compress image for a consumable order"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    try:
        image_url, thumbnail_url = process_uploaded_image(file)
        
        order.image_path = thumbnail_url
        db.commit()
        db.refresh(order)
        
        return {
            "message": "Image uploaded successfully",
            "image_url": image_url,
            "thumbnail_url": thumbnail_url
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/")
def list_consumable_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[ConsumableOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List consumable orders with optional filters, pagination, search, sort and applicant name"""
    # 生成缓存key（包含所有搜索参数，包括分页和排序）
    cache_key = f"list:{skip}:{limit}:{search or ''}:{status_filter or ''}:{search_field or ''}:{fuzzy}:{sort_by or ''}:{sort_order or ''}"

    # 尝试从缓存获取（仅当是第一页且无搜索条件时）
    is_first_page = skip == 0
    has_search = bool(search or status_filter or sort_by)
    should_use_cache = is_first_page and not has_search

    if should_use_cache:
        cached = _get_cached_result(cache_key)
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    base = select(ConsumableOrder)

    if status_filter:
        base = base.where(ConsumableOrder.status == status_filter)

    # 搜索处理
    if search:
        if fuzzy:
            # 模糊搜索：标准化搜索词
            search_normalized = search.strip().replace(" ", "").replace("-", "").replace("_", "")

            from sqlmodel import func as sql_func

            def norm_field(field):
                f = sql_func.replace(field, '-', '')
                f = sql_func.replace(f, ' ', '')
                f = sql_func.replace(f, '\u00A0', '')
                f = sql_func.replace(f, '\u2002', '')
                f = sql_func.replace(f, '\u2003', '')
                f = sql_func.replace(f, '\u2009', '')
                f = sql_func.replace(f, '\u200C', '')
                f = sql_func.replace(f, '\u200D', '')
                f = sql_func.replace(f, '_', '')
                return f

            base = base.where(
                (norm_field(ConsumableOrder.name).ilike(f"%{search_normalized}%")) |
                (norm_field(ConsumableOrder.brand).ilike(f"%{search_normalized}%")) |
                (norm_field(ConsumableOrder.category).ilike(f"%{search_normalized}%"))
            )
        else:
            search_pattern = f"%{search}%"

            if search_field and search_field != 'all':
                field_map = {
                    'name': ConsumableOrder.name,
                    'category': ConsumableOrder.category,
                    'brand': ConsumableOrder.brand,
                }
                if search_field in field_map:
                    base = base.where(field_map[search_field].ilike(search_pattern))
                else:
                    base = base.where(
                        (ConsumableOrder.name.ilike(search_pattern)) |
                        (ConsumableOrder.category.ilike(search_pattern)) |
                        (ConsumableOrder.brand.ilike(search_pattern))
                    )
            else:
                base = base.where(
                    (ConsumableOrder.name.ilike(search_pattern)) |
                    (ConsumableOrder.category.ilike(search_pattern)) |
                    (ConsumableOrder.brand.ilike(search_pattern))
                )

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

    # 排序处理
    sort_field_map = {
        'name': ConsumableOrder.name,
        'name_pinyin': ConsumableOrder.name_pinyin,
        'category': ConsumableOrder.category,
        'brand': ConsumableOrder.brand,
        'quantity': ConsumableOrder.quantity,
        'price': ConsumableOrder.price,
        'status': ConsumableOrder.status,
        'created_at': ConsumableOrder.created_at,
        'updated_at': ConsumableOrder.updated_at,
    }

    order_direction = sort_order.lower() if sort_order else 'desc'
    order_column = sort_field_map.get(sort_by, ConsumableOrder.created_at)

    if order_direction == 'asc':
        order_expr = order_column.asc()
    else:
        order_expr = order_column.desc()

    secondary_order = ConsumableOrder.created_at.desc()

    orders = db.exec(base.order_by(order_expr, secondary_order).offset(skip).limit(limit)).all()

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
        _set_cached_result(cache_key, cache_data)

    return result


# --- Export ---

@router.get("/export")
def export_consumable_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Export consumable orders as a downloadable CSV file."""
    statement = select(ConsumableOrder).order_by(ConsumableOrder.created_at.desc())
    orders = db.exec(statement).all()

    # 查询所有申请人ID用于导出
    all_applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    all_users_map = batch_get_user_names(db, all_applicant_ids)

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)

    writer.writerow([
        "名称", "英文名", "别名", "分类", "品牌",
        "规格", "数量", "单价", "申购原因", "状态",
        "是否危险品", "申请人", "申购时间", "备注",
    ])

    for order in orders:
        # 使用公共函数格式化规格
        spec = format_specification(order.initial_quantity, order.unit)
        writer.writerow([
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
    filename = f"consumable_orders_export_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{order_id}", response_model=ConsumableOrderResponse)
def get_consumable_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get consumable order by ID"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    return order


@router.put("/{order_id}", response_model=ConsumableOrderResponse)
def update_consumable_order(
    order_id: int,
    order_update: ConsumableOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update consumable order information"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    update_data = order_update.model_dump(exclude_unset=True)
    
    # 如果更新了 name，重新计算拼音字段
    if "name" in update_data:
        name = update_data.get("name")
        pinyin_fields = compute_pinyin_fields(name=name)
        update_data.update(pinyin_fields)
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/approve")
def approve_consumable_order(
    order_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Approve a consumable order (Admin only)"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    if order.status != ConsumableOrderStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve order with status: {order.status}"
        )
    
    order.status = ConsumableOrderStatus.APPROVED
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/reject")
def reject_consumable_order(
    order_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reject a consumable order (Admin only). Does not modify notes."""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    order.status = ConsumableOrderStatus.REJECTED
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/complete")
def complete_consumable_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Complete consumable order (consumables don't need stock-in)
    Only order applicant or admin can complete.
    """
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
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
    
    return {
        "message": "耗材订单已完成",
        "order_id": order.id,
        "status": order.status
    }


@router.get("/dashboard/my-orders")
def get_my_consumable_orders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
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
            "specification": format_specification(order.initial_quantity, order.unit),
            "quantity": order.quantity,
            "price": order.price,
            "is_hazardous": order.is_hazardous,
            "notes": order.notes,
            "order_reason": order.order_reason,
            "created_at": order.created_at,
            "updated_at": order.updated_at
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a consumable order (only applicant or admin can delete)"""
    order = get_consumable_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
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
