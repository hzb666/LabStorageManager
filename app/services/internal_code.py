"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-001")
Sequence: Auto-increment per CAS number group, zero-padded to ensure proper sorting
"""
from datetime import datetime
import re

from sqlalchemy import Integer, cast, func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.constants import INTERNAL_CODE_MAX_SEQUENCE, INTERNAL_CODE_SEQUENCE_PAD_WIDTH
from app.core.time_utils import get_utc_now
from app.models.inventory import Inventory

INTERNAL_CODE_CONFLICT_MAX_RETRIES = 3
_INTERNAL_CODE_UNIQUE_CONSTRAINT_MESSAGE = "UNIQUE constraint failed: inventory.internal_code"


def _cas_code_fragment(cas_number: str) -> str:
    """Return CAS fragment used in internal_code by removing '-' characters."""
    return cas_number.replace("-", "")


def _date_fragment(created_at: datetime | None = None) -> str:
    """Return the yymmdd fragment used in internal_code."""
    return (created_at or get_utc_now()).strftime("%y%m%d")


def build_internal_code_prefix(cas_number: str, *, created_at: datetime | None = None) -> str:
    """Build internal_code prefix `CASDATE-YYMMDD-` for a CAS/date pair."""
    return f"{_cas_code_fragment(cas_number)}-{_date_fragment(created_at)}-"


def get_max_sequence_for_prefix(session: Session, prefix: str) -> int:
    """Query the current max sequence for an internal_code prefix in SQL."""
    prefix_len = len(prefix)
    suffix_expr = func.substr(Inventory.internal_code, prefix_len + 1)
    statement = select(
        func.coalesce(func.max(cast(suffix_expr, Integer)), 0)
    ).where(Inventory.internal_code.like(f"{prefix}%"))
    max_seq = session.exec(statement).one()
    return int(max_seq or 0)


def format_internal_code(prefix: str, sequence: int) -> str:
    """Render a full internal_code with zero-padded numeric suffix."""
    return f"{prefix}{str(sequence).zfill(INTERNAL_CODE_SEQUENCE_PAD_WIDTH)}"


def is_internal_code_unique_violation(exc: IntegrityError) -> bool:
    """Whether an IntegrityError came from inventory.internal_code uniqueness."""
    raw_message = str(getattr(exc, "orig", exc))
    return _INTERNAL_CODE_UNIQUE_CONSTRAINT_MESSAGE in raw_message


def generate_internal_code(
    session: Session,
    cas_number: str,
    quantity: int = 1,
    *,
    created_at: datetime | None = None,
) -> list[str]:
    """
    Generate internal codes for inventory items
    
    Args:
        session: Database session
        cas_number: Normalized CAS number (e.g., "64-17-5")
        quantity: Number of items to generate codes for

    Returns:
        List of internal codes (e.g., ["64175-250113-001", "64175-250113-002"])
    """
    # Validate CAS number to prevent SQL injection
    # CAS should only contain digits and hyphens
    if not re.match(r"^[0-9-]+$", cas_number):
        raise ValueError(f"Invalid CAS number format: {cas_number}")
    if quantity <= 0:
        raise ValueError("quantity must be greater than 0")
    
    date_str = _date_fragment(created_at)
    prefix = build_internal_code_prefix(cas_number, created_at=created_at)
    max_seq = get_max_sequence_for_prefix(session, prefix)
    target_max_seq = max_seq + quantity
    if target_max_seq > INTERNAL_CODE_MAX_SEQUENCE:
        raise ValueError(
            f"Internal code sequence limit reached for {cas_number} on {date_str}: "
            f"max is {INTERNAL_CODE_MAX_SEQUENCE}"
        )
    
    start_seq = max_seq + 1
    return [format_internal_code(prefix, seq) for seq in range(start_seq, start_seq + quantity)]


def get_next_sequence(
    session: Session,
    cas_number: str
) -> int:
    """
    Get the next sequence number for a CAS number
    
    Args:
        session: Database session
        cas_number: Normalized CAS number
    
    Returns:
        Next sequence number (1-indexed)
    """
    # Validate CAS number to prevent SQL injection
    if not re.match(r"^[0-9-]+$", cas_number):
        raise ValueError(f"Invalid CAS number format: {cas_number}")

    statement = select(Inventory.internal_code).where(Inventory.cas_number == cas_number)
    existing_codes = session.exec(statement).all()

    if not existing_codes:
        return 1

    max_seq = 0
    for internal_code in existing_codes:
        parts = internal_code.split("-")
        if not parts:
            continue
        try:
            seq = int(parts[-1])
        except ValueError:
            continue
        if seq > max_seq:
            max_seq = seq

    return max_seq + 1
