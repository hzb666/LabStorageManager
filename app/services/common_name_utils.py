"""Helpers for common-shelf standard-name marker handling."""

STD_NAME_PREFIX = "[std]"


def is_std_marked_name(name: str | None) -> bool:
    """Return True when name starts with standard-name marker."""
    if not name:
        return False
    return name.strip().lower().startswith(STD_NAME_PREFIX)


def strip_std_name_marker(name: str | None) -> str:
    """Remove [std] marker from the beginning for display/search/pinyin use."""
    if not name:
        return ""

    text = name.strip()
    if text.lower().startswith(STD_NAME_PREFIX):
        return text[len(STD_NAME_PREFIX):].strip()
    return text
