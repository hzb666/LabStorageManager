"""
Inventory API Routes - Stock Management
Critical Rule #2: CAS Number normalization (data copied from Order)
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlmodel import Session, select, func
import csv
import io
import os
import tempfile

from app.database import get_db
from app.models.inventory import (
    Inventory,
    InventoryCreate,
    InventoryUpdate,
    InventoryResponse,
    InventoryStatus,
    InventoryBorrowReturn,
    BorrowLog,
    BorrowLogResponse,
    ManualInventoryCreate,
)
from app.models.user import User
from app.core.auth import get_current_user, require_admin
from app.services.cas_utils import normalize_cas
from app.services.internal_code import generate_internal_code
from app.services.spec_utils import parse_specification, SpecificationError

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def get_inventory_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Get inventory item by ID"""
    return db.get(Inventory, inventory_id)


def get_inventory_by_code(db: Session, code: str) -> Optional[Inventory]:
    """Get inventory item by internal code"""
    statement = select(Inventory).where(Inventory.internal_code == code)
    return db.exec(statement).first()


@router.get("/cas/{cas_number}")
def check_cas_inventory(
    cas_number: str,
    db: Session = Depends(get_db)
):
    """
    Check CAS number inventory status.
    Returns all inventory items with this CAS number.
    Used for CAS check feature when creating orders.
    """
    normalized_cas = normalize_cas(cas_number)
    
    # Get all inventory items for this CAS
    statement = select(Inventory).where(
        Inventory.cas_number == normalized_cas,
        Inventory.status != InventoryStatus.CONSUMED
    ).order_by(Inventory.created_at.desc())
    
    items = db.exec(statement).all()
    
    # Calculate totals
    total_remaining = sum(item.remaining_quantity for item in items)
    borrowed_count = len([item for item in items if item.status == InventoryStatus.BORROWED])
    in_stock_count = len([item for item in items if item.status == InventoryStatus.IN_STOCK])
    
    return {
        "cas_number": normalized_cas,
        "exists_in_inventory": len(items) > 0,
        "total_remaining": total_remaining,
        "in_stock_count": in_stock_count,
        "borrowed_count": borrowed_count,
        "items": [
            {
                "id": item.id,
                "internal_code": item.internal_code,
                "name": item.name,
                "location": item.location,
                "remaining_quantity": item.remaining_quantity,
                "unit": item.unit,
                "status": item.status,
                "borrower_id": item.borrower_id
            }
            for item in items
        ]
    }


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
def get_inventory_by_internal_code(internal_code: str, db: Session = Depends(get_db)):
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Borrow an inventory item.
    Creates BorrowLog record and updates item status.
    """
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
    
    # Create BorrowLog record
    borrow_log = BorrowLog(
        inventory_id=inventory_id,
        borrower_id=current_user.id,
        borrow_time=datetime.now(timezone.utc),
        quantity_borrowed=item.remaining_quantity,
        quantity_returned=None,
        notes=None
    )
    db.add(borrow_log)
    
    # Update item
    item.status = InventoryStatus.BORROWED
    item.borrower_id = current_user.id
    item.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(item)
    
    return item


@router.post("/{inventory_id}/return", response_model=dict)
def return_item(
    inventory_id: int,
    return_data: InventoryBorrowReturn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Return a borrowed inventory item.
    Updates BorrowLog record and item status.
    Returns low quantity warning if remaining < 20%.
    """
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    if item.status != InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is not borrowed, current status: {item.status}"
        )
    
    # Verify the current user is the borrower
    if item.borrower_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the borrower of this item"
        )
    
    # Update BorrowLog record
    borrow_log_statement = select(BorrowLog).where(
        BorrowLog.inventory_id == inventory_id,
        BorrowLog.return_time.is_(None)
    ).order_by(BorrowLog.borrow_time.desc())
    
    borrow_log = db.exec(borrow_log_statement).first()
    
    if borrow_log:
        borrow_log.return_time = datetime.now(timezone.utc)
        borrow_log.quantity_returned = return_data.remaining_quantity
        borrow_log.notes = return_data.unit  # Store unit in notes if provided
    
    # Update item
    previous_quantity = item.remaining_quantity
    item.remaining_quantity = return_data.remaining_quantity
    item.unit = return_data.unit if return_data.unit else item.unit
    item.last_borrower_id = item.borrower_id
    item.borrower_id = None
    
    # Check for low quantity warning
    low_quantity_warning = None
    if return_data.remaining_quantity > 0:
        item.status = InventoryStatus.IN_STOCK
        percentage = (return_data.remaining_quantity / item.initial_quantity) * 100
        if percentage < 20:
            low_quantity_warning = f"剩余量仅剩 {percentage:.1f}%，请及时补充"
    else:
        item.status = InventoryStatus.CONSUMED
    
    item.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(item)
    
    result = item.model_dump()
    if low_quantity_warning:
        result["warning"] = low_quantity_warning
    
    return result


