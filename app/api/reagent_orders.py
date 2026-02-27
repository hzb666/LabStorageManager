"""
Reagent Order API Routes - Reagent Purchase Order Management
Separated from Consumable orders for independent workflow
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.database import get_db
from app.core.auth import get_current_user, require_admin
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
from app.services.spec_utils import parse_specification, SpecificationError
from app.services.internal_code import generate_internal_code
from app.services.pinyin_utils import compute_pinyin_fields

router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])


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
    
    # Create order
    db_order = ReagentOrder(
        cas_number=normalized_cas,
        name=order.name,
        english_name=order.english_name,
        alias=order.alias,
        category=order.category,
        brand=order.brand,
        specification=order.specification,
        quantity=order.quantity,
        price=order.price,
        order_reason=order.order_reason,
        is_hazardous=order.is_hazardous,
        applicant_id=current_user.id,
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


@router.get("/")
def list_reagent_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[ReagentOrderStatus] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List reagent orders with optional filters, pagination, and applicant name"""
    base = select(ReagentOrder)

    if status_filter:
        base = base.where(ReagentOrder.status == status_filter)

    total = db.exec(select(func.count()).select_from(base.subquery())).one()
    orders = db.exec(base.order_by(ReagentOrder.created_at.desc()).offset(skip).limit(limit)).all()

    # Enrich with applicant names
    applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    users_map: dict[int, str] = {}
    if applicant_ids:
        users = db.exec(select(User).where(User.id.in_(applicant_ids))).all()
        users_map = {u.id: u.full_name or u.username for u in users}

    return {
        "data": [
            {**ReagentOrderResponse.model_validate(o).model_dump(), "applicant_name": users_map.get(o.applicant_id, "")}
            for o in orders
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


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
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
                "specification": order.specification,
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
            "specification": order.specification,
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
    
    # Parse specification to get value and unit
    try:
        per_bottle_value, unit = parse_specification(order.specification)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
