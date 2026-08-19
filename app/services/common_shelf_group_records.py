"""Persistent common shelf group record helpers."""
from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.time_utils import get_utc_now
from app.models.common_shelf import CommonShelfGroup

_COMMON_SHELF_GROUP_IDENTITY_CONSTRAINT_COLUMNS = (
    "common_shelf_group.cas_number",
    "common_shelf_group.brand_normalized",
    "common_shelf_group.specification_normalized",
)


def is_common_shelf_group_identity_violation(exc: IntegrityError) -> bool:
    """Return true when SQLite rejects a duplicate active group identity."""
    message = str(getattr(exc, "orig", exc)).casefold()
    return "unique constraint failed" in message and all(
        column in message for column in _COMMON_SHELF_GROUP_IDENTITY_CONSTRAINT_COLUMNS
    )


def get_active_common_shelf_group(
    db: Session,
    *,
    cas_number: str,
    brand_normalized: str,
    specification_normalized: str,
) -> CommonShelfGroup | None:
    """Return the active group record for a normalized common-shelf identity."""
    return db.exec(
        select(CommonShelfGroup)
        .where(CommonShelfGroup.cas_number == cas_number)
        .where(CommonShelfGroup.brand_normalized == brand_normalized)
        .where(CommonShelfGroup.specification_normalized == specification_normalized)
        .where(CommonShelfGroup.is_deleted.is_(False))
    ).first()


def ensure_active_common_shelf_group(
    db: Session,
    *,
    cas_number: str,
    name_snapshot: str,
    brand: str | None,
    brand_normalized: str,
    specification_text: str,
    spec_quantity: float,
    spec_unit: str,
    specification_normalized: str,
    created_by_id: int | None,
) -> CommonShelfGroup:
    """Create or refresh an active group identity for a bottle batch."""
    group = get_active_common_shelf_group(
        db,
        cas_number=cas_number,
        brand_normalized=brand_normalized,
        specification_normalized=specification_normalized,
    )
    now = get_utc_now()
    if group is None:
        group = CommonShelfGroup(
            cas_number=cas_number,
            name_snapshot=name_snapshot,
            brand=brand,
            brand_normalized=brand_normalized,
            specification_text=specification_text,
            spec_quantity=spec_quantity,
            spec_unit=spec_unit,
            specification_normalized=specification_normalized,
            created_by_id=created_by_id,
            updated_at=now,
        )
        db.add(group)
        db.flush([group])
        return group

    group.updated_at = now
    group.deleted_at = None
    db.add(group)
    db.flush([group])
    return group


def touch_common_shelf_group(
    db: Session,
    *,
    cas_number: str,
    brand_normalized: str,
    specification_normalized: str,
) -> CommonShelfGroup | None:
    """Refresh group updated_at after bottle-level count or metadata changes."""
    group = get_active_common_shelf_group(
        db,
        cas_number=cas_number,
        brand_normalized=brand_normalized,
        specification_normalized=specification_normalized,
    )
    if group is None:
        return None
    group.updated_at = get_utc_now()
    db.add(group)
    db.flush([group])
    return group


def mark_common_shelf_group_deleted(db: Session, group: CommonShelfGroup) -> None:
    """Soft-delete a group record while hard-deleting its bottle rows elsewhere."""
    now = get_utc_now()
    group.is_deleted = True
    group.deleted_at = now
    group.updated_at = now
    db.add(group)
    db.flush([group])
