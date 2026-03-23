"""Workflow routes for reagent orders (approval, arrival, dashboard, stock-in)."""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import DBSession
from app.core.auth import CurrentUser, get_current_user, require_admin
from app.core.time_utils import utc_iso_str
from app.models.user import UserRole
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus, ReagentOrderReason
from app.models.inventory import Inventory, InventoryStatus
from app.core.constants import SSEEventType, SSERoom
from app.services.api_utils import clear_cache_by_prefix
from app.services.internal_code import generate_internal_code
from app.services.inventory_queries import regular_inventory_query
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.shelf_utils import normalize_storage_location
from app.services.spec_utils import format_specification
from app.services.sse_manager import sse_manager

ORDER_NOT_FOUND = "Order not found"
LIST_CACHE_PREFIX = "list:"


class ConfirmArrivalRequest(BaseModel):
    """Body for confirm-arrival action."""

    arrival_notes: Optional[str] = None
    storage_location: Optional[str] = None


class StockInRequest(BaseModel):
    """Body for stock-in action."""

    storage_location: str
    remaining_quantity: Optional[float] = None


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    return db.get(ReagentOrder, order_id)


def _create_inventory_items_from_order(
    db: Session,
    order: ReagentOrder,
    *,
    created_by_id: Optional[int],
    temporary_keeper_id: Optional[int],
    storage_location: Optional[str],
    inventory_status: InventoryStatus,
    is_common: bool,
    remaining_quantity: Optional[float] = None,
    note_suffix: Optional[str] = None,
) -> list[Inventory]:
    if order.quantity is None or order.quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order quantity")

    if order.initial_quantity is None or order.unit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order missing initial_quantity or unit. Please update the order.",
        )

    try:
        internal_codes = generate_internal_code(db, order.cas_number, order.quantity)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    pinyin_fields = compute_pinyin_fields(
        name=order.name,
        category=order.category,
        brand=order.brand,
        alias=order.alias,
        storage_location=storage_location,
    )

    notes = order.notes
    if note_suffix:
        notes = f"{notes}\n{note_suffix}" if notes else note_suffix

    effective_remaining = order.initial_quantity if remaining_quantity is None else remaining_quantity
    if effective_remaining is not None and effective_remaining <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="remaining_quantity must be greater than 0")

    inventory_items: list[Inventory] = []
    for internal_code in internal_codes:
        inv = Inventory(
            internal_code=internal_code,
            cas_number=order.cas_number,
            name=order.name,
            english_name=order.english_name,
            alias=order.alias,
            category=order.category,
            brand=order.brand,
            storage_location=storage_location,
            is_common=is_common,
            initial_quantity=order.initial_quantity,
            remaining_quantity=effective_remaining,
            remaining_percent=_compute_remaining_percent(effective_remaining, order.initial_quantity),
            unit=order.unit,
            is_hazardous=order.is_hazardous,
            status=inventory_status,
            temporary_keeper_id=temporary_keeper_id,
            source_order_id=order.id,
            created_by_id=created_by_id,
            notes=notes,
            **pinyin_fields,
        )
        db.add(inv)
        inventory_items.append(inv)

    return inventory_items


def _register_approval_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    @router.post("/{order_id}/approve", dependencies=[Depends(require_admin)])
    async def approve_reagent_order(order_id: int, db: DBSession):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.status not in (ReagentOrderStatus.PENDING, ReagentOrderStatus.REJECTED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve order with status: {order.status}",
            )

        order.status = ReagentOrderStatus.APPROVED

        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id},
        )

        return order

    @router.post("/{order_id}/reject", dependencies=[Depends(require_admin)])
    async def reject_reagent_order(order_id: int, db: DBSession):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.status not in (ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject order with status: {order.status}",
            )

        order.status = ReagentOrderStatus.REJECTED

        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id},
        )

        return order


