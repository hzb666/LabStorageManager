# 试剂订单工作流路由：审批、到货、仪表盘、入库。
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select, delete

from app.database import DBSession
from app.core.auth import CurrentUser, get_current_user, require_admin
from app.core.db_compat import exec_delete_returning_first
from app.core.request_utils import get_request_is_cli
from app.core.time_utils import utc_iso_str
from app.models.user import UserRole
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderReason,
    ReagentOrderResponse,
    ReagentOrderStatus,
)
from app.models.common_shelf import CommonShelf, CommonShelfResponse
from app.models.inventory import Inventory, InventoryResponse, InventoryStatus
from app.core.constants import SSEEventType, SSERoom
from app.services.api_utils import clear_cache_by_prefix
from app.services.common_shelf_creation import create_common_shelf_items_from_order
from app.services.common_shelf_operation_logger import log_common_shelf_stock_in
from app.services.internal_code import (
    INTERNAL_CODE_CONFLICT_MAX_RETRIES,
    generate_internal_code,
    is_internal_code_unique_violation,
)
from app.services.inventory_operation_logger import (
    SOURCE_ORDER_STOCK_IN,
    log_inventory_update,
    log_stock_in,
)
from app.services.inventory_queries import regular_inventory_query
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.shelf_utils import normalize_storage_location
from app.services.spec_utils import format_specification
from app.services.sse_manager import sse_manager
from app.services.user_utils import batch_get_user_names
from app.services.order_operation_logger import (
    log_reagent_order_approve,
    log_reagent_order_delete,
    log_reagent_order_reject,
)

ORDER_NOT_FOUND = "Order not found"
LIST_CACHE_PREFIX = "list:"
DELETE_ORDER_FORBIDDEN_DETAIL = "Only the order applicant or admin can delete this order"
DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL = "Public account cannot delete orders"


class ConfirmArrivalRequest(BaseModel):
    # confirm-arrival 操作请求体。
    model_config = ConfigDict(extra="forbid")

    arrival_notes: Optional[str] = None
    storage_location: Optional[str] = None


class StockInRequest(BaseModel):
    # stock-in 操作请求体。
    model_config = ConfigDict(extra="forbid")

    storage_location: str
    remaining_quantity: Optional[float] = None


@dataclass(frozen=True)
class InventoryCreateOptions:
    # 创建库存项的可选参数集合，避免内部 helper 参数膨胀。

    created_by_id: Optional[int]
    temporary_keeper_id: Optional[int]
    storage_location: Optional[str]
    inventory_status: InventoryStatus
    remaining_quantity: Optional[float] = None
    note_suffix: Optional[str] = None


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    return db.get(ReagentOrder, order_id)


def _serialize_reagent_order(order: ReagentOrder, db: Session) -> dict[str, Any]:
    users_map = batch_get_user_names(db, {order.applicant_id} if order.applicant_id else set())
    return {
        **ReagentOrderResponse.model_validate(order).model_dump(mode="json"),
        "specification": format_specification(order.initial_quantity, order.unit),
        "applicant_name": users_map.get(order.applicant_id, ""),
    }


def _serialize_inventory_items(db: Session, items: list[Inventory]) -> list[dict[str, Any]]:
    user_ids = set()
    for item in items:
        if item.borrower_id:
            user_ids.add(item.borrower_id)
        if item.last_borrower_id:
            user_ids.add(item.last_borrower_id)
        if item.created_by_id:
            user_ids.add(item.created_by_id)
        if item.temporary_keeper_id:
            user_ids.add(item.temporary_keeper_id)

    users_map = batch_get_user_names(db, user_ids)
    serialized_items: list[dict[str, Any]] = []
    for item in items:
        item_dict = InventoryResponse.model_validate(item).model_dump(mode="json")
        item_dict["specification"] = format_specification(item.initial_quantity, item.unit)
        item_dict["borrower_name"] = users_map.get(item.borrower_id)
        item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        item_dict["temporary_keeper_name"] = users_map.get(item.temporary_keeper_id)
        serialized_items.append(item_dict)
    return serialized_items


