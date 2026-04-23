"""Helpers for reagent brand normalization."""
from __future__ import annotations

import re

from app.services.pinyin_utils import PINYIN_FIELD_MAX_LENGTH, to_pinyin_parts

WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_reagent_brand_name(value: str | None) -> str:
    """Normalize brand display names while preserving case and Chinese text."""
    if value is None:
        return ""
    return WHITESPACE_PATTERN.sub(" ", value.strip())


def normalize_reagent_brand_key(value: str | None) -> str:
    """Normalize brand names for duplicate detection."""
    return normalize_reagent_brand_name(value).casefold()


def build_reagent_brand_pinyin_fields(name: str) -> tuple[str | None, str | None]:
    """Build searchable pinyin and initials fields for a brand name."""
    name_pinyin, name_initials = to_pinyin_parts(name)
    return (
        name_pinyin[:PINYIN_FIELD_MAX_LENGTH] or None,
        name_initials[:PINYIN_FIELD_MAX_LENGTH] or None,
    )
