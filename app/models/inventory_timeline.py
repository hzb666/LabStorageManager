"""库存操作时间线响应模型。"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class InventoryTimelineOperationType(str, Enum):
    """库存时间线对外展示的操作类型。"""

    STOCK_IN = "stock_in"
    EDIT = "edit"
    BORROW = "borrow"


class InventoryTimelineItem(BaseModel):
    """一条可展开的库存时间线记录。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    time: str
    type: str
    operation_type: InventoryTimelineOperationType
    operator_name: str
    detail: str
    summary: dict[str, Any] | None = None
    full_data: dict[str, Any] | None = None


class InventoryTimelineResponse(BaseModel):
    """库存时间线分页响应。"""

    data: list[InventoryTimelineItem]
    total: int
    skip: int
    limit: int
