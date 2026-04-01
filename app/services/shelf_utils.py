"""Shelf utility helpers."""
from __future__ import annotations

from typing import Optional


def normalize_storage_location(storage_location: Optional[str]) -> Optional[str]:
    """Normalize storage location input to a clean value or None."""
    if storage_location is None:
        return None
    normalized = storage_location.strip()
    return normalized or None
