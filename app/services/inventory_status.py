"""Inventory status rules derived from remaining quantity."""
from __future__ import annotations

from app.core.constants import LOW_STOCK_PERCENT
from app.models.inventory import InventoryStatus

BORROWABLE_INVENTORY_STATUSES = (
    InventoryStatus.IN_STOCK,
    InventoryStatus.RUN_SHORT,
)


def derive_inventory_quantity_status(
    remaining_quantity: float | None,
    initial_quantity: float | None,
) -> InventoryStatus:
    """Derive the persisted quantity status without overriding manual states."""

    if remaining_quantity is not None and remaining_quantity <= 0:
        return InventoryStatus.CONSUMED
    if (
        remaining_quantity is not None
        and initial_quantity is not None
        and initial_quantity > 0
        and remaining_quantity / initial_quantity <= LOW_STOCK_PERCENT
    ):
        return InventoryStatus.RUN_SHORT
    return InventoryStatus.IN_STOCK
