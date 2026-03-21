"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-001")
Sequence: Auto-increment per CAS number group, zero-padded to ensure proper sorting
"""
import re
from sqlmodel import Session, select

from app.core.constants import INTERNAL_CODE_MAX_SEQUENCE, INTERNAL_CODE_SEQUENCE_PAD_WIDTH
from app.models.inventory import Inventory
from app.core.time_utils import get_utc_now


def _cas_code_fragment(cas_number: str) -> str:
    """Return CAS fragment used in internal_code by removing '-' characters."""
    return cas_number.replace("-", "")


def _get_max_sequence_for_prefix(session: Session, prefix: str) -> int:
    """
    Get the maximum sequence number for a given prefix using ORM query.
    
    Args:
        session: Database session
        prefix: Internal code prefix (e.g., "64175-250113-")
    
    Returns:
        Maximum sequence number found, or 0 if none exist
    """
    statement = select(Inventory.internal_code).where(Inventory.internal_code.like(f"{prefix}%"))
    existing_codes = session.exec(statement).all()

    if not existing_codes:
        return 0

    # Internal code suffix should be numeric; parse safely to support legacy unpadded data.
    max_seq = 0
    prefix_len = len(prefix)
    for internal_code in existing_codes:
        code_part = internal_code[prefix_len:]
        try:
            seq = int(code_part)
        except ValueError:
            continue
        if seq > max_seq:
            max_seq = seq
    return max_seq


def generate_internal_code(
    session: Session,
    cas_number: str,
    quantity: int = 1
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
    
    # Get current date in yymmdd format
    date_str = get_utc_now().strftime("%y%m%d")
    
    cas_code = _cas_code_fragment(cas_number)

    # Get the current max sequence for this CAS number
    # Internal codes follow pattern: CAS-Date-Sequence
    prefix = f"{cas_code}-{date_str}-"
    
    # Use ORM query instead of raw SQL
    max_seq = _get_max_sequence_for_prefix(session, prefix)
    target_max_seq = max_seq + quantity
    if target_max_seq > INTERNAL_CODE_MAX_SEQUENCE:
        raise ValueError(
            f"Internal code sequence limit reached for {cas_number} on {date_str}: "
            f"max is {INTERNAL_CODE_MAX_SEQUENCE}"
        )
    
    # Start sequence from result + 1 (or 1 if no existing)
    start_seq = max_seq + 1
    
    # Generate codes with zero-padded sequence numbers
    codes = []
    for i in range(start_seq, start_seq + quantity):
        padded_seq = str(i).zfill(INTERNAL_CODE_SEQUENCE_PAD_WIDTH)
        code = f"{prefix}{padded_seq}"
        codes.append(code)
    
    return codes


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
