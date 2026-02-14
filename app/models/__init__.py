# Models module - Database models for LIMS
from .user import User, UserRole
from .order import Order, OrderType, OrderStatus, OrderReason
from .inventory import Inventory, InventoryStatus, BorrowLog, BorrowLogResponse
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
    ConsumableOrderReason,
    ConsumableOrderCreate,
    ConsumableOrderUpdate,
    ConsumableOrderResponse,
)

__all__ = [
    # User
    "User",
    "UserRole",
    # Legacy Order (deprecated, use ReagentOrder/ConsumableOrder)
    "Order",
    "OrderType",
    "OrderStatus",
    "OrderReason",
    # Inventory
    "Inventory",
    "InventoryStatus",
    "BorrowLog",
    "BorrowLogResponse",
    # Reagent Order (new)
    "ReagentOrder",
    "ReagentOrderStatus",
    "ReagentOrderReason",
    "ReagentOrderCreate",
    "ReagentOrderUpdate",
    "ReagentOrderResponse",
    # Consumable Order (new)
    "ConsumableOrder",
    "ConsumableOrderStatus",
    "ConsumableOrderReason",
    "ConsumableOrderCreate",
    "ConsumableOrderUpdate",
    "ConsumableOrderResponse",
]
