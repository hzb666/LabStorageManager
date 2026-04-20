"""Inventory state guards shared by write routes and tests."""
from fastapi import HTTPException, status

from app.models.inventory import Inventory, InventoryStatus

BORROWED_INVENTORY_EDIT_FORBIDDEN_DETAIL = "Cannot edit item while borrowed, please return first"
BORROWED_INVENTORY_DELETE_FORBIDDEN_DETAIL = "Cannot delete item while borrowed, please return first"
PENDING_STOCKIN_EDIT_FORBIDDEN_DETAIL = "Pending stock-in item must be edited through stock-in workflow"
PENDING_STOCKIN_DELETE_FORBIDDEN_DETAIL = "Pending stock-in item cannot be deleted"


def is_pending_stockin_item(item: Inventory) -> bool:
    return item.storage_location is None and item.temporary_keeper_id is not None


def ensure_inventory_editable(item: Inventory) -> None:
    """Reject ordinary inventory edits that would bypass borrow or stock-in workflows."""

    if item.status == InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=BORROWED_INVENTORY_EDIT_FORBIDDEN_DETAIL,
        )
    if is_pending_stockin_item(item):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PENDING_STOCKIN_EDIT_FORBIDDEN_DETAIL,
        )


def ensure_inventory_deletable(item: Inventory) -> None:
    """Reject deletes that would break borrow history or pending stock-in audit chains."""

    if item.status == InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=BORROWED_INVENTORY_DELETE_FORBIDDEN_DETAIL,
        )
    if is_pending_stockin_item(item):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PENDING_STOCKIN_DELETE_FORBIDDEN_DETAIL,
        )
