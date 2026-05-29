"""Regular inventory lookup helpers for procedure CAS results."""
from __future__ import annotations

from typing import Any

from sqlalchemy import case
from sqlmodel import Session

from app.models.inventory import Inventory
from app.services.api_utils import serialize_inventory_items
from app.services.cas_utils import normalize_cas
from app.services.inventory_queries import regular_inventory_query
from app.services.procedure_inventory_models import (
    ProcedureInventoryGroup,
    ProcedureResolvedReagent,
)
from app.services.search_matchers import build_chunked_in_clause
from app.services.structure_inventory_summary import normalized_inventory_cas_expr


def load_inventory_groups(
    db: Session,
    cas_order: list[str],
    resolved: list[ProcedureResolvedReagent],
) -> list[ProcedureInventoryGroup]:
    if not cas_order:
        return []
    statement = (
        regular_inventory_query()
        .where(build_chunked_in_clause(normalized_inventory_cas_expr(), cas_order))
        .order_by(_cas_order_expr(cas_order), Inventory.created_at.desc(), Inventory.id.desc())
    )
    items = serialize_inventory_items(db, db.exec(statement).all())
    return _group_inventory_items(items, cas_order, _names_by_cas(resolved))


def attach_inventory_counts(
    resolved: list[ProcedureResolvedReagent],
    groups: list[ProcedureInventoryGroup],
) -> list[ProcedureResolvedReagent]:
    counts = {group.cas_number: len(group.items) for group in groups}
    for item in resolved:
        item.inventory_count = counts.get(item.cas_number, 0)
    return resolved


def unique_cas_order(cas_numbers: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for cas_number in cas_numbers:
        normalized = normalize_cas(cas_number)
        if normalized and normalized not in seen:
            result.append(normalized)
            seen.add(normalized)
    return result


def _cas_order_expr(cas_order: list[str]):
    order_map = {cas_number: index for index, cas_number in enumerate(cas_order)}
    return case(order_map, value=normalized_inventory_cas_expr(), else_=len(cas_order)).asc()


def _group_inventory_items(
    items: list[dict[str, Any]],
    cas_order: list[str],
    names_by_cas: dict[str, list[str]],
) -> list[ProcedureInventoryGroup]:
    items_by_cas: dict[str, list[dict[str, Any]]] = {cas_number: [] for cas_number in cas_order}
    for item in items:
        cas_number = normalize_cas(str(item.get("cas_number") or ""))
        if cas_number in items_by_cas:
            items_by_cas[cas_number].append(item)
    return [
        ProcedureInventoryGroup(
            cas_number=cas_number,
            reagent_names=names_by_cas.get(cas_number, []),
            items=items_by_cas[cas_number],
        )
        for cas_number in cas_order
    ]


def _names_by_cas(resolved: list[ProcedureResolvedReagent]) -> dict[str, list[str]]:
    names: dict[str, list[str]] = {}
    for item in resolved:
        names.setdefault(item.cas_number, []).append(item.name)
    return names
