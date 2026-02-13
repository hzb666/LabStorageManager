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
    OrderReason,
)
from app.models.user import User
from app.models.inventory import Inventory, InventoryCreate, InventoryStatus
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.image_service import process_uploaded_image
from app.services.spec_utils import parse_specification
from app.services.internal_code import generate_internal_code

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
        order_reason=order.order_reason,
        location=order.location,
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


@router.post("/{order_id}/confirm-arrival")
def confirm_arrival(
    order_id: int,
    arrival_notes: Optional[str] = None,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """
    Confirm order has arrived (but not yet stocked in).
    Changes status from APPROVED to ARRIVED.
    """
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    if order.status != OrderStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot confirm arrival for order with status: {order.status}. Order must be APPROVED first."
        )
    
    order.status = OrderStatus.ARRIVED
    if arrival_notes:
        order.notes = arrival_notes
    order.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(order)
    
    return {
        "message": "Arrival confirmed successfully",
        "order_id": order.id,
        "status": order.status,
        "notes": order.notes
    }


@router.get("/dashboard/arrived-orders")
def get_arrived_orders(
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """
    Get all orders that have arrived but not yet stocked in.
    Used for stock-in assignment workflow.
    """
    statement = select(Order).where(
        Order.status == OrderStatus.ARRIVED
    ).order_by(Order.updated_at.desc())
    
    orders = db.exec(statement).all()
    
    return {
        "data": [
            {
                "order_id": order.id,
                "cas_number": order.cas_number,
                "name": order.name,
                "specification": order.specification,
                "quantity": order.quantity,
                "is_hazardous": order.is_hazardous,
                "location": order.location,
                "notes": order.notes,
                "arrived_at": order.updated_at
            }
            for order in orders
        ],
        "total": len(orders)
    }


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


@router.post("/{order_id}/stock-in", response_model=dict)
def stock_in_order(
    order_id: int,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
    # current_user: User = Depends(get_current_user)
):
    """
    Stock-in order: Convert Order to Inventory items.
    - Copy data from Order to Inventory (not move,保留Order用于审计)
    - Generate N Inventory items (N = order.quantity)
    - Update order status to STOCKED
    """
    order = get_order_by_id(db, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    # Only reagent orders can be stocked in
    if order.type.value != "reagent":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only reagent orders can be stocked in"
        )
    
    # Order must be in ARRIVED status (after physical arrival confirmation)
    if order.status != OrderStatus.ARRIVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order must be in ARRIVED status to stock in, current: {order.status}. Please confirm arrival first."
        )
    
    # Parse specification to get value and unit
    per_bottle_value, unit = parse_specification(order.specification)
    
    # Generate internal codes
    internal_codes = generate_internal_code(db, order.cas_number, order.quantity)
    
    # Get current user ID for temporary keeper
    # current_user.id if auth enabled
    current_user_id = 1  # Temporary for Phase 1
    
    # Determine location and temporary keeper
    location = order.location
    temporary_keeper_id = None if location else current_user_id
    
    # Create Inventory items
    inventory_items = []
    for internal_code in internal_codes:
        inv = Inventory(
            internal_code=internal_code,
            cas_number=order.cas_number,
            name=order.name,
            alias=order.alias,
            location=location,
            initial_quantity=per_bottle_value,
            remaining_quantity=per_bottle_value,
            unit=unit,
            is_hazardous=order.is_hazardous,
            image_path=order.image_path,
            status=InventoryStatus.IN_STOCK,
            temporary_keeper_id=temporary_keeper_id,
            notes=order.notes,  # Copy notes from Order
        )
        db.add(inv)
        inventory_items.append(inv)
    
    # Update order status
    order.status = OrderStatus.STOCKED
    order.updated_at = datetime.utcnow()
    
    db.commit()
    
    # Refresh to get IDs
    for item in inventory_items:
        db.refresh(item)
    
    return {
        "message": "Stock-in successful",
        "order_id": order.id,
        "items_created": len(inventory_items),
        "inventory_ids": [item.id for item in inventory_items],
        "temporary_keeper_cleared": temporary_keeper_id is not None
    }

