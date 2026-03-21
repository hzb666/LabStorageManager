"""
CSV export helpers.
"""

from typing import Any


_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@")


def escape_csv_formula(value: Any) -> Any:
    """
    Neutralize spreadsheet formulas in exported string cells.

    Excel-compatible tools may evaluate cells that begin with formula markers,
    even when the value ultimately came from user-controlled text fields.
    """
    if not isinstance(value, str):
        return value

    stripped = value.lstrip()
    if stripped and stripped[0] in _DANGEROUS_CSV_PREFIXES:
        return f"'{value}"

    return value