def _serialize_common_shelf_items(db: Session, items: list[CommonShelf]) -> list[dict[str, Any]]:
    users_map = batch_get_user_names(
        db,
        {item.created_by_id for item in items if item.created_by_id},
    )
    serialized_items: list[dict[str, Any]] = []
    for item in items:
        item_dict = CommonShelfResponse.model_validate(item).model_dump(mode="json")
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        serialized_items.append(item_dict)
    return serialized_items


def _clear_inventory_projection_cache() -> None:
    from app.api.inventory import (
        LIST_CACHE_PREFIX as INVENTORY_LIST_CACHE_PREFIX,
        SEARCH_CACHE as INVENTORY_SEARCH_CACHE,
    )

    clear_cache_by_prefix(INVENTORY_SEARCH_CACHE, prefix=INVENTORY_LIST_CACHE_PREFIX)


def _log_stock_in_operations(
    db: Session,
    *,
    items: list[Inventory],
    operator_id: int,
    is_cli: bool,
) -> None:
    if not items:
        return
    db.flush()
    for item in items:
        log_stock_in(
            db,
            inventory=item,
            operator_id=operator_id,
            source=SOURCE_ORDER_STOCK_IN,
            is_cli=is_cli,
        )


def _log_common_stock_in_operations(
    db: Session,
    *,
    items: list[CommonShelf],
    operator_id: int,
    is_cli: bool,
) -> None:
    if not items:
        return
    db.flush()
    for item in items:
        log_common_shelf_stock_in(
            db,
            item=item,
            operator_id=operator_id,
            is_cli=is_cli,
        )


def _create_inventory_items_from_order(
    db: Session,
    order: ReagentOrder,
    *,
    options: InventoryCreateOptions,
) -> list[Inventory]:
    if order.quantity is None or order.quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order quantity")

    if order.initial_quantity is None or order.unit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order missing initial_quantity or unit. Please update the order.",
        )

    pinyin_fields = compute_pinyin_fields(
        name=order.name,
        category=order.category,
        brand=order.brand,
        storage_location=options.storage_location,
    )

    notes = order.notes
    if options.note_suffix:
        notes = f"{notes}\n{options.note_suffix}" if notes else options.note_suffix

    effective_remaining = order.initial_quantity if options.remaining_quantity is None else options.remaining_quantity
    if effective_remaining is not None and effective_remaining <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="remaining_quantity must be greater than 0")

    for attempt in range(INTERNAL_CODE_CONFLICT_MAX_RETRIES):
        try:
            internal_codes = generate_internal_code(db, order.cas_number, order.quantity)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        inventory_items: list[Inventory] = []
        try:
            with db.begin_nested():
                for internal_code in internal_codes:
                    inv = Inventory(
                        internal_code=internal_code,
                        cas_number=order.cas_number,
                        name=order.name,
                        english_name=order.english_name,
                        alias=order.alias,
                        category=order.category,
                        brand=order.brand,
                        purity=order.purity,
                        storage_location=options.storage_location,
                        initial_quantity=order.initial_quantity,
                        remaining_quantity=effective_remaining,
                        remaining_percent=_compute_remaining_percent(
                            effective_remaining,
                            order.initial_quantity,
                        ),
                        unit=order.unit,
                        is_hazardous=order.is_hazardous,
                        status=options.inventory_status,
                        temporary_keeper_id=options.temporary_keeper_id,
                        source_order_id=order.id,
                        created_by_id=options.created_by_id,
                        notes=notes,
                        **pinyin_fields,
                    )
                    db.add(inv)
                    inventory_items.append(inv)

                db.flush()
            return inventory_items
        except IntegrityError as exc:
            if not is_internal_code_unique_violation(exc):
                raise
            if attempt == INTERNAL_CODE_CONFLICT_MAX_RETRIES - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="库存内部编码冲突，请重试订单入库操作",
                ) from exc

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="库存内部编码冲突，请重试订单入库操作")


