"""Shelf utility helpers."""
from __future__ import annotations

import re
from typing import Optional


EMPTY_LOCATION_TEXT_PATTERN = re.compile(r"[\s\-‐‑‒–—―−－﹣]+")
LOCATION_EDGE_DASH_CHARS = "-‐‑‒–—―−－﹣"


def is_effectively_empty_storage_location(storage_location: Optional[str]) -> bool:
    """Return whether location input is empty after trimming placeholder dashes."""
    if storage_location is None:
        return True
    normalized = storage_location.strip()
    if not normalized:
        return True
    return not EMPTY_LOCATION_TEXT_PATTERN.sub("", normalized)


def normalize_storage_location(storage_location: Optional[str]) -> Optional[str]:
    """Normalize storage location input to a clean value or None."""
    if storage_location is None:
        return None
    normalized = storage_location.strip().strip(LOCATION_EDGE_DASH_CHARS).strip()
    if is_effectively_empty_storage_location(normalized):
        return None
    return normalized
