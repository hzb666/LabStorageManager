"""Create inventory_operation_log table and its indexes for existing SQLite databases."""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def main() -> None:
    from sqlalchemy import inspect, text
    from sqlmodel import SQLModel

    from app.database import SQLITE_INVENTORY_OPERATION_LOG_INDEX_UPGRADES, engine
    from app.models.inventory_operation_log import InventoryOperationLog

    inspector = inspect(engine)
    table_exists = inspector.has_table(InventoryOperationLog.__tablename__)

    SQLModel.metadata.create_all(engine, tables=[InventoryOperationLog.__table__])
    print(
        "inventory_operation_log table created"
        if not table_exists
        else "inventory_operation_log table already exists"
    )

    with engine.begin() as connection:
        existing_indexes = {
            index["name"]
            for index in inspect(connection).get_indexes(InventoryOperationLog.__tablename__)
            if index.get("name")
        }
        for statement in SQLITE_INVENTORY_OPERATION_LOG_INDEX_UPGRADES:
            index_name = statement.split("INDEX IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
            connection.execute(text(statement))
            if index_name in existing_indexes:
                print(f"{index_name} already exists")
            else:
                print(f"{index_name} created")


if __name__ == "__main__":
    main()
