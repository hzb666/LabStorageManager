"""Common shelf creation helpers."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.chemical_name_map import ChemicalNameMap
from app.models.common_shelf import CommonShelf, CommonShelfGroup, CommonShelfManualCreate
from app.models.reagent_order import ReagentOrder
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.internal_code import (
    INTERNAL_CODE_CONFLICT_MAX_RETRIES,
    generate_internal_code,
    is_internal_code_unique_violation,
)
from app.services.common_shelf_group_records import (
    ensure_active_common_shelf_group,
    is_common_shelf_group_identity_violation,
)
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.spec_utils import SpecificationError, UNIT_CANONICAL, format_specification, parse_specification
from app.services.shelf_utils import normalize_storage_location

_DECIMAL_1000 = Decimal("1000")
_DECIMAL_1000000 = Decimal("1000000")


def normalize_brand_for_group(brand: Optional[str]) -> str:
    """Normalize brand for group key comparison."""
    return (brand or "").strip().casefold()


def require_common_shelf_brand(brand: Optional[str]) -> str:
    """Return a non-empty brand for common shelf writes."""
    normalized_brand = (brand or "").strip()
    if not normalized_brand:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")
    return normalized_brand


def normalize_storage_for_group(storage_location: Optional[str]) -> Optional[str]:
    """Normalize storage location for group key comparison."""
    normalized = normalize_storage_location(storage_location)
    if normalized is None:
        return None
    return normalized.casefold()


def _decimal_from_float(value: Optional[float]) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _format_decimal_number(value: Decimal) -> str:
    normalized = value.normalize()
    number = format(normalized, "f")
    if "." in number:
        number = number.rstrip("0").rstrip(".")
    return number or "0"


def normalize_specification_for_group(
    quantity: Optional[float],
    unit: Optional[str],
) -> tuple[float, str, str, str]:
    """Normalize quantity/unit into stable group key and display text."""
    decimal_quantity = _decimal_from_float(quantity)
    if decimal_quantity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid specification quantity",
        )

    raw_unit = (unit or "").strip()
    if not raw_unit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Specification unit is required",
        )

    canonical_unit = UNIT_CANONICAL.get(raw_unit.lower(), raw_unit)
    unit_lower = canonical_unit.lower()
    converted_value = decimal_quantity
    display_unit = canonical_unit

    if unit_lower in {"ml", "l"}:
        ml_value = decimal_quantity if unit_lower == "ml" else decimal_quantity * _DECIMAL_1000
        if ml_value < _DECIMAL_1000:
            converted_value = ml_value
            display_unit = "mL"
        else:
            converted_value = ml_value / _DECIMAL_1000
            display_unit = "L"
    elif unit_lower in {"mg", "g", "kg"}:
        mg_value = decimal_quantity
        if unit_lower == "g":
            mg_value = decimal_quantity * _DECIMAL_1000
        elif unit_lower == "kg":
            mg_value = decimal_quantity * _DECIMAL_1000000

        if mg_value < _DECIMAL_1000:
            converted_value = mg_value
            display_unit = "mg"
        elif mg_value < _DECIMAL_1000000:
            converted_value = mg_value / _DECIMAL_1000
            display_unit = "g"
        else:
            converted_value = mg_value / _DECIMAL_1000000
            display_unit = "kg"

    normalized_quantity = float(converted_value)
    specification_normalized = f"{_format_decimal_number(converted_value)}|{display_unit.casefold()}"
    specification_text = format_specification(normalized_quantity, display_unit)
    if specification_text is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid specification",
        )
    return normalized_quantity, display_unit, specification_normalized, specification_text


def _create_common_shelf_rows(
    db: Session,
    *,
    cas_number: str,
    name_snapshot: str,
    brand: Optional[str],
    purity: Optional[str],
    spec_quantity: float,
    spec_unit: str,
    quantity_bottles: int,
    storage_location: Optional[str],
    notes: Optional[str],
    source_order_id: Optional[int],
    created_by_id: int,
) -> list[CommonShelf]:
    normalized_snapshot = (name_snapshot or "").strip()
    if not normalized_snapshot:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name_snapshot is required")

    cas_mapping_id = db.exec(
        select(ChemicalNameMap.id).where(ChemicalNameMap.cas_number == cas_number).limit(1)
    ).first()
    if cas_mapping_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CAS master data not found",
        )

    normalized_brand = require_common_shelf_brand(brand)
    brand_normalized = normalize_brand_for_group(normalized_brand)
    storage_location_normalized = normalize_storage_for_group(storage_location)
    pinyin_fields = compute_pinyin_fields(storage_location=storage_location)
    normalized_purity = (purity or "").strip()[:20] or None
    normalized_notes = (notes or "").strip()[:100] or None
    normalized_quantity, normalized_unit, specification_normalized, specification_text = (
        normalize_specification_for_group(spec_quantity, spec_unit)
    )

    for attempt in range(INTERNAL_CODE_CONFLICT_MAX_RETRIES):
        try:
            internal_codes = generate_internal_code(db, cas_number, quantity_bottles)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        created_items: list[CommonShelf] = []
        try:
            with db.begin_nested():
                # Savepoint 回滚只影响当前批次，外层到货确认更新不受影响。
                ensure_active_common_shelf_group(
                    db,
                    cas_number=cas_number,
                    name_snapshot=normalized_snapshot,
                    brand=normalized_brand,
                    brand_normalized=brand_normalized,
                    specification_text=specification_text,
                    spec_quantity=normalized_quantity,
                    spec_unit=normalized_unit,
                    specification_normalized=specification_normalized,
                    created_by_id=created_by_id,
                )
                for internal_code in internal_codes:
                    row = CommonShelf(
                        internal_code=internal_code,
                        cas_number=cas_number,
                        name_snapshot=normalized_snapshot,
                        brand=normalized_brand,
                        brand_normalized=brand_normalized,
                        purity=normalized_purity,
                        specification_text=specification_text,
                        spec_quantity=normalized_quantity,
                        spec_unit=normalized_unit,
                        specification_normalized=specification_normalized,
                        storage_location=storage_location,
                        storage_location_normalized=storage_location_normalized,
                        storage_location_pinyin=pinyin_fields.get("storage_location_pinyin"),
                        storage_location_pinyin_initials=pinyin_fields.get(
                            "storage_location_pinyin_initials"
                        ),
                        notes=normalized_notes,
                        source_order_id=source_order_id,
                        created_by_id=created_by_id,
                    )
                    db.add(row)
                    created_items.append(row)
                db.flush()
            return created_items
        except IntegrityError as exc:
            if is_common_shelf_group_identity_violation(exc):
                if attempt == INTERNAL_CODE_CONFLICT_MAX_RETRIES - 1:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="常用货架分组正在被并发创建，请重试",
                    ) from exc
                continue
            if not is_internal_code_unique_violation(exc):
                raise
            if attempt == INTERNAL_CODE_CONFLICT_MAX_RETRIES - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="常用货架内部编码冲突，请重试",
                ) from exc

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="常用货架内部编码冲突，请重试")


def create_common_shelf_items_from_order(
    db: Session,
    order: ReagentOrder,
    *,
    created_by_id: int,
    storage_location: Optional[str],
) -> list[CommonShelf]:
    """Create common shelf rows from a common-public reagent order."""
    if order.quantity is None or order.quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order quantity")
    if order.initial_quantity is None or order.unit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order missing initial_quantity or unit. Please update the order.",
        )
    normalized_cas = normalize_cas(order.cas_number)
    is_valid, error_msg = validate_cas_format(normalized_cas)
    if not normalized_cas or not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")

    return _create_common_shelf_rows(
        db,
        cas_number=normalized_cas,
        name_snapshot=order.name,
        brand=order.brand,
        purity=order.purity,
        spec_quantity=order.initial_quantity,
        spec_unit=order.unit,
        quantity_bottles=order.quantity,
        storage_location=normalize_storage_location(storage_location),
        notes=order.notes,
        source_order_id=order.id,
        created_by_id=created_by_id,
    )


def create_manual_common_shelf_items(
    db: Session,
    item_data: CommonShelfManualCreate,
    *,
    created_by_id: int,
) -> list[CommonShelf]:
    """Create common shelf rows from manual add input."""
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

    normalized_storage_location = normalize_storage_location(item_data.storage_location)
    normalized_brand = require_common_shelf_brand(item_data.brand)
    normalized_purity = (item_data.purity or "").strip() or None
    normalized_notes = (item_data.notes or "").strip() or None

    return _create_common_shelf_rows(
        db,
        cas_number=normalized_cas,
        name_snapshot=item_data.name_snapshot.strip(),
        brand=normalized_brand,
        purity=normalized_purity,
        spec_quantity=per_bottle_value,
        spec_unit=unit,
        quantity_bottles=item_data.count,
        storage_location=normalized_storage_location,
        notes=normalized_notes,
        source_order_id=None,
        created_by_id=created_by_id,
    )


def create_common_shelf_items_for_group_record(
    db: Session,
    group: CommonShelfGroup,
    *,
    count: int,
    storage_location: Optional[str],
    purity: Optional[str],
    notes: Optional[str],
    created_by_id: int,
) -> list[CommonShelf]:
    """Create more bottles by copying a persistent common shelf group."""
    if count <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="count must be greater than 0")

    return _create_common_shelf_rows(
        db,
        cas_number=group.cas_number,
        name_snapshot=group.name_snapshot,
        brand=group.brand,
        purity=purity,
        spec_quantity=group.spec_quantity,
        spec_unit=group.spec_unit,
        quantity_bottles=count,
        storage_location=normalize_storage_location(storage_location),
        notes=notes,
        source_order_id=None,
        created_by_id=created_by_id,
    )
