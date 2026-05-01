# 试剂订单工作流路由：审批、到货、仪表盘、入库。
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Collection, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select, delete, update as sql_update

from app.database import DBSession
from app.core.auth import CurrentUser, get_current_user, require_admin
from app.core.db_compat import exec_delete_returning_first
from app.core.request_utils import get_request_is_cli
from app.core.time_utils import get_utc_now, utc_iso_str
from app.models.user import UserRole
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderReason,
    ReagentOrderResponse,
    ReagentOrderStatus,
)
from app.models.common_shelf import CommonShelf
from app.models.inventory import Inventory, InventoryResponse, InventoryStatus
from app.core.constants import SSEEventType, SSERoom
from app.services.api_utils import clear_cache_by_prefix, empty_to_none
from app.services.cas_utils import normalize_cas
from app.services.common_shelf_creation import (
    create_common_shelf_items_from_order,
    normalize_brand_for_group,
    normalize_specification_for_group,
)
from app.services.common_shelf_group_records import get_active_common_shelf_group
from app.services.common_shelf_operation_logger import log_common_shelf_stock_in
from app.services.common_shelf_queries import (
    CommonShelfGroupFields,
    get_common_shelf_group_row_payload,
    get_group_identity_from_item,
)
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
from app.services.spec_utils import SpecificationError, format_specification, parse_specification
from app.services.sse_manager import sse_manager
from app.services.user_utils import batch_get_user_names
from app.services.order_operation_logger import (
    log_reagent_order_approve,
    log_reagent_order_delete,
    log_reagent_order_update,
    log_reagent_order_reject,
)
from app.services.order_status_times import (
    get_order_status_time_fields,
    get_reagent_order_status_times,
)
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.search_completion_db import (
    INVENTORY_COMPLETION_ENDPOINT,
    REAGENT_ORDER_COMPLETION_ENDPOINT,
    mark_entity_completion_index_stale,
)

ORDER_NOT_FOUND = "Order not found"
LIST_CACHE_PREFIX = "list:"
DELETE_ORDER_FORBIDDEN_DETAIL = "Only the order applicant or admin can delete this order"
DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL = "Public account cannot delete orders"
DELETE_APPROVED_ORDER_FORBIDDEN_DETAIL = "Approved, arrived, or stocked orders cannot be deleted"
REAGENT_ORDER_DELETE_LOCKED_STATUSES = frozenset(
    {
        ReagentOrderStatus.APPROVED,
        ReagentOrderStatus.ARRIVED,
        ReagentOrderStatus.STOCKED,
    }
)
REAGENT_ORDER_APPROVABLE_STATUSES = frozenset(
    {
        ReagentOrderStatus.PENDING,
        ReagentOrderStatus.REJECTED,
    }
)
REAGENT_ORDER_REJECTABLE_STATUSES = frozenset(
    {
        ReagentOrderStatus.PENDING,
        ReagentOrderStatus.APPROVED,
    }
)
DASHBOARD_ACTIVE_REJECTED_DAYS = 7
DASHBOARD_REAGENT_STATUSES = (
    ReagentOrderStatus.PENDING,
    ReagentOrderStatus.APPROVED,
    ReagentOrderStatus.REJECTED,
)


def _clear_reagent_workflow_cache(search_cache: Dict[str, tuple[Any, Any]]) -> None:
    clear_cache_by_prefix(search_cache, prefix=LIST_CACHE_PREFIX)
    mark_entity_completion_index_stale(REAGENT_ORDER_COMPLETION_ENDPOINT)


class ReagentWorkflowEditableFields(BaseModel):
    # 到货/入库时允许再次校正的试剂信息；CAS、价格、订购原因和瓶数不在此处修改。
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    brand: Optional[str] = Field(default=None, max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    specification: Optional[str] = Field(default=None, max_length=100)
    is_hazardous: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class ConfirmArrivalRequest(ReagentWorkflowEditableFields):
    # confirm-arrival 操作请求体。

    arrival_notes: Optional[str] = Field(default=None, max_length=500)
    storage_location: Optional[str] = None
    remaining_quantity: Optional[float] = None


class StockInRequest(ReagentWorkflowEditableFields):
    # stock-in 操作请求体。

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


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _validate_positive_remaining_quantity(
    remaining_quantity: Optional[float],
    *,
    initial_quantity: Optional[float],
) -> None:
    if remaining_quantity is None:
        return
    if remaining_quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="remaining_quantity must be greater than 0")
    if initial_quantity is not None and remaining_quantity > initial_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"remaining_quantity ({remaining_quantity}) cannot exceed "
                f"initial_quantity ({initial_quantity})"
            ),
        )


