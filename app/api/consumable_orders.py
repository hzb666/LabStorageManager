"""
Consumable Order API Routes - Consumables Purchase Order Management
Separated from Reagent orders (no stock-in needed)
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlmodel import Session, select, func

from app.database import get_db
from app.core.auth import get_current_user, require_admin
from app.models.consumable_order import (
    ConsumableOrder,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
    ConsumableOrderStatus,
)
from app.models.user import User
from app.services.image_service import process_uploaded_image

router = APIRouter(prefix="/consumable-orders", tags=["ConsumableOrders"])


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
    # Create order
    db_order = ConsumableOrder(
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List consumable orders with optional filters, pagination, and applicant name"""
    base = select(ConsumableOrder)

    if status_filter:
        base = base.where(ConsumableOrder.status == status_filter)

    total = db.exec(select(func.count()).select_from(base.subquery())).one()
    orders = db.exec(base.order_by(ConsumableOrder.created_at.desc()).offset(skip).limit(limit)).all()

    # Enrich with applicant names
    applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
    users_map: dict[int, str] = {}
    if applicant_ids:
        from app.models.user import User as UserModel
        users = db.exec(select(UserModel).where(UserModel.id.in_(applicant_ids))).all()
        users_map = {u.id: u.full_name or u.username for u in users}

    return {
        "data": [
            {**ConsumableOrderResponse.model_validate(o).model_dump(), "applicant_name": users_map.get(o.applicant_id, "")}
            for o in orders
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


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
    
    for field, value in update_data.items():
        setattr(order, field, value)
    
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
    order.updated_at = datetime.now(timezone.utc)
    
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
            "specification": order.specification,
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