async def _broadcast_inventory_projection_events(
    db: Session,
    items: list[Inventory],
    *,
    created: bool,
) -> None:
    if not items:
        return

    serialized_items = _serialize_inventory_items(db, items)
    for item, serialized_item in zip(items, serialized_items):
        event_type = SSEEventType.INVENTORY_CREATED if created else SSEEventType.INVENTORY_UPDATED
        await sse_manager.broadcast(SSERoom.INVENTORY, event_type, {"id": item.id, "item": serialized_item})


async def _broadcast_common_shelf_events(
    db: Session,
    items: list[CommonShelf],
    *,
    created: bool,
) -> None:
    if not items:
        return

    serialized_items = _serialize_common_shelf_items(db, items)
    event_type = (
        SSEEventType.COMMON_SHELF_CREATED
        if created
        else SSEEventType.COMMON_SHELF_UPDATED
    )
    for item, serialized_item in zip(items, serialized_items):
        await sse_manager.broadcast(
            SSERoom.COMMON_SHELF,
            event_type,
            {"id": item.id, "item": serialized_item},
        )


def _register_approval_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    @router.post("/{order_id}/approve", dependencies=[Depends(require_admin)])
    async def approve_reagent_order(
        order_id: int,
        request: Request,
        db: DBSession,
        current_user: CurrentUser,
    ):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.status not in (ReagentOrderStatus.PENDING, ReagentOrderStatus.REJECTED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve order with status: {order.status}",
            )

        before_order = ReagentOrder.model_validate(order)
        order.status = ReagentOrderStatus.APPROVED
        log_reagent_order_approve(
            db,
            before_order=before_order,
            after_order=order,
            actor_user_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )

        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id, "item": _serialize_reagent_order(order, db)},
        )

        return order

    @router.post("/{order_id}/reject", dependencies=[Depends(require_admin)])
    async def reject_reagent_order(
        order_id: int,
        request: Request,
        db: DBSession,
        current_user: CurrentUser,
    ):
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        if order.status not in (ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject order with status: {order.status}",
            )

        before_order = ReagentOrder.model_validate(order)
        order.status = ReagentOrderStatus.REJECTED
        log_reagent_order_reject(
            db,
            before_order=before_order,
            after_order=order,
            actor_user_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )

        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id, "item": _serialize_reagent_order(order, db)},
        )

        return order


def _register_arrival_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    @router.post("/{order_id}/confirm-arrival")
    async def confirm_reagent_arrival(
        request: Request,
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
            common_shelf_items = create_common_shelf_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                storage_location=direct_storage_location,
            )
            order.status = ReagentOrderStatus.STOCKED
            message = "已到货并加入常用货架"
            _log_common_stock_in_operations(
                db,
                items=common_shelf_items,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            db.commit()
            db.refresh(order)
            clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
            await sse_manager.broadcast(
                SSERoom.REAGENT_ORDERS,
                SSEEventType.REAGENT_ORDER_UPDATED,
                {"id": order_id, "item": _serialize_reagent_order(order, db)},
            )
            await _broadcast_common_shelf_events(db, common_shelf_items, created=True)

            return {
                "message": message,
                "order_id": order.id,
                "status": order.status,
                "notes": order.notes,
                "items_created": len(common_shelf_items),
            }
        elif direct_storage_location:
            target_location = normalize_storage_location(direct_storage_location)
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                options=InventoryCreateOptions(
                    created_by_id=current_user.id,
                    temporary_keeper_id=None,
                    storage_location=target_location,
                    inventory_status=InventoryStatus.IN_STOCK,
                ),
            )
            order.status = ReagentOrderStatus.STOCKED
            message = "已到货并入库"
        else:
            keeper_name = current_user.full_name or current_user.username or "当前用户"
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                options=InventoryCreateOptions(
                    created_by_id=current_user.id,
                    temporary_keeper_id=current_user.id,
                    storage_location=None,
                    inventory_status=InventoryStatus.IN_STOCK,
                    note_suffix=f"{keeper_name}暂存",
                ),
            )
            order.status = ReagentOrderStatus.ARRIVED
            message = "已到货并进入暂存区，请及时补全入库信息"

        _log_stock_in_operations(
            db,
            items=inventory_items,
            operator_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
        db.commit()
        db.refresh(order)
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id, "item": _serialize_reagent_order(order, db)},
        )
        _clear_inventory_projection_cache()
        await _broadcast_inventory_projection_events(db, inventory_items, created=True)

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
                    "purity": order.purity,
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
                "purity": order.purity,
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


