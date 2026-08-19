"""Inventory aggregation helpers for structure search results."""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session, func, select

from app.models.inventory import Inventory, InventoryStatus
from app.services.cas_utils import normalize_cas

VISIBLE_STOCK_STATUSES = {
    InventoryStatus.IN_STOCK,
    InventoryStatus.RUN_SHORT,
    InventoryStatus.BORROWED,
}


@dataclass
class InventoryCasSummary:
    cas_number: str
    item_count: int = 0
    preferred_name: str | None = None
    preferred_name_source: str | None = None
    english_name: str | None = None
    locations: list[str] = field(default_factory=list)
    total_by_unit: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "cas_number": self.cas_number,
            "item_count": self.item_count,
            "preferred_name": self.preferred_name,
            "preferred_name_source": self.preferred_name_source,
            "display_name": self.preferred_name,
            "english_name": self.english_name,
            "locations": self.locations,
            "total_by_unit": self.total_by_unit,
        }


def get_inventory_summaries_by_cas(
    db: Session,
    cas_numbers: list[str],
    *,
    only_in_stock: bool,
) -> dict[str, InventoryCasSummary]:
    """Aggregate inventory rows for normalized CAS numbers while preserving lookup keys."""
    normalized_order = _normalize_cas_order(cas_numbers)
    if not normalized_order:
        return {}
    rows = _load_inventory_rows(db, normalized_order, only_in_stock=only_in_stock)
    summaries = {cas_number: InventoryCasSummary(cas_number) for cas_number in normalized_order}
    for row in rows:
        summary = summaries.get(normalize_cas(row.cas_number))
        if summary is not None:
            _add_inventory_row(summary, row)
    if only_in_stock:
        return {cas: summary for cas, summary in summaries.items() if summary.item_count > 0}
    return summaries


def get_visible_inventory_cas_numbers(db: Session) -> set[str]:
    """Return normalized CAS values that currently have visible stock rows."""
    rows = db.exec(
        select(func.distinct(normalized_inventory_cas_expr()))
        .where(Inventory.cas_number != "")
        .where(Inventory.status.in_(VISIBLE_STOCK_STATUSES))
    ).all()
    return {normalized for row in rows if (normalized := normalize_cas(row))}


def _normalize_cas_order(cas_numbers: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized_order: list[str] = []
    for cas_number in cas_numbers:
        normalized = normalize_cas(cas_number)
        if normalized and normalized not in seen:
            seen.add(normalized)
            normalized_order.append(normalized)
    return normalized_order


def _load_inventory_rows(
    db: Session,
    cas_numbers: list[str],
    *,
    only_in_stock: bool,
) -> list[Inventory]:
    statement = select(Inventory).where(normalized_inventory_cas_expr().in_(cas_numbers))
    if only_in_stock:
        statement = statement.where(Inventory.status.in_(VISIBLE_STOCK_STATUSES))
    return list(db.exec(statement.order_by(Inventory.created_at.desc())).all())


def normalized_inventory_cas_expr():
    return func.replace(
        func.replace(
            func.replace(func.trim(Inventory.cas_number), "－", "-"),
            "–",
            "-",
        ),
        "—",
        "-",
    )


def _add_inventory_row(summary: InventoryCasSummary, row: Inventory) -> None:
    summary.item_count += 1
    if summary.preferred_name is None and row.name:
        summary.preferred_name = row.name
        summary.preferred_name_source = "inventory_name"
    if summary.english_name is None and row.english_name:
        summary.english_name = row.english_name
    if row.storage_location and row.storage_location not in summary.locations:
        summary.locations.append(row.storage_location)
    if row.unit:
        summary.total_by_unit[row.unit] = summary.total_by_unit.get(row.unit, 0.0) + (
            row.remaining_quantity or 0.0
        )
