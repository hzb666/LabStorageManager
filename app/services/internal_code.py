"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-01")
Sequence: Auto-increment per CAS number group
"""
import re
from datetime import datetime
from typing import Optional
from sqlmodel import Session, select, func

from app.models.inventory import Inventory
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
    # Query items with the given prefix using ORM
    statement = select(Inventory).where(
        Inventory.internal_code.like(f"{prefix}%")
    )
    results = session.exec(statement).all()
    
    if not results:
        return 0
    
    # Extract sequence numbers from internal codes
    max_seq = 0
    prefix_len = len(prefix)
    for item in results:
        code_part = item.internal_code[prefix_len:]
        try:
            seq = int(code_part)
            if seq > max_seq:
                max_seq = seq
        except ValueError:
            continue
    
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
        code = f"{prefix}{str(i).zfill(2)}"
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
    
    # Query items with this CAS number using ORM
    statement = select(Inventory).where(Inventory.cas_number == cas_number)
    results = session.exec(statement).all()
    
    if not results:
        return 1
    
    # Extract and find maximum sequence number
    max_seq = 0
    for item in results:
        # Parse the sequence from internal_code (last 2 digits)
        try:
            seq = int(item.internal_code[-2:])
            if seq > max_seq:
                max_seq = seq
        except ValueError:
            continue
    
    return max_seq + 1