def _get_reagent_order_by_id(db: Session, order_id: int) -> Optional[ReagentOrder]:
    return db.get(ReagentOrder, order_id)


def _status_value(value: ReagentOrderStatus) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _claim_reagent_order_status_transition(
    db: Session,
    *,
    order_id: int,
    expected_status: ReagentOrderStatus,
    target_status: ReagentOrderStatus,
) -> None:
    _claim_reagent_order_status_transition_from(
        db,
        order_id=order_id,
        expected_statuses=(expected_status,),
        target_status=target_status,
    )


def _claim_reagent_order_status_transition_from(
    db: Session,
    *,
    order_id: int,
    expected_statuses: Collection[ReagentOrderStatus],
    target_status: ReagentOrderStatus,
) -> None:
    expected_status_values = tuple(expected_statuses)
    if not expected_status_values:
        raise ValueError("expected_statuses cannot be empty")
    status_clause = (
        ReagentOrder.status == expected_status_values[0]
        if len(expected_status_values) == 1
        else ReagentOrder.status.in_(expected_status_values)
    )
    result = db.exec(
        sql_update(ReagentOrder)
        .where(ReagentOrder.id == order_id)
        .where(status_clause)
        .values(status=target_status, updated_at=get_utc_now())
    )
    if result.rowcount != 0:
        return

    latest_status = db.exec(select(ReagentOrder.status).where(ReagentOrder.id == order_id)).first()
    if latest_status is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Order status already changed to "
            f"{_status_value(latest_status)}, please refresh and retry"
        ),
    )


def _ensure_reagent_order_deletable(order: ReagentOrder) -> None:
    if order.status in REAGENT_ORDER_DELETE_LOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DELETE_APPROVED_ORDER_FORBIDDEN_DETAIL,
        )