# 校验 stock-in 请求体字段，保持对 null remaining_quantity 的显式拦截语义。
def _validate_stock_in_payload(payload: StockInRequest) -> None:
    if "remaining_quantity" in payload.model_fields_set and payload.remaining_quantity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remaining_quantity cannot be null",
        )


# 校验 stock-in 的权限和订单状态，确保接口契约与错误文案不变。
def _validate_stock_in_order(
    order: ReagentOrder,
    *,
    current_user: CurrentUser,
    payload: StockInRequest,
) -> None:
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

    if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Common-public orders are stocked at confirm-arrival time",
        )
    if not payload.storage_location.strip():
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


# 计算 stock-in 的目标库存属性，复用 APPROVED/ARRIVED 两条路径。
def _build_stock_in_context(order: ReagentOrder, payload: StockInRequest) -> tuple[Optional[str], float]:
    target_location = normalize_storage_location(payload.storage_location)
    effective_remaining = order.initial_quantity if payload.remaining_quantity is None else payload.remaining_quantity
    return target_location, effective_remaining


# 处理 APPROVED 订单直接入库，保持原有创建库存和返回字段语义。
def _stock_in_approved_order(
    db: Session,
    *,
    order: ReagentOrder,
    current_user: CurrentUser,
    stock_context: tuple[Optional[str], float],
) -> list[Inventory]:
    target_location, effective_remaining = stock_context
    return _create_inventory_items_from_order(
        db,
        order,
        options=InventoryCreateOptions(
            created_by_id=current_user.id,
            temporary_keeper_id=None,
            storage_location=target_location,
            inventory_status=InventoryStatus.IN_STOCK,
            remaining_quantity=effective_remaining,
        ),
    )


# 获取 ARRIVED 订单的待补全库存项，并保持原数量不足时报错语义。
def _get_arrived_pending_items(db: Session, order: ReagentOrder) -> list[Inventory]:
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
    return pending_items[: order.quantity]


# 把 ARRIVED 暂存项补全为正式库存项，并复用拼音字段计算逻辑。
def _apply_arrived_items_stock_in(
    target_items: list[Inventory],
    *,
    order: ReagentOrder,
    target_location: Optional[str],
    effective_remaining: float,
) -> None:
    for item in target_items:
        item.purity = order.purity
        item.storage_location = target_location
        item.remaining_quantity = effective_remaining
        item.remaining_percent = _compute_remaining_percent(effective_remaining, item.initial_quantity)
        item.temporary_keeper_id = None
        item.status = InventoryStatus.IN_STOCK

        pinyin_fields = compute_pinyin_fields(
            name=item.name,
            category=item.category,
            brand=item.brand,
            storage_location=item.storage_location,
        )
        for key, value in pinyin_fields.items():
            setattr(item, key, value)


