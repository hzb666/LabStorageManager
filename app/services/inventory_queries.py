"""Centralized inventory query entrypoints.

All regular inventory reads should start from ``regular_inventory_query``.
Common-shelf reads should start from ``common_inventory_query``.
"""
from typing import Optional

from sqlmodel import Session, select

from app.models.inventory import Inventory


def regular_inventory_clause():
    """Filter clause for regular inventory (exclude common shelf)."""
    return Inventory.is_common.is_(False)


def common_inventory_clause():
    """Filter clause for common-shelf inventory."""
    return Inventory.is_common.is_(True)


def regular_inventory_query():
    """Base query for regular inventory."""
    return select(Inventory).where(regular_inventory_clause())


def common_inventory_query():
    """Base query for common-shelf inventory."""
    return select(Inventory).where(common_inventory_clause())


def get_regular_inventory_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Fetch one regular inventory item by id."""
    return db.exec(regular_inventory_query().where(Inventory.id == inventory_id)).first()


def get_common_inventory_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Fetch one common-shelf inventory item by id."""
    return db.exec(common_inventory_query().where(Inventory.id == inventory_id)).first()
