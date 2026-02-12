"""
Order API Routes - Purchase Order Management
Critical Rule #2: CAS Number must be normalized before storage
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlmodel import Session, select, func

from app.database import get_db
from app.models.order import (
    Order,
    OrderCreate,
    OrderUpdate,
    OrderResponse,
    OrderStatus,
    OrderType,
)
from app.models.user import User
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.image_service import process_uploaded_image

router = APIRouter(prefix="/orders", tags=["Orders"])


def get_order_by_id(db: Session, order_id: int) -> Optional[Order]:
    """Get order by ID"""
    return db.get(Order, order_id)


@router.post("/", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    order: OrderCreate,
    # Critical: current_user should be checked in production
    # current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new purchase order.
    Critical: CAS Number is normalized automatically.
    """
    # Normalize CAS Number (Critical Rule #2)
    normalized_cas, error = normalize_cas(order.cas_number), None
    is_valid, error = validate_cas_format(normalized_cas)
    
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid CAS format: {error}"
        )
    
    # Create order
    db_order = Order(
        type=order.type,
        cas_number=normalized_cas,
        name=order.name,
        alias=order.alias,
        specification=order.specification,
        quantity=order.quantity,
        is_hazardous=order.is_hazardous,
        # applicant_id=current_user.id,  # Uncomment when auth is enabled
        applicant_id=1,  # Temporary for Phase 1.1
    )
    
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    
    return db_order


@router.post("/{order_id}/upload-image")
async def upload_order_image(
    order_id: int,
    file: UploadFile = File(...),
    # Critical: current_user should be checked
    db: Session = Depends(get_db)
):
    """
    Upload and compress image for an order.
    Critical: Image is compressed to <100KB (Critical Rule #3)
    """
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    try:
        image_url, thumbnail_url = process_uploaded_image(file)
        
        # Update order with image path
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


@router.get("/", response_model=List[OrderResponse])
def list_orders(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[OrderStatus] = None,
    type_filter: Optional[OrderType] = None,
    db: Session = Depends(get_db)
):
    """List orders with optional filters"""
    statement = select(Order)
    
    if status_filter:
        statement = statement.where(Order.status == status_filter)
    if type_filter:
        statement = statement.where(Order.type == type_filter)
    
    statement = statement.offset(skip).limit(limit).order_by(Order.created_at.desc())
    
    return db.exec(statement).all()


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: int, db: Session = Depends(get_db)):
    """Get order by ID"""
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    return order


@router.put("/{order_id}", response_model=OrderResponse)
def update_order(
    order_id: int,
    order_update: OrderUpdate,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """Update order information"""
    order = get_order_by_id(db, order_id)
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
    
    order.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/approve")
def approve_order(
    order_id: int,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
    # current_user: User = Depends(get_current_user)
):
    """Approve an order"""
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    if order.status != OrderStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve order with status: {order.status}"
        )
    
    order.status = OrderStatus.APPROVED
    order.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(order)
    
    return order


@router.post("/{order_id}/reject")
def reject_order(
    order_id: int,
    reason: str = "Order rejected",
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """Reject an order"""
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    order.status = OrderStatus.REJECTED
    order.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(order)
    
    return order


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """Delete an order"""
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    db.delete(order)
    db.commit()
