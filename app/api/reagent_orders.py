"""
Reagent Order API Routes - Reagent Purchase Order Management
Separated from Consumable orders for independent workflow
"""
import io
import csv
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.database import get_db
from app.core.auth import get_current_user, require_admin
from app.core.time_utils import get_utc_now
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderCreate,
    ReagentOrderUpdate,
    ReagentOrderResponse,
    ReagentOrderStatus,
    ReagentOrderReason,
)
from app.models.user import User
from app.models.inventory import Inventory, InventoryStatus
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.image_service import process_uploaded_image
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.services.internal_code import generate_internal_code
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.user_utils import batch_get_user_names

router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])

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


class ConfirmArrivalRequest(BaseModel):
    """Body for confirm-arrival action"""
    arrival_notes: Optional[str] = None


def get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    """Get reagent order by ID"""
    return db.get(ReagentOrder, order_id)


@router.post("/", response_model=ReagentOrderResponse, status_code=status.HTTP_201_CREATED)
def create_reagent_order(
    order: ReagentOrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
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
    
    return db_order


@router.post("/{order_id}/upload-image")
async def upload_reagent_order_image(
    order_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload and compress image for a reagent order"""
    order = get_reagent_order_by_id(db, order_id)
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


# 分页限制常量
MAX_PAGE_SIZE = 100

@router.get("/")
def list_reagent_orders(
    skip: int = 0,
    limit: int = min(50, MAX_PAGE_SIZE),
    status_filter: Optional[ReagentOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List reagent orders with optional filters, pagination, search, sort and applicant name"""
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

    base = select(ReagentOrder)

    if status_filter:
        base = base.where(ReagentOrder.status == status_filter)

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
                (norm_field(ReagentOrder.cas_number).ilike(f"%{search_normalized}%")) |
                (norm_field(ReagentOrder.name).ilike(f"%{search_normalized}%")) |
                (norm_field(ReagentOrder.brand).ilike(f"%{search_normalized}%")) |
                (norm_field(ReagentOrder.category).ilike(f"%{search_normalized}%"))
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

    orders = db.exec(base.order_by(order_expr, secondary_order).offset(skip).limit(limit)).all()

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
        _set_cached_result(cache_key, cache_data)

    return result


# --- Export ---

@router.get("/export")
def export_reagent_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update reagent order information"""
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    update_data = order_update.model_dump(exclude_unset=True)
    
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
    
    # 如果更新了 name 或 brand，重新计算拼音字段
    if "name" in update_data or "brand" in update_data:
        name = update_data.get("name", order.name)
        brand = update_data.get("brand", order.brand)
        pinyin_fields = compute_pinyin_fields(name=name, brand=brand)
        update_data.update(pinyin_fields)
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/approve")
def approve_reagent_order(
    order_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Approve a reagent order (Admin only)"""
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    if order.status != ReagentOrderStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve order with status: {order.status}"
        )
    
    order.status = ReagentOrderStatus.APPROVED
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/reject")
def reject_reagent_order(
    order_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reject a reagent order (Admin only). Does not modify notes."""
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    order.status = ReagentOrderStatus.REJECTED
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/confirm-arrival")
def confirm_reagent_arrival(
    order_id: int,
    body: ConfirmArrivalRequest = ConfirmArrivalRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Confirm reagent order has arrived.
    
    Logic:
    - common_public: Complete directly (not stocked in, no notification)
    - other reasons: Status = ARRIVED, needs manual stock-in
    Only order applicant or admin can confirm.
    """
    order = get_reagent_order_by_id(db, order_id)
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
            detail="Only the order applicant or admin can confirm arrival"
        )
    
    if order.status != ReagentOrderStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot confirm arrival for order with status: {order.status}. Order must be APPROVED first."
        )
    
    # Handle based on order reason
    if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
        order.status = ReagentOrderStatus.STOCKED
        message = "常用/公用试剂已入库，无需通知"
    else:
        order.status = ReagentOrderStatus.ARRIVED
        message = "已到货待入库，请及时完成入库操作"
    
    if body.arrival_notes:
        order.notes = body.arrival_notes
    
    db.commit()
    db.refresh(order)
    
    return {
        "message": message,
        "order_id": order.id,
        "status": order.status,
        "notes": order.notes
    }