# 提交 stock-in 状态并触发缓存清理与事件广播，保证事务边界一致。
async def _finalize_stock_in_order(
    db: Session,
    *,
    order: ReagentOrder,
    order_id: int,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    order.status = ReagentOrderStatus.STOCKED
    db.commit()
    clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
    await sse_manager.broadcast(
        SSERoom.REAGENT_ORDERS,
        SSEEventType.REAGENT_ORDER_UPDATED,
        {"id": order_id, "item": _serialize_reagent_order(order, db)},
    )


def _delete_reagent_order_with_permission(
    db: Session,
    *,
    order_id: int,
    current_user: CurrentUser,
) -> ReagentOrder:
    # Keep delete atomic while preserving legacy API semantics: missing -> 404, unauthorized existing row -> 403.
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL,
        )

    delete_stmt = delete(ReagentOrder).where(ReagentOrder.id == order_id)
    if current_user.role != UserRole.ADMIN:
        delete_stmt = delete_stmt.where(ReagentOrder.applicant_id == current_user.id)
    deleted_item = exec_delete_returning_first(db, delete_stmt, ReagentOrder)
    if deleted_item is not None:
        return deleted_item

    order_exists = db.exec(select(ReagentOrder.id).where(ReagentOrder.id == order_id)).first()
    if order_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=DELETE_ORDER_FORBIDDEN_DETAIL,
    )


# 注册删除订单接口，保持原权限和 204 语义。
def _register_delete_order_route(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    # 删除试剂订单。
    @router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_reagent_order(
        order_id: int,
        request: Request,
        db: DBSession,
        current_user: CurrentUser,
    ):
        # 删除试剂订单（单语句原子删除 + 保持原鉴权语义）。
        order = _delete_reagent_order_with_permission(
            db,
            order_id=order_id,
            current_user=current_user,
        )

        log_reagent_order_delete(
            db,
            order=order,
            actor_user_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
        db.commit()
        clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_DELETED,
            {"id": order_id},
        )


# 注册订单入库接口，拆分 APPROVED/ARRIVED 路径但保持外部行为不变。
def _register_stock_in_route(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    # 执行试剂订单入库。
    @router.post("/{order_id}/stock-in", response_model=dict)
    async def stock_in_reagent_order(
        order_id: int,
        payload: StockInRequest,
        request: Request,
        current_user: CurrentUser,
        db: DBSession,
    ):
        # 执行订单入库流程。
        _validate_stock_in_payload(payload)
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        _validate_stock_in_order(order, current_user=current_user, payload=payload)
        stock_context = _build_stock_in_context(order, payload)
        target_location, effective_remaining = stock_context

        if order.status == ReagentOrderStatus.APPROVED:
            inventory_items = _stock_in_approved_order(
                db,
                order=order,
                current_user=current_user,
                stock_context=stock_context,
            )
            _log_stock_in_operations(
                db,
                items=inventory_items,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            await _finalize_stock_in_order(db, order=order, order_id=order_id, search_cache=search_cache)
            _clear_inventory_projection_cache()
            await _broadcast_inventory_projection_events(db, inventory_items, created=True)
            for item in inventory_items:
                db.refresh(item)
            return {
                "message": "已入库",
                "order_id": order.id,
                "items_updated": 0,
                "items_created": len(inventory_items),
                "inventory_ids": [item.id for item in inventory_items],
            }

        target_items = _get_arrived_pending_items(db, order)
        before_items = [Inventory.model_validate(item) for item in target_items]
        _apply_arrived_items_stock_in(
            target_items,
            order=order,
            target_location=target_location,
            effective_remaining=effective_remaining,
        )
        for before_item, after_item in zip(before_items, target_items):
            log_inventory_update(
                db,
                before_inventory=before_item,
                after_inventory=after_item,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
        await _finalize_stock_in_order(db, order=order, order_id=order_id, search_cache=search_cache)
        _clear_inventory_projection_cache()
        await _broadcast_inventory_projection_events(db, target_items, created=False)
        return {
            "message": "已入库",
            "order_id": order.id,
            "items_updated": len(target_items),
            "items_created": 0,
            "inventory_ids": [item.id for item in target_items],
        }


# 汇总删除与入库路由注册。
def _register_delete_stock_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    _register_delete_order_route(router, search_cache)
    _register_stock_in_route(router, search_cache)


def register_workflow_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
) -> None:
    _register_approval_routes(router, search_cache)
    _register_arrival_routes(router, search_cache)
    _register_dashboard_routes(router)
    _register_delete_stock_routes(router, search_cache)
