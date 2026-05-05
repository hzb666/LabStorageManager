"""实体补全索引，用于内联搜索预测。"""
from __future__ import annotations

import logging
from sqlmodel import Session, select

from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.user import User
from app.search_completion_db import (
    CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
    INVENTORY_COMPLETION_ENDPOINT,
    REAGENT_ORDER_COMPLETION_ENDPOINT,
    TARGET_ENDPOINTS,
    bulk_insert_entity_completions,
    clear_entity_completion_index_stale,
    clear_entity_completion_index,
    delete_entity_completions_for_entity,
    is_entity_completion_index_stale,
    replace_entity_completions_for_entity,
)
from app.services.sql_utils import normalize_search_term

logger = logging.getLogger(__name__)

# (endpoint, field, value, normalized_value, entity_type, entity_id, display_meta, operational_score)
EntityRow = tuple[str, str, str, str, str, str, str | None, float]


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


def _resolve_user_names(db: Session, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = db.exec(select(User.id, User.full_name, User.username).where(User.id.in_(user_ids)))
    return {
        uid: (full_name or username or "")
        for uid, full_name, username in rows
    }


def _build_inventory_rows(items: list[Inventory]) -> list[EntityRow]:
    rows: list[EntityRow] = []
    for item in items:
        entity_id = str(item.id)
        score = _INVENTORY_STATUS_SCORE.get(item.status.value, 0.5)
        for field, value in [
            ("name", item.name),
            ("cas_number", item.cas_number),
            ("storage_location", item.storage_location),
            ("brand", item.brand),
            ("category", item.category),
        ]:
            if not value:
                continue
            rows.append((
                INVENTORY_COMPLETION_ENDPOINT,
                field,
                value,
                _normalize(value),
                "inventory",
                entity_id,
                None,
                score,
            ))
    return rows


def _build_reagent_rows(
    orders: list[ReagentOrder],
    user_names: dict[int, str],
) -> list[EntityRow]:
    rows: list[EntityRow] = []
    for order in orders:
        entity_id = str(order.id)
        score = _REAGENT_STATUS_SCORE.get(order.status.value, 0.5)
        for field, value in [
            ("name", order.name),
            ("cas_number", order.cas_number),
            ("brand", order.brand),
            ("category", order.category),
        ]:
            if not value:
                continue
            rows.append((
                REAGENT_ORDER_COMPLETION_ENDPOINT,
                field,
                value,
                _normalize(value),
                "reagent_order",
                entity_id,
                None,
                score,
            ))

        if order.applicant_id:
            applicant_name = user_names.get(order.applicant_id, "")
            if applicant_name:
                rows.append((
                    REAGENT_ORDER_COMPLETION_ENDPOINT,
                    "applicant",
                    applicant_name,
                    _normalize(applicant_name),
                    "reagent_order",
                    entity_id,
                    None,
                    score,
                ))
    return rows


def _build_consumable_rows(
    orders: list[ConsumableOrder],
    user_names: dict[int, str],
) -> list[EntityRow]:
    rows: list[EntityRow] = []
    for order in orders:
        entity_id = str(order.id)
        score = _CONSUMABLE_STATUS_SCORE.get(order.status.value, 0.5)
        for field, value in [
            ("name", order.name),
            ("specification", order.specification),
            ("communication", order.communication),
        ]:
            if not value:
                continue
            rows.append((
                CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
                field,
                value,
                _normalize(value),
                "consumable_order",
                entity_id,
                None,
                score,
            ))

        if order.applicant_id:
            applicant_name = user_names.get(order.applicant_id, "")
            if applicant_name:
                rows.append((
                    CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
                    "applicant",
                    applicant_name,
                    _normalize(applicant_name),
                    "consumable_order",
                    entity_id,
                    None,
                    score,
                ))
    return rows


def _build_inventory_index(db: Session) -> tuple[list[EntityRow], int]:
    inventory_items = list(db.exec(select(Inventory)).all())
    return _build_inventory_rows(inventory_items), len(inventory_items)


def _build_reagent_index(db: Session) -> tuple[list[EntityRow], int]:
    reagent_orders = list(db.exec(select(ReagentOrder)).all())
    user_ids: set[int] = set()
    for order in reagent_orders:
        if order.applicant_id:
            user_ids.add(order.applicant_id)
    user_names = _resolve_user_names(db, user_ids)
    return _build_reagent_rows(reagent_orders, user_names), len(reagent_orders)


def _build_consumable_index(db: Session) -> tuple[list[EntityRow], int]:
    consumable_orders = list(db.exec(select(ConsumableOrder)).all())
    user_ids: set[int] = set()
    for order in consumable_orders:
        if order.applicant_id:
            user_ids.add(order.applicant_id)
    user_names = _resolve_user_names(db, user_ids)
    return _build_consumable_rows(consumable_orders, user_names), len(consumable_orders)


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


def rebuild_completion_entity_index(db: Session, endpoint: str | None = None) -> None:
    for current_endpoint in _entity_index_endpoints(endpoint):
        logger.info("Rebuilding entity completion index endpoint=%s", current_endpoint)
        rows, entity_count = _build_endpoint_rows(db, current_endpoint)

        clear_entity_completion_index(current_endpoint)
        if rows:
            bulk_insert_entity_completions(rows)
        clear_entity_completion_index_stale(current_endpoint)

        logger.info(
            "Entity completion index rebuilt endpoint=%s entities=%d rows=%d",
            current_endpoint,
            entity_count,
            len(rows),
        )


def rebuild_completion_entity_index_if_stale(db: Session, endpoint: str) -> None:
    if is_entity_completion_index_stale(endpoint):
        rebuild_completion_entity_index(db, endpoint)


# ---------- 增量同步（单条记录） ----------


def sync_inventory_entity_completions(item: Inventory) -> None:
    entity_id = str(item.id)
    score = _INVENTORY_STATUS_SCORE.get(item.status.value, 0.5)
    rows: list[EntityRow] = []
    for field, value in [
        ("name", item.name),
        ("cas_number", item.cas_number),
        ("storage_location", item.storage_location),
        ("brand", item.brand),
        ("category", item.category),
    ]:
        if not value:
            continue
        rows.append((
            INVENTORY_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "inventory", entity_id, None, score,
        ))
    replace_entity_completions_for_entity(
        INVENTORY_COMPLETION_ENDPOINT, "inventory", entity_id, rows,
    )


def delete_inventory_entity_completions(inventory_id: int) -> None:
    delete_entity_completions_for_entity(
        INVENTORY_COMPLETION_ENDPOINT, "inventory", str(inventory_id),
    )


def sync_reagent_order_entity_completions(
    order: ReagentOrder, applicant_name: str | None = None, db: Session | None = None,
) -> None:
    if applicant_name is None and order.applicant_id and db is not None:
        applicant_name = _resolve_user_names(db, {order.applicant_id}).get(order.applicant_id)
    entity_id = str(order.id)
    score = _REAGENT_STATUS_SCORE.get(order.status.value, 0.5)
    rows: list[EntityRow] = []
    for field, value in [
        ("name", order.name),
        ("cas_number", order.cas_number),
        ("brand", order.brand),
        ("category", order.category),
    ]:
        if not value:
            continue
        rows.append((
            REAGENT_ORDER_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "reagent_order", entity_id, None, score,
        ))
    if applicant_name:
        rows.append((
            REAGENT_ORDER_COMPLETION_ENDPOINT, "applicant", applicant_name,
            _normalize(applicant_name), "reagent_order", entity_id, None, score,
        ))
    replace_entity_completions_for_entity(
        REAGENT_ORDER_COMPLETION_ENDPOINT, "reagent_order", entity_id, rows,
    )


def sync_consumable_order_entity_completions(
    order: ConsumableOrder, applicant_name: str | None = None, db: Session | None = None,
) -> None:
    if applicant_name is None and order.applicant_id and db is not None:
        applicant_name = _resolve_user_names(db, {order.applicant_id}).get(order.applicant_id)
    entity_id = str(order.id)
    score = _CONSUMABLE_STATUS_SCORE.get(order.status.value, 0.5)
    rows: list[EntityRow] = []
    for field, value in [
        ("name", order.name),
        ("specification", order.specification),
        ("communication", order.communication),
    ]:
        if not value:
            continue
        rows.append((
            CONSUMABLE_ORDER_COMPLETION_ENDPOINT, field, value, _normalize(value),
            "consumable_order", entity_id, None, score,
        ))
    if applicant_name:
        rows.append((
            CONSUMABLE_ORDER_COMPLETION_ENDPOINT, "applicant", applicant_name,
            _normalize(applicant_name), "consumable_order", entity_id, None, score,
        ))
    replace_entity_completions_for_entity(
        CONSUMABLE_ORDER_COMPLETION_ENDPOINT, "consumable_order", entity_id, rows,
    )
