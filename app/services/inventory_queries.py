"""Centralized inventory query entrypoints for regular inventory."""

from sqlmodel import Session, select

from app.models.inventory import Inventory


def regular_inventory_query():
    """Base query for regular inventory."""
    return select(Inventory)


def get_regular_inventory_by_id(db: Session, inventory_id: int) -> Inventory | None:
    """Fetch one regular inventory item by id."""
    return db.exec(regular_inventory_query().where(Inventory.id == inventory_id)).first()