def _serialize_reagent_order(order: ReagentOrder, db: Session) -> dict[str, Any]:
    users_map = batch_get_user_names(db, {order.applicant_id} if order.applicant_id else set())
    status_times = get_reagent_order_status_times(db, [order])
    return {
        **ReagentOrderResponse.model_validate(order).model_dump(mode="json"),
        "specification": format_specification(order.initial_quantity, order.unit),
        **get_order_status_time_fields(status_times, order),
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


def _normalize_workflow_order_updates(payload: ReagentWorkflowEditableFields) -> dict[str, Any]:
    # 将到货/入库弹窗里的可编辑试剂信息标准化为订单字段更新。
    update_data = payload.model_dump(exclude_unset=True)
    arrival_notes = update_data.pop("arrival_notes", None)
    update_data.pop("storage_location", None)
    update_data.pop("remaining_quantity", None)

    if "notes" not in update_data and arrival_notes is not None:
        update_data["notes"] = arrival_notes

    if "name" in update_data:
        normalized_name = update_data["name"].strip() if update_data["name"] else ""
        if not normalized_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
        update_data["name"] = normalized_name

    if "brand" in update_data:
        normalized_brand = update_data["brand"].strip() if update_data["brand"] else ""
        if not normalized_brand:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")
        update_data["brand"] = normalized_brand

    if "specification" in update_data:
        specification = update_data.pop("specification")
        if specification is not None:
            try:
                initial_quantity, unit = parse_specification(specification)
            except SpecificationError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
            update_data["initial_quantity"] = initial_quantity
            update_data["unit"] = unit

    optional_string_fields = ["english_name", "alias", "category", "purity", "unit", "notes"]
    normalized_strings = empty_to_none(update_data, optional_string_fields)
    for field in optional_string_fields:
        if field in update_data:
            update_data[field] = normalized_strings[field]

    return update_data


def _ensure_workflow_order_brand(order: ReagentOrder) -> None:
    if not (order.brand and order.brand.strip()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")


def _normalize_required_storage_location(storage_location: Optional[str]) -> str:
    normalized = normalize_storage_location(storage_location)
    if normalized is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="storage_location is required",
        )
    return normalized


def _apply_order_pinyin_updates(order: ReagentOrder, *, update_data: dict[str, Any]) -> None:
    # 名称/分类/品牌变更后同步刷新订单拼音字段。
    if not any(key in update_data for key in ("name", "category", "brand")):
        return
    pinyin_fields = compute_pinyin_fields(
        name=update_data.get("name", order.name),
        category=update_data.get("category", order.category),
        brand=update_data.get("brand", order.brand),
    )
    update_data["name_pinyin"] = pinyin_fields.get("name_pinyin")
    update_data["name_pinyin_initials"] = pinyin_fields.get("name_pinyin_initials")
    update_data["category_pinyin"] = pinyin_fields.get("category_pinyin")
    update_data["category_pinyin_initials"] = pinyin_fields.get("category_pinyin_initials")
    update_data["brand_pinyin"] = pinyin_fields.get("brand_pinyin")
    update_data["brand_pinyin_initials"] = pinyin_fields.get("brand_pinyin_initials")


def _apply_workflow_order_updates(
    order: ReagentOrder,
    payload: ReagentWorkflowEditableFields,
) -> Optional[ReagentOrder]:
    # 返回更新前快照用于审计；没有实际字段变化时不生成日志。
    update_data = _normalize_workflow_order_updates(payload)
    _apply_order_pinyin_updates(order, update_data=update_data)
    if not update_data:
        return None
    if all(getattr(order, field, None) == value for field, value in update_data.items()):
        return None

    before_order = ReagentOrder.model_validate(order)
    for field, value in update_data.items():
        setattr(order, field, value)
    return before_order


def _log_workflow_order_update(
    db: Session,
    *,
    before_order: Optional[ReagentOrder],
    order: ReagentOrder,
    operator_id: int,
    is_cli: bool,
) -> None:
    if before_order is None:
        return
    log_reagent_order_update(
        db,
        before_order=before_order,
        after_order=order,
        actor_user_id=operator_id,
        is_cli=is_cli,
    )


def _clear_inventory_projection_cache() -> None:
    from app.api.inventory import (
        LIST_CACHE_PREFIX as INVENTORY_LIST_CACHE_PREFIX,
        SEARCH_CACHE as INVENTORY_SEARCH_CACHE,
    )

    clear_cache_by_prefix(INVENTORY_SEARCH_CACHE, prefix=INVENTORY_LIST_CACHE_PREFIX)
    mark_entity_completion_index_stale(INVENTORY_COMPLETION_ENDPOINT)


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
                        notes=order.notes,
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
    group_existed_before: bool,
) -> None:
    if not items:
        return

    group_identity = get_group_identity_from_item(items[0])
    group_fields = CommonShelfGroupFields(
        cas_number=group_identity.cas_number,
        brand_normalized=group_identity.brand_normalized,
        specification_normalized=group_identity.specification_normalized,
    )
    group_row = get_common_shelf_group_row_payload(db, group_fields=group_fields)
    payload: dict[str, Any] = {"id": group_identity.group_key, "group_key": group_identity.group_key}
    if group_row is not None:
        payload["item"] = group_row
        payload["group_key"] = str(group_row["id"])

    await sse_manager.broadcast(
        SSERoom.COMMON_SHELF,
        (
            SSEEventType.COMMON_SHELF_UPDATED
            if group_existed_before
            else SSEEventType.COMMON_SHELF_CREATED
        ),
        payload,
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

        if order.status not in REAGENT_ORDER_APPROVABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve order with status: {order.status}",
            )

        before_order = ReagentOrder.model_validate(order)
        _claim_reagent_order_status_transition_from(
            db,
            order_id=order_id,
            expected_statuses=REAGENT_ORDER_APPROVABLE_STATUSES,
            target_status=ReagentOrderStatus.APPROVED,
        )
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
        _clear_reagent_workflow_cache(search_cache)
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

        if order.status not in REAGENT_ORDER_REJECTABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject order with status: {order.status}",
            )

        before_order = ReagentOrder.model_validate(order)
        _claim_reagent_order_status_transition_from(
            db,
            order_id=order_id,
            expected_statuses=REAGENT_ORDER_REJECTABLE_STATUSES,
            target_status=ReagentOrderStatus.REJECTED,
        )
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
        _clear_reagent_workflow_cache(search_cache)
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
        background_tasks: BackgroundTasks,
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

        before_order = _apply_workflow_order_updates(order, body)
        _ensure_workflow_order_brand(order)
        _validate_positive_remaining_quantity(
            body.remaining_quantity,
            initial_quantity=order.initial_quantity,
        )

        direct_storage_location = normalize_storage_location(body.storage_location)
        target_status = (
            ReagentOrderStatus.STOCKED
            if order.order_reason == ReagentOrderReason.COMMON_PUBLIC or direct_storage_location
            else ReagentOrderStatus.ARRIVED
        )
        _claim_reagent_order_status_transition(
            db,
            order_id=order_id,
            expected_status=ReagentOrderStatus.APPROVED,
            target_status=target_status,
        )
        order.status = target_status

        if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
            _, _, specification_normalized, _ = normalize_specification_for_group(
                order.initial_quantity,
                order.unit,
            )
            target_group_fields = CommonShelfGroupFields(
                cas_number=normalize_cas(order.cas_number),
                brand_normalized=normalize_brand_for_group(order.brand),
                specification_normalized=specification_normalized,
            )
            group_existed_before = (
                get_active_common_shelf_group(
                    db,
                    cas_number=target_group_fields.cas_number,
                    brand_normalized=target_group_fields.brand_normalized,
                    specification_normalized=target_group_fields.specification_normalized,
                )
                is not None
            )
            common_shelf_items = create_common_shelf_items_from_order(
                db,
                order,
                created_by_id=current_user.id,
                storage_location=direct_storage_location,
            )
            message = "已到货并加入常用货架"
            _log_workflow_order_update(
                db,
                before_order=before_order,
                order=order,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            _log_common_stock_in_operations(
                db,
                items=common_shelf_items,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            db.commit()
            db.refresh(order)
            _clear_reagent_workflow_cache(search_cache)
            await sse_manager.broadcast(
                SSERoom.REAGENT_ORDERS,
                SSEEventType.REAGENT_ORDER_UPDATED,
                {"id": order_id, "item": _serialize_reagent_order(order, db)},
            )
            await _broadcast_common_shelf_events(
                db,
                common_shelf_items,
                group_existed_before=group_existed_before,
            )
            enqueue_structure_cache_resolution(
                background_tasks,
                order.cas_number,
                reason="reagent_order.confirm_arrival.common_shelf",
            )

            return {
                "message": message,
                "order_id": order.id,
                "status": order.status,
                "notes": order.notes,
                "items_created": len(common_shelf_items),
            }
        elif direct_storage_location:
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                options=InventoryCreateOptions(
                    created_by_id=current_user.id,
                    temporary_keeper_id=None,
                    storage_location=direct_storage_location,
                    inventory_status=InventoryStatus.IN_STOCK,
                    remaining_quantity=body.remaining_quantity,
                ),
            )
            message = "已到货并入库"
        else:
            inventory_items = _create_inventory_items_from_order(
                db,
                order,
                options=InventoryCreateOptions(
                    created_by_id=current_user.id,
                    temporary_keeper_id=current_user.id,
                    storage_location=None,
                    inventory_status=InventoryStatus.IN_STOCK,
                    remaining_quantity=body.remaining_quantity,
                ),
            )
            message = "已到货并进入暂存区，请及时补全入库信息"

        _log_workflow_order_update(
            db,
            before_order=before_order,
            order=order,
            operator_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
        _log_stock_in_operations(
            db,
            items=inventory_items,
            operator_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
        db.commit()
        db.refresh(order)
        _clear_reagent_workflow_cache(search_cache)
        await sse_manager.broadcast(
            SSERoom.REAGENT_ORDERS,
            SSEEventType.REAGENT_ORDER_UPDATED,
            {"id": order_id, "item": _serialize_reagent_order(order, db)},
        )
        _clear_inventory_projection_cache()
        await _broadcast_inventory_projection_events(db, inventory_items, created=True)
        enqueue_structure_cache_resolution(
            background_tasks,
            order.cas_number,
            reason="reagent_order.confirm_arrival.inventory",
        )

        return {
            "message": message,
            "order_id": order.id,
            "status": order.status,
            "notes": order.notes,
            "items_created": len(inventory_items),
        }


def _build_reagent_dashboard_groups(
    orders: list[ReagentOrder],
    users_map: dict[int, str],
    status_times,
) -> dict[str, dict[str, Any]]:
    grouped_orders: dict[str, dict[str, Any]] = {
        status.value: {
            "status": status.value,
            "orders": [],
            "count": 0,
        }
        for status in DASHBOARD_REAGENT_STATUSES
    }

    for order in orders:
        order_data = {
            "order_id": order.id,
            "cas_number": order.cas_number,
            "name": order.name,
            "english_name": order.english_name,
            "alias": order.alias,
            "category": order.category,
            "brand": order.brand,
            "specification": format_specification(order.initial_quantity, order.unit),
            "initial_quantity": order.initial_quantity,
            "unit": order.unit,
            "quantity": order.quantity,
            "price": order.price,
            "is_hazardous": order.is_hazardous,
            "notes": order.notes,
            "purity": order.purity,
            "order_reason": order.order_reason,
            "applicant_id": order.applicant_id,
            "applicant_name": users_map.get(order.applicant_id) if order.applicant_id else "",
            "created_at": utc_iso_str(order.created_at),
            "updated_at": utc_iso_str(order.updated_at),
            **get_order_status_time_fields(status_times, order),
        }

        status_key = order.status.value if hasattr(order.status, "value") else str(order.status)
        if status_key not in grouped_orders:
            grouped_orders[status_key] = {"status": status_key, "orders": [], "count": 0}
        grouped_orders[status_key]["orders"].append(order_data)

    for key in grouped_orders:
        grouped_orders[key]["count"] = len(grouped_orders[key]["orders"])

    return grouped_orders


def _admin_reagent_dashboard_clause(cutoff):
    return or_(
        ReagentOrder.status.in_([ReagentOrderStatus.PENDING, ReagentOrderStatus.APPROVED]),
        and_(
            ReagentOrder.status == ReagentOrderStatus.REJECTED,
            ReagentOrder.updated_at >= cutoff,
        ),
    )


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
        statement = select(ReagentOrder).where(
            ReagentOrder.applicant_id == current_user.id,
            ReagentOrder.status.in_(DASHBOARD_REAGENT_STATUSES),
        ).order_by(ReagentOrder.created_at.desc())

        orders = db.exec(statement).all()
        users_map = {current_user.id: current_user.full_name}
        status_times = get_reagent_order_status_times(db, orders)

        return {
            "data": _build_reagent_dashboard_groups(orders, users_map, status_times),
            "total": len(orders),
        }

    @router.get("/dashboard/admin/reagent-orders", dependencies=[Depends(require_admin)])
    def get_admin_reagent_orders(db: DBSession):
        cutoff = get_utc_now() - timedelta(days=DASHBOARD_ACTIVE_REJECTED_DAYS)
        statement = (
            select(ReagentOrder)
            .where(_admin_reagent_dashboard_clause(cutoff))
            .order_by(ReagentOrder.created_at.desc())
        )

        orders = db.exec(statement).all()
        applicant_ids = {order.applicant_id for order in orders if order.applicant_id}
        users_map = batch_get_user_names(db, applicant_ids)
        status_times = get_reagent_order_status_times(db, orders)

        return {
            "data": _build_reagent_dashboard_groups(orders, users_map, status_times),
            "total": len(orders),
        }


# 校验 stock-in 请求体字段，保持对 null remaining_quantity 的显式拦截语义。
def _validate_stock_in_payload(payload: StockInRequest) -> None:
    if "remaining_quantity" in payload.model_fields_set and payload.remaining_quantity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remaining_quantity cannot be null",
        )


# 校验 stock-in 的权限和订单状态，确保更新字段前不会越权变更订单。
def _validate_stock_in_order_access(
    order: ReagentOrder,
    *,
    current_user: CurrentUser,
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
    if order.order_reason == ReagentOrderReason.COMMON_PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Common-public orders are stocked at confirm-arrival time",
        )


# 校验 stock-in 的订单数据和入库数量，允许前置同步字段先修正规格。
def _validate_stock_in_order(
    order: ReagentOrder,
    *,
    payload: StockInRequest,
) -> None:
    if order.quantity is None or order.quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order quantity")
    if order.initial_quantity is None or order.unit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order missing initial_quantity or unit. Please update the order.",
        )

    _validate_positive_remaining_quantity(payload.remaining_quantity, initial_quantity=order.initial_quantity)
    if order.status == ReagentOrderStatus.ARRIVED and payload.remaining_quantity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remaining_quantity is required for ARRIVED orders",
        )


