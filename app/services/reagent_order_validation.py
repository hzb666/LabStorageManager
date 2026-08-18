"""Cross-route validation for reagent order business constraints."""
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.api_errors import ApiErrorCode, api_error
from app.models.chemical_name_map import ChemicalNameMap
from app.models.reagent_order import ReagentOrderReason
from app.services.cas_utils import normalize_cas


COMMON_PUBLIC_MASTER_DATA_ERROR = "Common-public orders require CAS master data"


def has_cas_master_data(db: Session, cas_number: str) -> bool:
    """Return whether the CAS exists in CommonShelf master data."""
    return get_cas_master_data(db, cas_number=cas_number) is not None


def get_cas_master_data(db: Session, *, cas_number: str) -> ChemicalNameMap | None:
    """Return the CAS master row used by common-public order flows."""
    normalized_cas = normalize_cas(cas_number)
    return db.exec(
        select(ChemicalNameMap)
        .where(ChemicalNameMap.cas_number == normalized_cas)
        .limit(1)
    ).first()


def is_common_public_master_data_constraint_error(error: IntegrityError) -> bool:
    """Recognize the SQLite trigger error raised by a concurrent write."""
    return COMMON_PUBLIC_MASTER_DATA_ERROR in str(error)


def raise_common_public_master_data_constraint_error(error: IntegrityError) -> None:
    """Convert a concurrent common-public trigger failure into the API error."""
    if is_common_public_master_data_constraint_error(error):
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            detail=COMMON_PUBLIC_MASTER_DATA_ERROR,
            code=ApiErrorCode.COMMON_PUBLIC_MASTER_DATA_REQUIRED,
        ) from error


def validate_common_public_order_master_data(
    db: Session,
    *,
    cas_number: str,
    order_reason: ReagentOrderReason | None,
) -> None:
    """Require CAS master data before a common-public order can advance."""
    if order_reason != ReagentOrderReason.COMMON_PUBLIC:
        return

    if not has_cas_master_data(db, cas_number):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[
                {
                    "loc": ["body", "order_reason"],
                    "msg": COMMON_PUBLIC_MASTER_DATA_ERROR,
                    "type": "value_error",
                }
            ],
        )


def ensure_common_public_order_master_data(
    db: Session,
    *,
    cas_number: str,
    order_reason: ReagentOrderReason | None,
) -> None:
    """Require CAS master data before a common-public workflow transition."""
    if order_reason != ReagentOrderReason.COMMON_PUBLIC:
        return

    if not has_cas_master_data(db, cas_number):
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            detail=COMMON_PUBLIC_MASTER_DATA_ERROR,
            code=ApiErrorCode.COMMON_PUBLIC_MASTER_DATA_REQUIRED,
        )