@router.get("/dashboard/arrived-orders")
def get_arrived_reagent_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all reagent orders that have arrived but not yet stocked in"""
    statement = select(ReagentOrder).where(
        ReagentOrder.status == ReagentOrderStatus.ARRIVED
    ).order_by(ReagentOrder.updated_at.desc())
    
    orders = db.exec(statement).all()
    
    return {
        "data": [
            {
                "order_id": order.id,
                "cas_number": order.cas_number,
                "name": order.name,
                "english_name": order.english_name,
                "specification": format_specification(order.initial_quantity, order.unit),
                "quantity": order.quantity,
                "price": order.price,
                "is_hazardous": order.is_hazardous,
                "notes": order.notes,
                "arrived_at": order.updated_at
            }
            for order in orders
        ],
        "total": len(orders)
    }


@router.get("/dashboard/my-orders")
def get_my_reagent_orders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's reagent order progress"""
    statement = select(ReagentOrder).where(
        ReagentOrder.applicant_id == current_user.id,
        ReagentOrder.status.in_([ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED, ReagentOrderStatus.ARRIVED])
    ).order_by(ReagentOrder.created_at.desc())
    
    orders = db.exec(statement).all()
    
    # Group by status
    pending = []
    approved = []
    arrived = []
    
    for order in orders:
        order_data = {
            "order_id": order.id,
            "cas_number": order.cas_number,
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
        
        if order.status == ReagentOrderStatus.PENDING:
            pending.append(order_data)
        elif order.status == ReagentOrderStatus.APPROVED:
            approved.append(order_data)
        elif order.status == ReagentOrderStatus.ARRIVED:
            arrived.append(order_data)
    
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
            },
            "arrived": {
                "orders": arrived,
                "count": len(arrived),
                "label": "已到货"
            }
        },
        "total": len(orders)
    }


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reagent_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a reagent order (only applicant or admin can delete)"""
    order = get_reagent_order_by_id(db, order_id)
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


@router.post("/{order_id}/stock-in", response_model=dict)
def stock_in_reagent_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Stock-in reagent order: Convert Order to Inventory items.
    - Copy data from Order to Inventory (not move, 保留Order用于审计)
    - Generate N Inventory items (N = order.quantity)
    - Update order status to STOCKED
    """
    order = get_reagent_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    # Block common_public orders from stock-in (they complete via confirm-arrival)
    if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Common/public reagents do not require stock-in. Use confirm-arrival instead."
        )
    
    # Order must be in APPROVED or ARRIVED status
    # APPROVED: "一键入库" skips the confirm-arrival step
    # ARRIVED: normal stock-in after confirm-arrival
    if order.status not in (ReagentOrderStatus.APPROVED, ReagentOrderStatus.ARRIVED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order must be in APPROVED or ARRIVED status to stock in, current: {order.status}."
        )
    
    # For APPROVED status, check permission (same as confirm-arrival)
    if order.status == ReagentOrderStatus.APPROVED:
        from app.models.user import UserRole
        if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the order applicant or admin can stock in"
            )
    
    # Validate quantity
    if order.quantity is None or order.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order quantity"
        )
    
    # Use initial_quantity and unit from order (already parsed during creation)
    if order.initial_quantity is None or order.unit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order missing initial_quantity or unit. Please update the order."
        )
    
    per_bottle_value = order.initial_quantity
    unit = order.unit
    
    # Generate internal codes
    internal_codes = generate_internal_code(db, order.cas_number, order.quantity)
    
    # 自动计算拼音字段
    pinyin_fields = compute_pinyin_fields(
        name=order.name,
        category=order.category,
        brand=order.brand,
        alias=order.alias,
    )
    
    # Create Inventory items
    inventory_items = []
    for internal_code in internal_codes:
        inv = Inventory(
            internal_code=internal_code,
            cas_number=order.cas_number,
            name=order.name,
            english_name=order.english_name,
            alias=order.alias,
            category=order.category,
            brand=order.brand,
            storage_location=None,  # No storage_location in new design
            initial_quantity=per_bottle_value,
            remaining_quantity=per_bottle_value,
            unit=unit,
            is_hazardous=order.is_hazardous,
            image_path=order.image_path,
            status=InventoryStatus.IN_STOCK,
            notes=order.notes,
            **pinyin_fields,
        )
        db.add(inv)
        inventory_items.append(inv)
    
    # Update order status
    order.status = ReagentOrderStatus.STOCKED
    
    db.commit()
    
    # Refresh to get IDs
    for item in inventory_items:
        db.refresh(item)
    
    return {
        "message": "Stock-in successful",
        "order_id": order.id,
        "items_created": len(inventory_items),
        "inventory_ids": [item.id for item in inventory_items]
    }