# 计算 stock-in 的目标库存属性，复用 APPROVED/ARRIVED 两条路径。
def _build_stock_in_context(order: ReagentOrder, payload: StockInRequest) -> tuple[Optional[str], float]:
    target_location = _normalize_required_storage_location(payload.storage_location)
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
def _get_arrived_pending_items(
    db: Session,
    order: ReagentOrder,
    *,
    current_user: CurrentUser,
) -> list[Inventory]:
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
    if current_user.role != UserRole.ADMIN and any(
        item.temporary_keeper_id != current_user.id
        for item in pending_items[: order.quantity]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the temporary keeper can stock in pending items",
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
        item.name = order.name
        item.english_name = order.english_name
        item.alias = order.alias
        item.category = order.category
        item.brand = order.brand
        item.purity = order.purity
        item.initial_quantity = order.initial_quantity
        item.unit = order.unit
        item.is_hazardous = order.is_hazardous
        item.notes = order.notes
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
    _clear_reagent_workflow_cache(search_cache)
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
    # 原子删除消除竞争；未删到时维持 404/403 区分语义。
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DELETE_ORDER_PUBLIC_FORBIDDEN_DETAIL,
        )

    delete_stmt = (
        delete(ReagentOrder)
        .where(ReagentOrder.id == order_id)
        .where(~ReagentOrder.status.in_(REAGENT_ORDER_DELETE_LOCKED_STATUSES))
    )
    if current_user.role != UserRole.ADMIN:
        delete_stmt = delete_stmt.where(ReagentOrder.applicant_id == current_user.id)
    deleted_item = exec_delete_returning_first(db, delete_stmt, ReagentOrder)
    if deleted_item is not None:
        return deleted_item

    existing_order = _get_reagent_order_by_id(db, order_id)
    if existing_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)
    if existing_order.applicant_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DELETE_ORDER_FORBIDDEN_DETAIL,
        )
    _ensure_reagent_order_deletable(existing_order)
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
        _clear_reagent_workflow_cache(search_cache)
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
        background_tasks: BackgroundTasks,
        current_user: CurrentUser,
        db: DBSession,
    ):
        # 执行订单入库流程。
        _validate_stock_in_payload(payload)
        order = _get_reagent_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ORDER_NOT_FOUND)

        _validate_stock_in_order_access(order, current_user=current_user)
        before_order = _apply_workflow_order_updates(order, payload)
        _ensure_workflow_order_brand(order)
        _validate_stock_in_order(order, payload=payload)
        stock_context = _build_stock_in_context(order, payload)
        target_location, effective_remaining = stock_context

        original_status = order.status
        _claim_reagent_order_status_transition(
            db,
            order_id=order_id,
            expected_status=original_status,
            target_status=ReagentOrderStatus.STOCKED,
        )
        order.status = ReagentOrderStatus.STOCKED

        if original_status == ReagentOrderStatus.APPROVED:
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
            _log_workflow_order_update(
                db,
                before_order=before_order,
                order=order,
                operator_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            await _finalize_stock_in_order(db, order=order, order_id=order_id, search_cache=search_cache)
            _clear_inventory_projection_cache()
            await _broadcast_inventory_projection_events(db, inventory_items, created=True)
            for item in inventory_items:
                db.refresh(item)
            enqueue_structure_cache_resolution(
                background_tasks,
                order.cas_number,
                reason="reagent_order.stock_in.create",
            )
            return {
                "message": "已入库",
                "order_id": order.id,
                "items_updated": 0,
                "items_created": len(inventory_items),
                "inventory_ids": [item.id for item in inventory_items],
            }

        target_items = _get_arrived_pending_items(db, order, current_user=current_user)
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
        _log_workflow_order_update(
            db,
            before_order=before_order,
            order=order,
            operator_id=current_user.id,
            is_cli=get_request_is_cli(request),
        )
        await _finalize_stock_in_order(db, order=order, order_id=order_id, search_cache=search_cache)
        _clear_inventory_projection_cache()
        await _broadcast_inventory_projection_events(db, target_items, created=False)
        enqueue_structure_cache_resolution(
            background_tasks,
            order.cas_number,
            reason="reagent_order.stock_in.update",
        )
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
