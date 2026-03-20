"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-01")
Sequence: Auto-increment per CAS number group
"""
import re
from sqlmodel import Session, select

from app.models.inventory import Inventory
from app.core.constants import INTERNAL_CODE_SEQUENCE_PAD_WIDTH
from app.core.time_utils import get_utc_now


def _get_max_sequence_for_prefix(session: Session, prefix: str) -> int:
    """
    Get the maximum sequence number for a given prefix using ORM query.
    
    Args:
        session: Database session
        prefix: Internal code prefix (e.g., "64175-250113-")
    
    Returns:
        Maximum sequence number found, or 0 if none exist
    """
    # Only select the internal_code column, order by it descending, and limit to 1
    statement = (
        select(Inventory.internal_code)
        .where(Inventory.internal_code.like(f"{prefix}%"))
        .order_by(Inventory.internal_code.desc())
        .limit(1)
    )
    last_code = session.exec(statement).first()

    if not last_code:
        return 0

    # Extract sequence number from the last internal code
    prefix_len = len(prefix)
    code_part = last_code[prefix_len:]
    try:
        return int(code_part)
    except ValueError:
        # If parsing fails, treat as no existing sequence
        return 0


def generate_internal_code(
    session: Session,
    cas_number: str,
    quantity: int = 1
) -> list[str]:
    """
    Generate internal codes for inventory items
    
    Args:
        session: Database session
        cas_number: Normalized CAS number (e.g., "64175")
        quantity: Number of items to generate codes for
    
    Returns:
        List of internal codes (e.g., ["64175-250113-01", "64175-250113-02"])
    """
    # Validate CAS number to prevent SQL injection
    # CAS should only contain digits and hyphens
    if not re.match(r"^[0-9-]+$", cas_number):
        raise ValueError(f"Invalid CAS number format: {cas_number}")
    
    # Get current date in yymmdd format
    date_str = get_utc_now().strftime("%y%m%d")
    
    # Get the current max sequence for this CAS number
    # Internal codes follow pattern: CAS-Date-Sequence
    prefix = f"{cas_number}-{date_str}-"
    
    # Use ORM query instead of raw SQL
    max_seq = _get_max_sequence_for_prefix(session, prefix)
    
    # Start sequence from result + 1 (or 1 if no existing)
    start_seq = max_seq + 1
    
    # Generate codes
    codes = []
    for i in range(start_seq, start_seq + quantity):
        code = f"{prefix}{str(i).zfill(INTERNAL_CODE_SEQUENCE_PAD_WIDTH)}"
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

    # Only select internal_code for this CAS number, order by it descending, and limit to 1
    statement = (
        select(Inventory.internal_code)
        .where(Inventory.cas_number == cas_number)
        .order_by(Inventory.internal_code.desc())
        .limit(1)
    )
    last_code = session.exec(statement).first()

    if not last_code:
        return 1

    # Parse the sequence from internal_code (last 2 digits)
    try:
        seq = int(last_code[-2:])
    except ValueError:
        # If parsing fails, start from 1
        return 1

    return seq + 1
