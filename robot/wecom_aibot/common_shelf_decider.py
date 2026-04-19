"""Common-shelf fallback decisions based on CAS master data."""

from __future__ import annotations

from typing import Any

COMMON_SHELF_CATEGORIES = frozenset({"acid", "base", "salt", "solvent"})


def common_shelf_category_from_name_map(result: dict[str, Any]) -> str:
    """Return the first master-data category that should use common shelf fallback."""
    if not _is_success(result):
        return ""
    for item in _extract_items(_extract_payload_data(result)):
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "").strip().lower()
        if category in COMMON_SHELF_CATEGORIES:
            return category
    return ""


def has_name_map_records(result: dict[str, Any]) -> bool:
    """Return whether the master-data lookup found any rows."""
    if not _is_success(result):
        return False
    return bool(_extract_items(_extract_payload_data(result)))


def _is_success(result: dict[str, Any]) -> bool:
    payload = result.get("payload")
    return result.get("ok") is True and isinstance(payload, dict) and payload.get("ok") is True


def _extract_payload_data(result: dict[str, Any]) -> Any:
    payload = result.get("payload")
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return result.get("data", result)


def _extract_items(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("items", "records", "results", "data", "orders", "inventories", "groups"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []
