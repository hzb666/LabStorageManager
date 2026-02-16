"""
CAS Number Utilities
Critical Rule #2: All CAS Number inputs must be normalized (remove spaces, uppercase)
This is the foundation for deduplication in the system.
"""
import re
from typing import Optional

from app.core.config import settings


def normalize_cas(cas: str) -> str:
    """
    Normalize CAS number: remove spaces, convert to uppercase.
    
    Examples:
        "64-17-5" -> "64-17-5"
        "64 - 17 - 5" -> "64-17-5"
        "64- 17-5" -> "64-17-5"
    
    Args:
        cas: Raw CAS number string
        
    Returns:
        Normalized CAS number (uppercase, no spaces)
    """
    if not cas:
        return ""
    
    # Remove all whitespace
    normalized = cas.replace(" ", "").replace("\t", "").upper()
    return normalized


def validate_cas_format(cas: str) -> tuple[bool, Optional[str]]:
    """
    Validate CAS number format.
    
    CAS format: XXXXX-XX-X (2-7 digits)-(2 digits)-(1 digit)
    
    Args:
        cas: CAS number to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not cas:
        return False, "CAS number is required"
    
    # Check basic pattern
    pattern = r"^\d{2,7}-\d{2}-\d$"
    if not re.match(pattern, cas):
        return False, "Invalid CAS format. Expected: XXXXX-XX-X"
    
    # Validate check digit (optional for now, can be enhanced)
    parts = cas.split("-")
    if len(parts) != 3:
        return False, "Invalid CAS format"
    
    return True, None


def validate_and_normalize_cas(cas: str) -> tuple[bool, Optional[str], str]:
    """
    Validate and normalize CAS number in one step.
    
    Args:
        cas: Raw CAS number string
        
    Returns:
        Tuple of (is_valid, error_message, normalized_cas)
    """
    normalized = normalize_cas(cas)
    
    if not normalized:
        return False, "CAS number is required", ""
    
    is_valid, error = validate_cas_format(normalized)
    
    if not is_valid:
        return False, error, normalized
    
    return True, None, normalized


def get_cas_prefix(cas: str) -> str:
    """
    Extract prefix from CAS number for display purposes.
    
    Args:
        cas: Normalized CAS number
        
    Returns:
        First part of CAS (e.g., "64" from "64-17-5")
    """
    if not cas:
        return "UNK"
    return cas.split("-")[0].upper()
