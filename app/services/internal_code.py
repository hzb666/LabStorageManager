"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-01")
Sequence: Auto-increment per CAS number group
"""
import re
from datetime import datetime
from typing import Optional
from sqlalchemy import text
from sqlmodel import Session


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
    date_str = datetime.utcnow().strftime("%y%m%d")
    
    # Get the current max sequence for this CAS number
    # Internal codes follow pattern: CAS-Date-Sequence
    prefix = f"{cas_number}-{date_str}-"
    
    query = text("""
        SELECT MAX(CAST(SUBSTR(internal_code, LENGTH(:prefix) + 1) AS INTEGER)) 
        FROM inventory 
        WHERE internal_code LIKE :pattern
    """)
    
    result = session.execute(query, {
        "prefix": prefix,
        "pattern": f"{prefix}%"
    }).scalar()
    
    # Start sequence from result + 1 (or 1 if no existing)
    start_seq = (result or 0) + 1
    
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
    
    # Query the maximum sequence for this CAS
    query = text("""
        SELECT MAX(CAST(SUBSTR(internal_code, LENGTH(internal_code) - 1) AS INTEGER))
        FROM inventory
        WHERE cas_number = :cas_number
    """)
    
    result = session.execute(query, {"cas_number": cas_number}).scalar()
    return (result or 0) + 1