def _register_arrival_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    @router.post("/{order_id}/confirm-arrival")
    async def confirm_reagent_arrival(
        current_user: CurrentUser,
        db: DBSession,
        order_id: int,
        body: ConfirmArrivalRequest = ConfirmArrivalRequest(),
    ):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the order applicant or admin can confirm arrival",
            )

        if order.status != ReagentOrderStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot confirm arrival for order with status: {order.status}. Order must be APPROVED first.",
            )

        if body.arrival_notes:
            order.notes = body.arrival_notes

        direct_storage_location = body.storage_location.strip() if body.storage_location else None

        if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
            target_location = normalize_storage_location(direct_storage_location)
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                temporary_keeper_id=None,
                storage_location=target_location,
                inventory_status=InventoryStatus.IN_STOCK,
                is_common=True,
            )
            order.status = ReagentOrderStatus.STOCKED
            message = "已到货并加入常用货架"
        elif direct_storage_location:
            target_location = normalize_storage_location(direct_storage_location)
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                temporary_keeper_id=None,
                storage_location=target_location,
                inventory_status=InventoryStatus.IN_STOCK,
                is_common=False,
            )
            order.status = ReagentOrderStatus.STOCKED
            message = "已到货并入库"
        else:
            keeper_name = current_user.full_name or current_user.username or "当前用户"
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                temporary_keeper_id=current_user.id,
                storage_location=None,
                inventory_status=InventoryStatus.IN_STOCK,
                is_common=False,
                note_suffix=f"{keeper_name}暂存",
            )
            order.status = ReagentOrderStatus.ARRIVED
            message = "已到货并进入暂存区，请及时补全入库信息"

        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id},
        )

        return {
            "message": message,
            "order_id": order.id,
            "status": order.status,
            "notes": order.notes,
            "items_created": len(inventory_items),
        }


def _register_dashboard_routes(router: APIRouter) -> None:
    @router.get("/dashboard/arrived-orders", dependencies=[Depends(get_current_user)])
    def get_arrived_reagent_orders(db: DBSession):
        statement = select(ReagentOrder).where(ReagentOrder.status == ReagentOrderStatus.ARRIVED).order_by(
            ReagentOrder.updated_at.desc()
        )

        orders = db.exec(statement).all()

        return {
            "data": [
                {
                    "order_id": order.id,
                    "cas_number": order.cas_number,
                    "name": order.name,
                    "english_name": order.english_name,
                    "specification": format_specification(order.initial_quantity, order.unit),
                    "quantity": order.quantity,
                    "price": order.price,
                    "is_hazardous": order.is_hazardous,
                    "notes": order.notes,
                    "arrived_at": order.updated_at,
                }
                for order in orders
            ],
            "total": len(orders),
        }

    @router.get("/dashboard/my-reagent-orders")
    def get_my_reagent_orders(current_user: CurrentUser, db: DBSession):
        dashboard_statuses = [
            ReagentOrderStatus.PENDING,
            ReagentOrderStatus.APPROVED,
            ReagentOrderStatus.REJECTED,
            ReagentOrderStatus.ARRIVED,
        ]
        statement = select(ReagentOrder).where(
            ReagentOrder.applicant_id == current_user.id,
            ReagentOrder.status.in_(dashboard_statuses),
        ).order_by(ReagentOrder.created_at.desc())

        orders = db.exec(statement).all()

        status_labels = {
            ReagentOrderStatus.PENDING.value: "已申购",
            ReagentOrderStatus.APPROVED.value: "已批准",
            ReagentOrderStatus.REJECTED.value: "未通过",
            ReagentOrderStatus.ARRIVED.value: "已到货",
        }
        grouped_orders: dict[str, dict[str, Any]] = {
            status.value: {"orders": [], "count": 0, "label": status_labels[status.value]}
            for status in dashboard_statuses
        }

        for order in orders:
            order_data = {
                "order_id": order.id,
                "cas_number": order.cas_number,
                "name": order.name,
                "english_name": order.english_name,
                "specification": format_specification(order.initial_quantity, order.unit),
                "initial_quantity": order.initial_quantity,
                "unit": order.unit,
                "quantity": order.quantity,
                "price": order.price,
                "is_hazardous": order.is_hazardous,
                "notes": order.notes,
                "order_reason": order.order_reason,
                "created_at": utc_iso_str(order.created_at),
                "updated_at": utc_iso_str(order.updated_at),
            }

            status_key = order.status.value if hasattr(order.status, "value") else str(order.status)
            if status_key not in grouped_orders:
                grouped_orders[status_key] = {"orders": [], "count": 0, "label": status_key}
            grouped_orders[status_key]["orders"].append(order_data)

        for key in grouped_orders:
            grouped_orders[key]["count"] = len(grouped_orders[key]["orders"])

        return {
            "data": grouped_orders,
            "total": len(orders),
        }


