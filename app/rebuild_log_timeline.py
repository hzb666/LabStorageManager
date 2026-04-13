"""Rebuild the log timeline read model from source log tables."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, select

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import engine, init_db
from app.models.common_shelf_operation_log import CommonShelfOperationLog
from app.models.consumable_order_operation_log import ConsumableOrderOperationLog
from app.models.inventory import BorrowLog, Inventory
from app.models.inventory_operation_log import InventoryOperationLog
from app.models.log_timeline import LogTimeline
from app.models.reagent_order_operation_log import ReagentOrderOperationLog
from app.models.user_operation_log import UserOperationLog
from app.services.log_timeline_projection import (
    project_borrow_log,
    project_common_shelf_operation_log,
    project_consumable_order_operation_log,
    project_inventory_operation_log,
    project_reagent_order_operation_log,
    project_user_operation_log,
)


@dataclass(frozen=True)
class RebuildResult:
    source_name: str
    source_count: int
    inserted_count: int
    conflicts: int


def _clear_log_timeline_tables() -> None:
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM log_timeline"))
        connection.execute(text("DELETE FROM log_timeline_fts"))


def _rebuild_inventory_operation_logs(db: Session) -> RebuildResult:
    logs = db.exec(
        select(InventoryOperationLog).order_by(InventoryOperationLog.id.asc())
    ).all()
    for log in logs:
        project_inventory_operation_log(db, log=log, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="inventory_operation_log",
        source_count=len(logs),
        inserted_count=len(logs),
        conflicts=0,
    )


def _rebuild_reagent_order_operation_logs(db: Session) -> RebuildResult:
    logs = db.exec(
        select(ReagentOrderOperationLog).order_by(ReagentOrderOperationLog.id.asc())
    ).all()
    for log in logs:
        project_reagent_order_operation_log(db, log=log, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="reagent_order_operation_log",
        source_count=len(logs),
        inserted_count=len(logs),
        conflicts=0,
    )


def _rebuild_consumable_order_operation_logs(db: Session) -> RebuildResult:
    logs = db.exec(
        select(ConsumableOrderOperationLog).order_by(ConsumableOrderOperationLog.id.asc())
    ).all()
    for log in logs:
        project_consumable_order_operation_log(db, log=log, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="consumable_order_operation_log",
        source_count=len(logs),
        inserted_count=len(logs),
        conflicts=0,
    )


def _rebuild_common_shelf_operation_logs(db: Session) -> RebuildResult:
    logs = db.exec(
        select(CommonShelfOperationLog).order_by(CommonShelfOperationLog.id.asc())
    ).all()
    for log in logs:
        project_common_shelf_operation_log(db, log=log, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="common_shelf_operation_log",
        source_count=len(logs),
        inserted_count=len(logs),
        conflicts=0,
    )


def _rebuild_user_operation_logs(db: Session) -> RebuildResult:
    logs = db.exec(
        select(UserOperationLog).order_by(UserOperationLog.id.asc())
    ).all()
    for log in logs:
        project_user_operation_log(db, log=log, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="user_operation_log",
        source_count=len(logs),
        inserted_count=len(logs),
        conflicts=0,
    )


def _rebuild_borrow_logs(db: Session) -> RebuildResult:
    rows = db.exec(
        select(BorrowLog, Inventory)
        .join(Inventory, BorrowLog.inventory_id == Inventory.id)
        .order_by(BorrowLog.id.asc())
    ).all()
    for borrow_log, inventory in rows:
        project_borrow_log(db, log=borrow_log, inventory=inventory, is_cli=False)
    db.commit()
    return RebuildResult(
        source_name="borrowlog",
        source_count=len(rows),
        inserted_count=len(rows),
        conflicts=0,
    )


def _count_log_timeline_rows() -> int:
    with Session(engine) as db:
        return len(db.exec(select(LogTimeline.id)).all())


def main() -> int:
    init_db()
    _clear_log_timeline_tables()

    print("warning: rebuild defaults all log_timeline.is_cli to false when source logs lack origin truth")

    with Session(engine) as db:
        results = [
            _rebuild_inventory_operation_logs(db),
            _rebuild_reagent_order_operation_logs(db),
            _rebuild_consumable_order_operation_logs(db),
            _rebuild_common_shelf_operation_logs(db),
            _rebuild_user_operation_logs(db),
            _rebuild_borrow_logs(db),
        ]

    total_inserted = 0
    for result in results:
        total_inserted += result.inserted_count
        print(
            f"{result.source_name}: source={result.source_count} "
            f"timeline={result.inserted_count} conflicts={result.conflicts}"
        )

    final_count = _count_log_timeline_rows()
    print(f"log_timeline_total={final_count}")
    return 0 if final_count == total_inserted else 1


if __name__ == "__main__":
    raise SystemExit(main())
