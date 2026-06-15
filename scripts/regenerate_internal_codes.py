"""Regenerate inventory internal_code values with unlimited sequence width.

Usage:
    d:/Code/LabStorageManager/.venv/Scripts/python.exe scripts/regenerate_internal_codes.py
    d:/Code/LabStorageManager/.venv/Scripts/python.exe scripts/regenerate_internal_codes.py --apply
"""

from __future__ import annotations

import argparse
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlmodel import Session, select


from app.database import engine
from app.models.inventory import Inventory


@dataclass
class RegenerationPlan:
    """Planned internal code update for one inventory row."""

    item_id: int
    old_code: str
    new_code: str


def _date_fragment(created_at: datetime) -> str:
    """Convert creation time to yymmdd fragment used by internal code."""
    return created_at.strftime("%y%m%d")


def _cas_code_fragment(cas_number: str) -> str:
    """Build internal code CAS fragment by removing '-' characters."""
    return cas_number.replace("-", "")


def build_regeneration_plan(session: Session) -> list[RegenerationPlan]:
    """Build deterministic internal code regeneration plan.

    Sequence is generated per (cas_number, created_date) group and starts at 1.
    """
    statement = select(Inventory).order_by(Inventory.created_at.asc(), Inventory.id.asc())
    items = session.exec(statement).all()

    counters: dict[tuple[str, str], int] = {}
    plans: list[RegenerationPlan] = []

    for item in items:
        if item.id is None:
            raise ValueError("Inventory row without id cannot be regenerated")
        if not item.cas_number:
            raise ValueError(f"Inventory#{item.id} missing cas_number")
        if item.created_at is None:
            raise ValueError(f"Inventory#{item.id} missing created_at")

        cas = _cas_code_fragment(item.cas_number.strip())
        date_str = _date_fragment(item.created_at)
        key = (cas, date_str)

        next_seq = counters.get(key, 0) + 1
        counters[key] = next_seq

        new_code = f"{cas}-{date_str}-{next_seq}"
        plans.append(
            RegenerationPlan(
                item_id=item.id,
                old_code=item.internal_code,
                new_code=new_code,
            )
        )

    return plans


def apply_regeneration_plan(session: Session, plans: list[RegenerationPlan]) -> None:
    """Apply regeneration plan in two phases to avoid unique conflicts."""
    if not plans:
        return

    inventory_by_id = {
        item.id: item
        for item in session.exec(select(Inventory).where(Inventory.id.in_([p.item_id for p in plans]))).all()
        if item.id is not None
    }

    # 第一阶段写入临时唯一值，释放唯一索引压力。
    for plan in plans:
        item = inventory_by_id.get(plan.item_id)
        if item is None:
            raise ValueError(f"Inventory#{plan.item_id} not found during temp update")
        item.internal_code = f"TMP-{plan.item_id}-{uuid.uuid4().hex[:8]}"
        session.add(item)
    session.flush()

    # 第二阶段写入最终重建编码。
    for plan in plans:
        item = inventory_by_id.get(plan.item_id)
        if item is None:
            raise ValueError(f"Inventory#{plan.item_id} not found during final update")
        item.internal_code = plan.new_code
        session.add(item)

    session.flush()


def print_preview(plans: list[RegenerationPlan], limit: int = 20) -> None:
    """Print a preview of planned updates."""
    print(f"Total rows: {len(plans)}")
    changed = [p for p in plans if p.old_code != p.new_code]
    print(f"Rows to change: {len(changed)}")

    if not changed:
        print("No changes needed.")
        return

    print("Preview (first rows):")
    for plan in changed[:limit]:
        print(f"  id={plan.item_id}: {plan.old_code} -> {plan.new_code}")

    if len(changed) > limit:
        print(f"  ... and {len(changed) - limit} more")


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate inventory internal_code values")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply updates to database. Without this flag, script only prints preview.",
    )
    args = parser.parse_args()

    with Session(engine) as session:
        plans = build_regeneration_plan(session)
        print_preview(plans)

        if not args.apply:
            print("Dry run completed. Re-run with --apply to persist changes.")
            return

        apply_regeneration_plan(session, plans)
        session.commit()
        print("Regeneration applied successfully.")


if __name__ == "__main__":
    main()
