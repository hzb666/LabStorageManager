"""Shared inventory item creation helpers."""
from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from fastapi import HTTPException, status

from app.models.inventory import Inventory, InventoryStatus, ManualInventoryCreate
from app.services.api_utils import empty_to_none
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.internal_code import (
    INTERNAL_CODE_CONFLICT_MAX_RETRIES,
    generate_internal_code,
    is_internal_code_unique_violation,
)
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.spec_utils import SpecificationError, parse_specification
from app.services.shelf_utils import normalize_storage_location


def create_manual_inventory_items(
    db: Session,
    item_data: ManualInventoryCreate,
    *,
    created_by_id: int,
) -> list[Inventory]:
    """Create one or more inventory rows from manual stock-in input."""
    normalized_cas = normalize_cas(item_data.cas_number)
    if not normalized_cas:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAS number is required")

    is_valid, error_msg = validate_cas_format(normalized_cas)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")

    try:
        per_bottle_value, unit = parse_specification(item_data.specification)
    except SpecificationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    optional_string_fields = ["storage_location", "category", "brand", "english_name", "alias", "purity", "notes"]
    string_fields = empty_to_none(item_data, optional_string_fields)
    normalized_storage_location = normalize_storage_location(string_fields["storage_location"])
    string_fields["storage_location"] = normalized_storage_location

    pinyin_fields = compute_pinyin_fields(
        name=item_data.name,
        category=item_data.category,
        brand=item_data.brand,
        storage_location=normalized_storage_location,
    )

    for attempt in range(INTERNAL_CODE_CONFLICT_MAX_RETRIES):
        try:
            internal_codes = generate_internal_code(db, normalized_cas, item_data.quantity_bottles)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        created_items: list[Inventory] = []
        try:
            for internal_code in internal_codes:
                db_inventory = Inventory(
                    internal_code=internal_code,
                    cas_number=normalized_cas,
                    name=item_data.name,
                    english_name=string_fields["english_name"],
                    alias=string_fields["alias"],
                    category=string_fields["category"],
                    brand=string_fields["brand"],
                    purity=string_fields["purity"],
                    storage_location=string_fields["storage_location"],
                    initial_quantity=per_bottle_value,
                    remaining_quantity=per_bottle_value,
                    remaining_percent=1,
                    unit=unit,
                    is_hazardous=item_data.is_hazardous,
                    notes=string_fields["notes"],
                    status=InventoryStatus.IN_STOCK,
                    created_by_id=created_by_id,
                    **pinyin_fields,
                )
                db.add(db_inventory)
                created_items.append(db_inventory)

            db.flush()
            return created_items
        except IntegrityError as exc:
            # Full rollback is required here because this path does not use nested savepoints.
            db.rollback()
            if not is_internal_code_unique_violation(exc):
                raise
            if attempt == INTERNAL_CODE_CONFLICT_MAX_RETRIES - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="库存内部编码冲突，请重试入库操作",
                ) from exc

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="库存内部编码冲突，请重试入库操作")
