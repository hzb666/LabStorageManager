"""库存操作时间线路由。"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import select

from app.core.auth import CurrentUser
from app.core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.database import DBSession
from app.models.inventory import Inventory
from app.models.inventory_timeline import InventoryTimelineResponse
from app.services.api_utils import normalize_pagination
from app.services.inventory_timeline import list_inventory_timeline


INVENTORY_NOT_FOUND = "Inventory item not found"


def register_inventory_timeline_routes(router: APIRouter) -> None:
    """在动态库存 ID 路由之前注册时间线具名路由。"""

    @router.get(
        "/code/{internal_code}/timeline",
        response_model=InventoryTimelineResponse,
    )
    def get_inventory_timeline(
        internal_code: str,
        current_user: CurrentUser,
        db: DBSession,
        search: Annotated[str | None, Query(max_length=200)] = None,
        skip: int = 0,
        limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    ) -> InventoryTimelineResponse:
        item = db.exec(
            select(Inventory).where(Inventory.internal_code == internal_code.strip())
        ).first()
        if item is None or item.id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        normalized_skip, normalized_limit = normalize_pagination(skip, limit)
        return list_inventory_timeline(
            db,
            inventory_id=item.id,
            viewer_user_id=current_user.id or 0,
            search=search,
            skip=normalized_skip,
            limit=normalized_limit,
        )
