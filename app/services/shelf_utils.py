"""Shelf utility helpers for common-shelf business rules."""
from __future__ import annotations

from typing import Optional

from app.models.inventory import Inventory, InventoryStatus


def normalize_storage_location(storage_location: Optional[str]) -> Optional[str]:
    """Normalize storage location input to a clean value or None."""
    if storage_location is None:
        return None
    normalized = storage_location.strip()
    return normalized or None


def is_common_shelf_item(item: Inventory) -> bool:
    """Return whether an inventory row belongs to common shelf.

    Source of truth: inventory.is_common.
    """
    return bool(item.is_common)


def is_common_shelf_available_status(inventory_status: InventoryStatus) -> bool:
    """Availability statuses for common shelf take-one operation."""
    return inventory_status == InventoryStatus.IN_STOCK