def _register_delete_stock_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    @router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_reagent_order(order_id: int, db: DBSession, current_user: CurrentUser):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)
        if current_user.role == UserRole.PUBLIC:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Public account cannot delete orders",
            )

        if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the order applicant or admin can delete this order",
            )

        db.delete(order)
        db.commit()
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_DELETED,
            {"id": order_id},
        )

    @router.post("/{order_id}/stock-in", response_model=dict)
    async def stock_in_reagent_order(
        order_id: int,
        payload: StockInRequest,
        current_user: CurrentUser,
        db: DBSession,
    ):
        if "remaining_quantity" in payload.model_fields_set and payload.remaining_quantity is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="remaining_quantity cannot be null",
            )

        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the order applicant or admin can stock in",
            )

        if order.status not in (ReagentOrderStatus.APPROVED, ReagentOrderStatus.ARRIVED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Order must be in APPROVED or ARRIVED status to stock in, current: {order.status}.",
            )

        if order.quantity is None or order.quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order quantity")

        if order.initial_quantity is None or order.unit is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Order missing initial_quantity or unit. Please update the order.",
            )

        is_common_shelf_order = order.order_reason == ReagentOrderReason.COMMON_PUBLIC
        if not is_common_shelf_order and not payload.storage_location.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="storage_location is required")

        if payload.remaining_quantity is not None and payload.remaining_quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="remaining_quantity must be greater than 0")

        if payload.remaining_quantity is not None and payload.remaining_quantity > order.initial_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"remaining_quantity ({payload.remaining_quantity}) cannot exceed "
                    f"initial_quantity ({order.initial_quantity})"
                ),
            )

        if order.status == ReagentOrderStatus.ARRIVED and payload.remaining_quantity is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="remaining_quantity is required for ARRIVED orders",
            )

        target_status = InventoryStatus.IN_STOCK
        normalized_location = normalize_storage_location(payload.storage_location)
        target_location = normalized_location
        target_is_common = is_common_shelf_order
        effective_remaining = order.initial_quantity if payload.remaining_quantity is None else payload.remaining_quantity

        if order.status == ReagentOrderStatus.APPROVED:
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                temporary_keeper_id=None,
                storage_location=target_location,
                inventory_status=target_status,
                is_common=target_is_common,
                remaining_quantity=effective_remaining,
            )
            order.status = ReagentOrderStatus.STOCKED

            db.commit()
            clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
            await sse_manager.broadcast(
                SSERoom.REAGENT_ORDERS,
                SSEEventType.REAGENT_ORDER_UPDATED,
                {"id": order_id},
            )

            for item in inventory_items:
                db.refresh(item)

            return {
                "message": "已入库",
                "order_id": order.id,
                "items_updated": 0,
                "items_created": len(inventory_items),
                "inventory_ids": [item.id for item in inventory_items],
            }

        pending_items = db.exec(
            regular_inventory_query()
            .where(
                Inventory.source_order_id == order.id,
                Inventory.storage_location.is_(None),
                Inventory.temporary_keeper_id.is_not(None),
            )
            .order_by(Inventory.created_at.desc(), Inventory.id.desc())
        ).all()

        if len(pending_items) < order.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No enough pending stock items found for this order",
            )

        target_items = pending_items[: order.quantity]

        for item in target_items:
            item.storage_location = target_location
            item.remaining_quantity = effective_remaining
            item.remaining_percent = _compute_remaining_percent(effective_remaining, item.initial_quantity)
            item.temporary_keeper_id = None
            item.status = target_status
            item.is_common = target_is_common

            pinyin_fields = compute_pinyin_fields(
                name=item.name,
                category=item.category,
                brand=item.brand,
                alias=item.alias,
                storage_location=item.storage_location,
            )
            for key, value in pinyin_fields.items():
                setattr(item, key, value)

        order.status = ReagentOrderStatus.STOCKED

        db.commit()
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id},
        )

        return {
            "message": "已入库",
            "order_id": order.id,
            "items_updated": len(target_items),
            "items_created": 0,
            "inventory_ids": [item.id for item in target_items],
        }


def register_workflow_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    _register_approval_routes(router, search_cache)
    _register_arrival_routes(router, search_cache)
    _register_dashboard_routes(router)
    _register_delete_stock_routes(router, search_cache)