@router.put("/{inventory_id}", response_model=InventoryResponse)
def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    
    item.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(item)
    
    return item


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory(
    inventory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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


@router.get("/export")
def export_inventory(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Export inventory items to CSV format.
    Returns CSV data for download.
    """
    statement = select(Inventory).order_by(Inventory.created_at.desc())
    items = db.exec(statement).all()
    
    # Build CSV content
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow([
        "编号", "CAS号", "名称", "英文名", "别名", "分类", "品牌",
        "位置", "初始数量", "剩余数量", "单位", "状态",
        "是否危险品", "单价", "入库时间", "备注"
    ])
    
    # Data rows
    for item in items:
        writer.writerow([
            item.internal_code,
            item.cas_number,
            item.name,
            item.english_name or "",
            item.alias or "",
            item.category or "",
            item.brand or "",
            item.location or "",
            item.initial_quantity,
            item.remaining_quantity,
            item.unit,
            item.status.value if hasattr(item.status, 'value') else item.status,
            "是" if item.is_hazardous else "否",
            item.price if item.price is not None else "",
            item.created_at.strftime("%Y-%m-%d %H:%M:%S") if item.created_at else "",
            item.notes or ""
        ])
    
    return {
        "data": output.getvalue(),
        "filename": f"inventory_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv",
        "count": len(items)
    }


@router.post("/manual-add", response_model=dict)
def manual_add_inventory(
    item_data: ManualInventoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Manually add inventory items without going through the order process.
    Useful for adding reagents that were purchased outside the system.
    Creates N items where N = quantity_bottles.
    """
    # Normalize CAS number
    normalized_cas = normalize_cas(item_data.cas_number)

    # Validate CAS format
    if not normalized_cas or len(normalized_cas.split("-")) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CAS format"
        )

    # Parse specification (e.g., "500ml" -> (500, "ml"))
    try:
        per_bottle_value, unit = parse_specification(item_data.specification)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Generate internal codes for all bottles
    internal_codes = generate_internal_code(db, normalized_cas, item_data.quantity_bottles)

    # Create inventory items (one per bottle)
    created_items = []

    for internal_code in internal_codes:
        db_inventory = Inventory(
            internal_code=internal_code,
            cas_number=normalized_cas,
            name=item_data.name,
            alias=item_data.alias,
            location=item_data.location,
            initial_quantity=per_bottle_value,
            remaining_quantity=per_bottle_value,
            unit=unit,
            is_hazardous=item_data.is_hazardous,
            notes=item_data.notes,
            status=InventoryStatus.IN_STOCK,
        )

        db.add(db_inventory)
        created_items.append(db_inventory)

    db.commit()

    # Refresh all created items
    for item in created_items:
        db.refresh(item)

    return {
        "message": "Manual stock-in successful",
        "items_created": len(created_items),
        "item_ids": [item.id for item in created_items],
        "internal_codes": [item.internal_code for item in created_items]
    }


# ==================== Dashboard APIs ====================

@router.get("/dashboard/my-borrows")
def get_my_borrows(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get items borrowed by current user.
    Returns items where status == borrowed and borrower_id == current user.
    """
    statement = select(Inventory).where(
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.borrower_id == current_user.id
    ).order_by(Inventory.updated_at.desc())
    
    items = db.exec(statement).all()
    
    # Calculate borrow duration
    now = datetime.now(timezone.utc)
    
    return {
        "data": [
            {
                "inventory_id": item.id,
                "internal_code": item.internal_code,
                "name": item.name,
                "cas_number": item.cas_number,
                "remaining_quantity": item.remaining_quantity,
                "unit": item.unit,
                "borrow_time": item.updated_at,
                "borrow_days": (now - item.updated_at).days if item.updated_at else 0,
                "is_overdue": ((now - item.updated_at).days > 3) if item.updated_at else False
            }
            for item in items
        ],
        "total": len(items),
        "overdue_count": sum(1 for item in items if item.updated_at and (now - item.updated_at).days > 3)
    }


@router.get("/dashboard/pending-stockin")
def get_pending_stockin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get items pending stock-in location assignment.
    Returns items where location IS NULL AND temporary_keeper_id == current user.
    """
    statement = select(Inventory).where(
        Inventory.location == None,
        Inventory.temporary_keeper_id == current_user.id
    ).order_by(Inventory.created_at.desc())
    
    items = db.exec(statement).all()
    
    return {
        "data": [
            {
                "inventory_id": item.id,
                "internal_code": item.internal_code,
                "name": item.name,
                "cas_number": item.cas_number,
                "initial_quantity": item.initial_quantity,
                "unit": item.unit,
                "stockin_time": item.created_at
            }
            for item in items
        ],
        "total": len(items)
    }


@router.get("/{inventory_id}/borrow-history")
def get_borrow_history(
    inventory_id: int,
    db: Session = Depends(get_db)
):
    """
    Get borrow history for an inventory item.
    Returns last 10 borrow records.
    """
    # Verify inventory exists
    item = get_inventory_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found"
        )
    
    statement = select(BorrowLog).where(
        BorrowLog.inventory_id == inventory_id
    ).order_by(BorrowLog.borrow_time.desc()).limit(10)
    
    logs = db.exec(statement).all()
    
    return {
        "inventory_id": inventory_id,
        "internal_code": item.internal_code,
        "name": item.name,
        "history": [
            {
                "id": log.id,
                "borrower_id": log.borrower_id,
                "borrow_time": log.borrow_time,
                "return_time": log.return_time,
                "quantity_borrowed": log.quantity_borrowed,
                "quantity_returned": log.quantity_returned
            }
            for log in logs
        ]
    }


# ==================== Excel Import APIs ====================

@router.get("/import/template")
def get_import_template():
    """
    Get Excel import template structure.
    Returns column definitions for frontend.
    """
    from app.services.excel_service import generate_import_template
    return generate_import_template()


@router.post("/import")
def import_inventory(
    file: UploadFile = File(...),
    default_location: Optional[str] = None,
    default_is_hazardous: bool = False,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Import inventory items from Excel file.
    Only admin can import inventory.
    
    Expected Excel columns:
    - cas_number: CAS号 (required)
    - name: 名称 (required)
    - alias: 别名 (optional)
    - specification: 规格，如 "500ml" (required)
    - initial_quantity: 初始数量 (required)
    - location: 存放位置 (optional)
    - is_hazardous: 是否危险品 (optional)
    - notes: 备注 (optional)
    """
    from app.services.excel_service import import_inventory_from_excel
    
    # Validate file type
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only Excel (.xlsx, .xls) or CSV files (.csv) are supported"
        )
    
    # Save uploaded file to temp location
    with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename) as tmp_file:
        tmp_file.write(file.file.read())
        tmp_file_path = tmp_file.name
    
    try:
        # Import data
        result = import_inventory_from_excel(
            db=db,
            file_path=tmp_file_path,
            default_location=default_location,
            default_is_hazardous=default_is_hazardous,
            user_id=admin_user.id
        )
        
        return {
            "message": "Import completed",
            "success": result["success"],
            "total_rows": result["total_rows"],
            "created": result["created"],
            "errors_count": len(result["errors"]),
            "errors": result["errors"] if result["errors"] else None
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import failed: {str(e)}"
        )
    finally:
        # Clean up temp file
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)

