"""Inventory operation snapshot logging helpers."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from app.models.inventory import Inventory
from app.models.inventory_operation_log import (
    InventoryOperationAction,
    InventoryOperationLog,
)

SNAPSHOT_KEY_MAP = {
    "id": "id",
    "ic": "internal_code",
    "ca": "cas_number",
    "na": "name",
    "en": "english_name",
    "al": "alias",
    "cg": "category",
    "br": "brand",
    "pu": "purity",
    "sl": "storage_location",
    "iq": "initial_quantity",
    "rq": "remaining_quantity",
    "rp": "remaining_percent",
    "un": "unit",
    "hz": "is_hazardous",
    "nt": "notes",
    "st": "status",
    "bi": "borrower_id",
    "lb": "last_borrower_id",
    "tk": "temporary_keeper_id",
    "oi": "source_order_id",
    "cb": "created_by_id",
    "cr": "created_at",
    "up": "updated_at",
    "sc": "source",
    "ct": "count",
    "bf": "before",
    "af": "after",
}

SOURCE_MANUAL_ADD = "manual_add"
SOURCE_ORDER_STOCK_IN = "order_stock_in"
SOURCE_BATCH_IMPORT = "batch_import"


def build_inventory_snapshot(
    inventory: Inventory,
    *,
    source: str | None = None,
) -> dict[str, Any]:
    """Build a stable snapshot payload from the current inventory row."""

    snapshot = {
        "id": inventory.id,
        "ic": inventory.internal_code,
        "ca": inventory.cas_number,
        "na": inventory.name,
        "en": inventory.english_name,
        "al": inventory.alias,
        "cg": inventory.category,
        "br": inventory.brand,
        "pu": inventory.purity,
        "sl": inventory.storage_location,
        "iq": inventory.initial_quantity,
        "rq": inventory.remaining_quantity,
        "rp": inventory.remaining_percent,
        "un": inventory.unit,
        "hz": inventory.is_hazardous,
        "nt": inventory.notes,
        "bi": inventory.borrower_id,
        "lb": inventory.last_borrower_id,
        "tk": inventory.temporary_keeper_id,
        "oi": inventory.source_order_id,
        "cb": inventory.created_by_id,
        "cr": inventory.created_at.isoformat() if inventory.created_at else None,
        "up": inventory.updated_at.isoformat() if inventory.updated_at else None,
    }
    if source:
        snapshot["sc"] = source
    return snapshot


def parse_inventory_snapshot(snapshot_json: str) -> dict[str, Any]:
    """Parse persisted inventory snapshot JSON safely."""

    try:
        parsed = json.loads(snapshot_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    normalized: dict[str, Any] = {}
    for key, value in parsed.items():
        if key in {"bf", "af"} and isinstance(value, dict):
            nested: dict[str, Any] = {}
            for nested_key, nested_value in value.items():
                nested[SNAPSHOT_KEY_MAP.get(nested_key, nested_key)] = nested_value
            normalized[SNAPSHOT_KEY_MAP.get(key, key)] = nested
            continue
        normalized[SNAPSHOT_KEY_MAP.get(key, key)] = value
    return normalized


def _create_inventory_operation_log(
    db: Session,
    *,
    inventory_id: int,
    operator_id: int,
    action: InventoryOperationAction,
    item_name: str,
    cas_number: str,
    snapshot: dict[str, Any],
    notes: str | None = None,
) -> InventoryOperationLog:
    log = InventoryOperationLog(
        inventory_id=inventory_id,
        operator_id=operator_id,
        action=action,
        item_name=item_name,
        cas_number=cas_number,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
        notes=notes,
    )
    db.add(log)
    return log


def log_stock_in(
    db: Session,
    *,
    inventory: Inventory,
    operator_id: int,
    source: str | None = None,
) -> InventoryOperationLog:
    snapshot = build_inventory_snapshot(inventory, source=source)
    return _create_inventory_operation_log(
        db,
        inventory_id=inventory.id or 0,
        operator_id=operator_id,
        action=InventoryOperationAction.STOCK_IN,
        item_name=inventory.name.strip(),
        cas_number=inventory.cas_number,
        snapshot=snapshot,
        notes=inventory.notes,
    )


def log_inventory_delete(
    db: Session,
    *,
    inventory: Inventory,
    operator_id: int,
) -> InventoryOperationLog:
    snapshot = build_inventory_snapshot(inventory)
    return _create_inventory_operation_log(
        db,
        inventory_id=inventory.id or 0,
        operator_id=operator_id,
        action=InventoryOperationAction.INVENTORY_DELETE,
        item_name=inventory.name.strip(),
        cas_number=inventory.cas_number,
        snapshot=snapshot,
        notes=inventory.notes,
    )


def log_inventory_update(
    db: Session,
    *,
    before_inventory: Inventory,
    after_inventory: Inventory,
    operator_id: int,
) -> InventoryOperationLog:
    snapshot = {
        "bf": build_inventory_snapshot(before_inventory),
        "af": build_inventory_snapshot(after_inventory),
    }
    return _create_inventory_operation_log(
        db,
        inventory_id=after_inventory.id or before_inventory.id or 0,
        operator_id=operator_id,
        action=InventoryOperationAction.INVENTORY_UPDATE,
        item_name=after_inventory.name.strip(),
        cas_number=after_inventory.cas_number,
        snapshot=snapshot,
        notes=after_inventory.notes,
    )


def log_inventory_export_operation(
    db: Session,
    *,
    operator_id: int,
    exported_count: int,
) -> InventoryOperationLog:
    """Persist a lightweight export audit log."""

    log = InventoryOperationLog(
        inventory_id=0,
        operator_id=operator_id,
        action=InventoryOperationAction.INVENTORY_EXPORT,
        item_name="库存导出",
        cas_number="",
        snapshot_json=json.dumps({"ct": exported_count}, ensure_ascii=False, sort_keys=True),
        notes=None,
    )
    db.add(log)
    return log
