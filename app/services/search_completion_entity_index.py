"""实体补全索引，用于内联搜索预测。"""
from __future__ import annotations

import logging
from collections.abc import Callable

from sqlmodel import Session, select

from app.core.config import settings

from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.search_completion_db import (
    CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
    INVENTORY_COMPLETION_ENDPOINT,
    REAGENT_ORDER_COMPLETION_ENDPOINT,
    TARGET_ENDPOINTS,
    completion_write_timeout,
    delete_entity_completions_for_entity,
    get_entity_completion_generation,
    is_entity_completion_index_stale,
    mark_entity_completion_index_stale,
    replace_entity_completions_for_entity,
    replace_entity_completion_index,
)
from app.services.search_completion_lock import completion_rebuild_lock
from app.services.sql_utils import normalize_search_term
from app.services.user_utils import batch_get_user_names

logger = logging.getLogger(__name__)

# (endpoint, field, value, normalized_value, entity_type, entity_id, display_meta, operational_score)
EntityRow = tuple[str, str, str, str, str, str, str | None, float]


def run_completion_index_update(
    operation: Callable[[], None],
    *,
    context: str,
    endpoint: str,
) -> None:
    """Run an auxiliary update and schedule an endpoint rebuild after failures."""

    if settings.inventory_read_only:
        return
    with completion_write_timeout(0.1):
        try:
            operation()
        except Exception:
            logger.exception(
                "search_completion_update_failed context=%s endpoint=%s; "
                "preserving the committed business result",
                context,
                endpoint,
            )
            try:
                mark_entity_completion_index_stale(endpoint)
            except Exception:
                from app.services.search_completion_scheduler import completion_scheduler

                completion_scheduler.invalidate(endpoint)
                logger.exception(
                    "search_completion_stale_mark_failed context=%s endpoint=%s; "
                    "background retry scheduled",
                    context,
                    endpoint,
                )


_INVENTORY_STATUS_SCORE: dict[str, float] = {
    InventoryStatus.IN_STOCK: 1.0,
    InventoryStatus.BORROWED: 0.7,
    InventoryStatus.RUN_SHORT: 0.8,
    InventoryStatus.NOT_IN_STOCK: 0.3,
    InventoryStatus.CONSUMED: 0.1,
}

_REAGENT_STATUS_SCORE: dict[str, float] = {
    ReagentOrderStatus.PENDING: 1.0,
    ReagentOrderStatus.APPROVED: 0.8,
    ReagentOrderStatus.ARRIVED: 0.6,
    ReagentOrderStatus.STOCKED: 0.5,
    ReagentOrderStatus.REJECTED: 0.2,
}

_CONSUMABLE_STATUS_SCORE: dict[str, float] = {
    ConsumableOrderStatus.PENDING: 1.0,
    ConsumableOrderStatus.APPROVED: 0.8,
    ConsumableOrderStatus.COMPLETED: 0.5,
    ConsumableOrderStatus.REJECTED: 0.2,
}


def _normalize(value: str | None) -> str:
    return normalize_search_term(value or "").casefold()


def _build_inventory_rows(item: Inventory) -> list[EntityRow]:
    score = _INVENTORY_STATUS_SCORE.get(item.status.value, 0.5)
    return [
        (
            INVENTORY_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "inventory", str(item.id), None, score,
        )
        for field, value in [
            ("name", item.name),
            ("cas_number", item.cas_number),
            ("storage_location", item.storage_location),
            ("brand", item.brand),
            ("category", item.category),
        ]
        if value
    ]


def _build_reagent_rows(
    order: ReagentOrder,
    applicant_name: str | None,
) -> list[EntityRow]:
    score = _REAGENT_STATUS_SCORE.get(order.status.value, 0.5)
    return [
        (
            REAGENT_ORDER_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "reagent_order", str(order.id), None, score,
        )
        for field, value in [
            ("name", order.name),
            ("cas_number", order.cas_number),
            ("brand", order.brand),
            ("category", order.category),
            ("applicant", applicant_name),
        ]
        if value
    ]


def _build_consumable_rows(
    order: ConsumableOrder,
    applicant_name: str | None,
) -> list[EntityRow]:
    score = _CONSUMABLE_STATUS_SCORE.get(order.status.value, 0.5)
    return [
        (
            CONSUMABLE_ORDER_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "consumable_order", str(order.id), None, score,
        )
        for field, value in [
            ("name", order.name),
            ("specification", order.specification),
            ("communication", order.communication),
            ("applicant", applicant_name),
        ]
        if value
    ]


def _build_inventory_index(db: Session) -> tuple[list[EntityRow], int]:
    inventory_items = list(db.exec(select(Inventory)).all())
    return [row for item in inventory_items for row in _build_inventory_rows(item)], len(inventory_items)


