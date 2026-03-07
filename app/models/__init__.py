# Models module - Database models for LIMS
from datetime import datetime
from pydantic import ConfigDict
from sqlmodel import SQLModel


class BaseResponse(SQLModel):
    """全局 Response 基类 - 所有 API 响应都继承此类，自动处理 datetime 为 UTC + Z"""
    model_config = ConfigDict(from_attributes=True, json_encoders={datetime: lambda v: v.isoformat() + 'Z'})


from .user import User, UserRole, UserResponse
from .inventory import Inventory, InventoryStatus, BorrowLog, BorrowLogResponse, InventoryResponse
from .reagent_order import (
    ReagentOrder,
    ReagentOrderStatus,
    ReagentOrderReason,
    ReagentOrderCreate,
    ReagentOrderUpdate,
    ReagentOrderResponse,
)
from .consumable_order import (
    ConsumableOrder,
    ConsumableOrderStatus,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
)
from .user_session import UserSession
from .announcement import (
    Announcement,
    AnnouncementBase,
    AnnouncementCreate,
    AnnouncementUpdate,
    AnnouncementResponse,
)

__all__ = [
    # Base
    "BaseResponse",
    # User
    "User",
    "UserRole",
    "UserResponse",
    # Session
    "UserSession",
    # Inventory
    "Inventory",
    "InventoryStatus",
    "BorrowLog",
    "BorrowLogResponse",
    "InventoryResponse",
    # Reagent Order
    "ReagentOrder",
    "ReagentOrderStatus",
    "ReagentOrderReason",
    "ReagentOrderCreate",
    "ReagentOrderUpdate",
    "ReagentOrderResponse",
    # Consumable Order
    "ConsumableOrder",
    "ConsumableOrderStatus",
    "ConsumableOrderCreate",
    "ConsumableOrderUpdate",
    "ConsumableOrderResponse",
    # Announcement
    "Announcement",
    "AnnouncementBase",
    "AnnouncementCreate",
    "AnnouncementUpdate",
    "AnnouncementResponse",
]
