"""
Inventory API Routes - Stock Management
Critical Rule #2: CAS Number normalization (data copied from Order)
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select, func

from app.database import get_db
from app.models.inventory import (
    Inventory,
    InventoryCreate,
    InventoryUpdate,
    InventoryResponse,
    InventoryStatus,
    InventoryBorrowReturn,
)
from app.models.order import Order, OrderStatus
from app.services.cas_utils import generate_internal_code, normalize_cas

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def get_inventory_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Get inventory item by ID"""
    return db.get(Inventory, inventory_id)


def get_inventory_by_code(db: Session, code: str) -> Optional[Inventory]:
    """Get inventory item by internal code"""
    statement = select(Inventory).where(Inventory.internal_code == code)
    return db.exec(statement).first()


@router.get("/cas/{cas_number}/total")
def get_cas_total_quantity(
    cas_number: str,
    db: Session = Depends(get_db)
):
    """
    Get total remaining quantity for a CAS number.
    Used for CAS check feature when creating orders.
    
    Critical: Used for duplicate prevention
    """
    normalized_cas = normalize_cas(cas_number)
    
    statement = select(
        func.sum(Inventory.remaining_quantity)
    ).where(
        Inventory.cas_number == normalized_cas,
        Inventory.status != InventoryStatus.CONSUMED
    )
    
    total = db.exec(statement).first()
    
    return {
        "cas_number": normalized_cas,
        "total_remaining": total or 0.0,
        "items_count": 0 if total is None else None  # Can add count query
    }


@router.post("/stock-in/{order_id}", response_model=List[InventoryResponse])
def stock_in_order(
    order_id: int,
    location: str = "默认位置",
    db: Session = Depends(get_db),
    # Critical: current_user should be checked
):
    """
    Stock-in items from an approved order.
    Critical: Creates N inventory items where N = order.quantity (one item per unit).
    Data is copied from Order, not moved (Critical Logic #1).
    """
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    if order.type != "reagent":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only reagent orders can be stocked in"
        )
    
    if order.status != OrderStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order must be approved before stocking. Current status: {order.status}"
        )
    
    # Get next sequence number for this CAS
    cas_prefix = normalize_cas(order.cas_number).split("-")[0]
    statement = select(Inventory).where(
        Inventory.cas_number == order.cas_number
    )
    existing = db.exec(statement).all()
    start_sequence = len(existing) + 1
    
    # Create inventory items (one per unit)
    created_items = []
    
    for i in range(order.quantity):
        internal_code = generate_internal_code(order.cas_number, start_sequence + i)
        
        db_inventory = Inventory(
            internal_code=internal_code,
            cas_number=order.cas_number,  # Copied from Order (already normalized)
            name=order.name,
            alias=order.alias,
            location=location,
            initial_quantity=1.0,  # One unit per item
            remaining_quantity=1.0,
            unit="瓶",  # Default unit
            is_hazardous=order.is_hazardous,
            image_path=order.image_path,  # Copied from Order
        )
        
        db.add(db_inventory)
        created_items.append(db_inventory)
    
    # Update order status
    order.status = OrderStatus.STOCKED
    order.updated_at = datetime.utcnow()
    
    db.commit()
    
    # Refresh all created items
    for item in created_items:
        db.refresh(item)
    
    return created_items


@router.get("/", response_model=List[InventoryResponse])
def list_inventory(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    db: Session = Depends(get_db)
):
    """List inventory with optional filters"""
    statement = select(Inventory)
    
    if status_filter:
        statement = statement.where(Inventory.status == status_filter)
    if cas_filter:
        statement = statement.where(
            Inventory.cas_number == normalize_cas(cas_filter)
        )
    if hazardous_only:
        statement = statement.where(Inventory.is_hazardous == True)
    
    statement = statement.offset(skip).limit(limit).order_by(Inventory.created_at.desc())
    
    return db.exec(statement).all()


@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(inventory_id: int, db: Session = Depends(get_db)):
    """Get inventory item by ID"""
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    return item


@router.get("/code/{internal_code}", response_model=InventoryResponse)
def get_inventory_by_code(internal_code: str, db: Session = Depends(get_db)):
    """Get inventory item by internal code"""
    item = get_inventory_by_code(db, internal_code)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    return item


@router.post("/{inventory_id}/borrow", response_model=InventoryResponse)
def borrow_item(
    inventory_id: int,
    borrow_data: InventoryBorrowReturn,
    # borrower_id: int = Depends(get_current_user),  # Should use actual user
    borrower_id: int = 1,  # Temporary for Phase 1.1
    db: Session = Depends(get_db)
):
    """Borrow an inventory item"""
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    if item.status != InventoryStatus.IN_STOCK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot borrow item with status: {item.status}"
        )
    
    # Update item
    item.status = InventoryStatus.BORROWED
    item.borrower_id = borrower_id
    item.remaining_quantity = borrow_data.remaining_quantity
    item.updated_at = datetime.utcnow()
    
    # Check if fully consumed
    if borrow_data.remaining_quantity <= 0:
        item.status = InventoryStatus.CONSUMED
    
    db.commit()
    db.refresh(item)
    
    return item


@router.post("/{inventory_id}/return", response_model=InventoryResponse)
def return_item(
    inventory_id: int,
    return_data: InventoryBorrowReturn,
    db: Session = Depends(get_db),
    # returner_id: int = Depends(get_current_user),  # Should use actual user
):
    """Return a borrowed inventory item"""
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    # Update item
    if return_data.unit:
        item.unit = return_data.unit
    
    item.remaining_quantity = return_data.remaining_quantity
    item.last_borrower_id = item.borrower_id
    item.borrower_id = None
    item.status = InventoryStatus.IN_STOCK if return_data.remaining_quantity > 0 else InventoryStatus.CONSUMED
    item.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(item)
    
    return item


@router.put("/{inventory_id}", response_model=InventoryResponse)
def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    db: Session = Depends(get_db),
):
    """Update inventory information"""
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    update_data = update.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(item, field, value)
    
    item.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(item)
    
    return item


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory(
    inventory_id: int,
    db: Session = Depends(get_db),
):
    """Delete inventory item (not recommended, prefer status change)"""
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    db.delete(item)
    db.commit()