def _build_reagent_index(db: Session) -> tuple[list[EntityRow], int]:
    reagent_orders = list(db.exec(select(ReagentOrder)).all())
    user_ids = {order.applicant_id for order in reagent_orders if order.applicant_id}
    user_names = batch_get_user_names(db, user_ids)
    rows = [
        row for order in reagent_orders
        for row in _build_reagent_rows(order, user_names.get(order.applicant_id))
    ]
    return rows, len(reagent_orders)


def _build_consumable_index(db: Session) -> tuple[list[EntityRow], int]:
    consumable_orders = list(db.exec(select(ConsumableOrder)).all())
    user_ids = {order.applicant_id for order in consumable_orders if order.applicant_id}
    user_names = batch_get_user_names(db, user_ids)
    rows = [
        row for order in consumable_orders
        for row in _build_consumable_rows(order, user_names.get(order.applicant_id))
    ]
    return rows, len(consumable_orders)


def _entity_index_endpoints(endpoint: str | None) -> tuple[str, ...]:
    if endpoint is None:
        return TARGET_ENDPOINTS
    if endpoint not in TARGET_ENDPOINTS:
        raise ValueError(f"Unsupported search completion endpoint: {endpoint}")
    return (endpoint,)


def _build_endpoint_rows(db: Session, endpoint: str) -> tuple[list[EntityRow], int]:
    if endpoint == INVENTORY_COMPLETION_ENDPOINT:
        return _build_inventory_index(db)
    if endpoint == REAGENT_ORDER_COMPLETION_ENDPOINT:
        return _build_reagent_index(db)
    if endpoint == CONSUMABLE_ORDER_COMPLETION_ENDPOINT:
        return _build_consumable_index(db)
    raise ValueError(f"Unsupported search completion endpoint: {endpoint}")


def rebuild_completion_entity_index(
    db: Session, endpoint: str | None = None, *, only_if_stale: bool = False,
) -> None:
    with completion_rebuild_lock() as acquired:
        if not acquired:
            return
        _rebuild_completion_entity_index(db, endpoint, only_if_stale=only_if_stale)


def _rebuild_completion_entity_index(
    db: Session, endpoint: str | None, *, only_if_stale: bool,
) -> None:
    for current_endpoint in _entity_index_endpoints(endpoint):
        if only_if_stale and not is_entity_completion_index_stale(current_endpoint):
            continue
        logger.info("Rebuilding entity completion index endpoint=%s", current_endpoint)
        generation = get_entity_completion_generation(current_endpoint)
        rows, entity_count = _build_endpoint_rows(db, current_endpoint)

        if not replace_entity_completion_index(current_endpoint, rows, generation):
            logger.info("Completion index changed during rebuild endpoint=%s; retry later", current_endpoint)
            continue

        logger.info(
            "Entity completion index rebuilt endpoint=%s entities=%d rows=%d",
            current_endpoint,
            entity_count,
            len(rows),
        )


def rebuild_completion_entity_index_if_stale(db: Session, endpoint: str) -> None:
    if is_entity_completion_index_stale(endpoint):
        rebuild_completion_entity_index(db, endpoint, only_if_stale=True)


# ---------- 增量同步（单条记录） ----------


def sync_inventory_entity_completions(item: Inventory) -> None:
    replace_entity_completions_for_entity(
        INVENTORY_COMPLETION_ENDPOINT, "inventory", str(item.id), _build_inventory_rows(item),
    )


def delete_inventory_entity_completions(inventory_id: int) -> None:
    delete_entity_completions_for_entity(
        INVENTORY_COMPLETION_ENDPOINT, "inventory", str(inventory_id),
    )


def sync_reagent_order_entity_completions(
    order: ReagentOrder, applicant_name: str | None = None, db: Session | None = None,
) -> None:
    if applicant_name is None and order.applicant_id and db is not None:
        applicant_name = batch_get_user_names(db, {order.applicant_id}).get(order.applicant_id)
    replace_entity_completions_for_entity(
        REAGENT_ORDER_COMPLETION_ENDPOINT, "reagent_order", str(order.id),
        _build_reagent_rows(order, applicant_name),
    )


def delete_reagent_order_entity_completions(order_id: int) -> None:
    delete_entity_completions_for_entity(
        REAGENT_ORDER_COMPLETION_ENDPOINT, "reagent_order", str(order_id),
    )


def sync_consumable_order_entity_completions(
    order: ConsumableOrder, applicant_name: str | None = None, db: Session | None = None,
) -> None:
    if applicant_name is None and order.applicant_id and db is not None:
        applicant_name = batch_get_user_names(db, {order.applicant_id}).get(order.applicant_id)
    replace_entity_completions_for_entity(
        CONSUMABLE_ORDER_COMPLETION_ENDPOINT, "consumable_order", str(order.id),
        _build_consumable_rows(order, applicant_name),
    )


def delete_consumable_order_entity_completions(order_id: int) -> None:
    delete_entity_completions_for_entity(
        CONSUMABLE_ORDER_COMPLETION_ENDPOINT, "consumable_order", str(order_id),
    )
