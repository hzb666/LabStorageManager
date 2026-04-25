"""Export rate-limit helpers."""

from fastapi import HTTPException, status

from app.core.constants import (
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_LIMIT_SCOPE_PREFIX,
    EXPORT_RATE_LIMIT_WINDOW_SECONDS,
)
from app.services.rate_limit import enforce_rate_limit

EXPORT_SCOPE_INVENTORY = "inventory"
EXPORT_SCOPE_REAGENT_ORDERS = "reagent_orders"
EXPORT_SCOPE_CONSUMABLE_ORDERS = "consumable_orders"
EXPORT_SCOPE_COMMON_SHELF = "common_shelf"


def enforce_export_rate_limit(user_id: int, export_scope: str) -> None:
    try:
        enforce_rate_limit(
            scope=f"{EXPORT_RATE_LIMIT_SCOPE_PREFIX}:{export_scope}",
            identifier=str(user_id),
            limit=EXPORT_RATE_LIMIT,
            window_seconds=EXPORT_RATE_LIMIT_WINDOW_SECONDS,
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
            raise
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"导出过于频繁，请 {EXPORT_RATE_LIMIT_WINDOW_SECONDS} 秒后再试",
        ) from exc
