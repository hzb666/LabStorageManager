"""Common shelf operation snapshot logging helpers."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from app.core.time_utils import utc_iso_str
from app.models.common_shelf import CommonShelf, CommonShelfGroup
from app.models.common_shelf_operation_log import (
    CommonShelfOperationAction,
    CommonShelfOperationLog,
)
from app.services.log_timeline_projection import project_common_shelf_operation_log

SNAPSHOT_KEY_MAP = {
    "id": "id",
    "ic": "internal_code",
    "ca": "cas_number",
    "na": "name_snapshot",
    "br": "brand",
    "bn": "brand_normalized",
    "pu": "purity",
    "st": "specification_text",
    "sq": "spec_quantity",
    "su": "spec_unit",
    "sn": "specification_normalized",
    "sl": "storage_location",
    "sln": "storage_location_normalized",
    "nt": "notes",
    "oi": "source_order_id",
    "cb": "created_by_id",
    "cr": "created_at",
    "up": "updated_at",
    "ct": "count",
    "lc": "location",
    "bf": "before",
    "af": "after",
    "gi": "group_id",
}


def build_common_shelf_snapshot(item: CommonShelf) -> dict[str, Any]:
    """Build a stable snapshot payload from a common shelf row."""
    return {
        "id": item.id,
        "ic": item.internal_code,
        "ca": item.cas_number,
        "na": item.name_snapshot,
        "br": item.brand,
        "bn": item.brand_normalized,
        "pu": item.purity,
        "st": item.specification_text,
        "sq": item.spec_quantity,
        "su": item.spec_unit,
        "sn": item.specification_normalized,
        "sl": item.storage_location,
        "sln": item.storage_location_normalized,
        "nt": item.notes,
        "oi": item.source_order_id,
        "cb": item.created_by_id,
        "cr": utc_iso_str(item.created_at),
        "up": utc_iso_str(item.updated_at),
    }


def build_common_shelf_group_snapshot(group: CommonShelfGroup) -> dict[str, Any]:
    """Build a stable snapshot payload from a common shelf group record."""
    return {
        "id": None,
        "gi": group.id,
        "ic": None,
        "ca": group.cas_number,
        "na": group.name_snapshot,
        "br": group.brand,
        "bn": group.brand_normalized,
        "pu": None,
        "st": group.specification_text,
        "sq": group.spec_quantity,
        "su": group.spec_unit,
        "sn": group.specification_normalized,
        "sl": None,
        "sln": None,
        "nt": None,
        "oi": None,
        "cb": group.created_by_id,
        "cr": utc_iso_str(group.created_at),
        "up": utc_iso_str(group.updated_at),
    }


def _build_common_shelf_entity_snapshot(item: CommonShelf | CommonShelfGroup) -> dict[str, Any]:
    if isinstance(item, CommonShelfGroup):
        return build_common_shelf_group_snapshot(item)
    return build_common_shelf_snapshot(item)


def _resolve_common_shelf_entity_id(item: CommonShelf | CommonShelfGroup) -> int:
    if isinstance(item, CommonShelfGroup):
        return 0
    return item.id or 0


def parse_common_shelf_snapshot(snapshot_json: str) -> dict[str, Any]:
    """Parse persisted common shelf snapshot JSON safely."""
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


def _create_common_shelf_operation_log(
    db: Session,
    *,
    common_shelf_id: int,
    operator_id: int,
    action: CommonShelfOperationAction,
    item_name: str,
    cas_number: str,
    snapshot: dict[str, Any],
    notes: str | None = None,
    is_cli: bool,
) -> CommonShelfOperationLog:
    log = CommonShelfOperationLog(
        common_shelf_id=common_shelf_id,
        operator_id=operator_id,
        action=action,
        item_name=item_name,
        cas_number=cas_number,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
        notes=notes,
    )
    db.add(log)
    db.flush([log])
    project_common_shelf_operation_log(db, log=log, is_cli=is_cli)
    return log


def log_common_shelf_stock_in(
    db: Session,
    *,
    item: CommonShelf,
    operator_id: int,
    is_cli: bool,
) -> CommonShelfOperationLog:
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=item.id or 0,
        operator_id=operator_id,
        action=CommonShelfOperationAction.STOCK_IN,
        item_name=item.name_snapshot,
        cas_number=item.cas_number,
        snapshot=build_common_shelf_snapshot(item),
        notes=item.notes,
        is_cli=is_cli,
    )


def log_common_shelf_add_bottles(
    db: Session,
    *,
    sample_item: CommonShelf | CommonShelfGroup,
    operator_id: int,
    count: int,
    location: str | None,
    is_cli: bool,
) -> CommonShelfOperationLog:
    snapshot = {
        **_build_common_shelf_entity_snapshot(sample_item),
        "ct": count,
        "lc": location,
    }
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=_resolve_common_shelf_entity_id(sample_item),
        operator_id=operator_id,
        action=CommonShelfOperationAction.ADD_BOTTLES,
        item_name=sample_item.name_snapshot,
        cas_number=sample_item.cas_number,
        snapshot=snapshot,
        notes=sample_item.notes if isinstance(sample_item, CommonShelf) else None,
        is_cli=is_cli,
    )


def log_common_shelf_remove_one(
    db: Session,
    *,
    item: CommonShelf,
    operator_id: int,
    is_cli: bool,
) -> CommonShelfOperationLog:
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=item.id or 0,
        operator_id=operator_id,
        action=CommonShelfOperationAction.REMOVE_ONE,
        item_name=item.name_snapshot,
        cas_number=item.cas_number,
        snapshot=build_common_shelf_snapshot(item),
        notes=item.notes,
        is_cli=is_cli,
    )


def log_common_shelf_group_update(
    db: Session,
    *,
    before_item: CommonShelf | CommonShelfGroup,
    after_item: CommonShelf | CommonShelfGroup,
    operator_id: int,
    merged: bool,
    is_cli: bool,
) -> CommonShelfOperationLog:
    snapshot = {
        "bf": _build_common_shelf_entity_snapshot(before_item),
        "af": _build_common_shelf_entity_snapshot(after_item),
    }
    action = (
        CommonShelfOperationAction.MERGE_GROUP
        if merged
        else CommonShelfOperationAction.UPDATE_GROUP
    )
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=_resolve_common_shelf_entity_id(after_item)
        or _resolve_common_shelf_entity_id(before_item),
        operator_id=operator_id,
        action=action,
        item_name=after_item.name_snapshot,
        cas_number=after_item.cas_number,
        snapshot=snapshot,
        notes=after_item.notes if isinstance(after_item, CommonShelf) else None,
        is_cli=is_cli,
    )


def log_common_shelf_item_update(
    db: Session,
    *,
    before_item: CommonShelf,
    after_item: CommonShelf,
    operator_id: int,
    is_cli: bool,
) -> CommonShelfOperationLog:
    """Log one bottle-level field edit from item mode."""
    snapshot = {
        "bf": build_common_shelf_snapshot(before_item),
        "af": build_common_shelf_snapshot(after_item),
    }
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=after_item.id or before_item.id or 0,
        operator_id=operator_id,
        action=CommonShelfOperationAction.UPDATE_ITEM,
        item_name=after_item.name_snapshot,
        cas_number=after_item.cas_number,
        snapshot=snapshot,
        notes=after_item.notes,
        is_cli=is_cli,
    )


def log_common_shelf_group_delete(
    db: Session,
    *,
    operator_id: int,
    is_cli: bool,
    item: CommonShelf | None = None,
    group: CommonShelfGroup | None = None,
    deleted_count: int | None = None,
) -> CommonShelfOperationLog:
    if item is None and group is None:
        raise ValueError("item or group is required")
    source = item or group
    if source is None:
        raise ValueError("item or group is required")
    snapshot = _build_common_shelf_entity_snapshot(source)
    if deleted_count is not None:
        snapshot["ct"] = deleted_count
    return _create_common_shelf_operation_log(
        db,
        common_shelf_id=_resolve_common_shelf_entity_id(source),
        operator_id=operator_id,
        action=CommonShelfOperationAction.DELETE_GROUP,
        item_name=source.name_snapshot,
        cas_number=source.cas_number,
        snapshot=snapshot,
        notes=source.notes if isinstance(source, CommonShelf) else None,
        is_cli=is_cli,
    )


def log_common_shelf_export_operation(
    db: Session,
    *,
    operator_id: int,
    exported_count: int,
    is_cli: bool,
) -> CommonShelfOperationLog:
    log = CommonShelfOperationLog(
        common_shelf_id=0,
        operator_id=operator_id,
        action=CommonShelfOperationAction.EXPORT,
        item_name="常用货架导出",
        cas_number="",
        snapshot_json=json.dumps({"ct": exported_count}, ensure_ascii=False, sort_keys=True),
        notes=None,
    )
    db.add(log)
    db.flush([log])
    project_common_shelf_operation_log(db, log=log, is_cli=is_cli)
    return log
