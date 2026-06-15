"""给现有 SQLite 库补齐 purity / common_shelf.notes 字段。"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlmodel import SQLModel, create_engine

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models as _app_models  # noqa: E402,F401
import app.database as app_database  # noqa: E402

DEFAULT_DB_PATH = app_database.db_path
ensure_sqlite_inventory_fts = app_database.ensure_sqlite_inventory_fts
ensure_sqlite_performance_indexes = app_database.ensure_sqlite_performance_indexes

COLUMN_SPECS: dict[str, list[tuple[str, str]]] = {
    "reagent_order": [
        ("purity", "VARCHAR(20)"),
    ],
    "inventory": [
        ("purity", "VARCHAR(20)"),
    ],
    "common_shelf": [
        ("purity", "VARCHAR(20)"),
        ("notes", "VARCHAR(100)"),
    ],
}


def _build_engine(database_path: Path):
    engine = create_engine(
        f"sqlite:///{database_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=1000;")
        cursor.close()

    return engine


def _ensure_base_schema(engine) -> None:
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        ensure_sqlite_performance_indexes(connection)
        ensure_sqlite_inventory_fts(connection)


def _get_existing_columns(connection, table_name: str) -> set[str]:
    inspector = inspect(connection)
    return {column["name"] for column in inspector.get_columns(table_name)}


def run_migration(*, database_path: Path, apply: bool, backup: bool) -> int:
    if not database_path.exists():
        raise FileNotFoundError(f"数据库文件不存在: {database_path}")

    if apply and backup:
        backup_path = database_path.with_name(f"{database_path.stem}.pre_purity_notes_migration{database_path.suffix}")
        shutil.copy2(database_path, backup_path)
        print(f"已备份数据库: {backup_path}")

    engine = _build_engine(database_path)
    try:
        _ensure_base_schema(engine)
        planned_changes: list[str] = []

        with engine.begin() as connection:
            for table_name, columns in COLUMN_SPECS.items():
                existing_columns = _get_existing_columns(connection, table_name)
                for column_name, column_type in columns:
                    if column_name in existing_columns:
                        print(f"跳过 {table_name}.{column_name}，已存在")
                        continue

                    sql = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    planned_changes.append(sql)
                    if apply:
                        connection.execute(text(sql))
                        print(f"已执行: {sql}")
                    else:
                        print(f"计划执行: {sql}")

        if not planned_changes:
            print("无需迁移，目标字段都已存在。")
            return 0

        print("迁移完成。" if apply else "dry-run 完成，未写入数据库。")
        return 0
    finally:
        engine.dispose()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="给 reagent_order / inventory / common_shelf 补 purity 与 notes 字段")
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(DEFAULT_DB_PATH),
        help="SQLite 数据库路径，默认使用项目根目录 lab_inventory.db",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="真正写入数据库；默认仅 dry-run",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="写入前备份数据库文件，只在 --apply 时生效",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return run_migration(
        database_path=args.database.resolve(),
        apply=args.apply,
        backup=args.backup,
    )


if __name__ == "__main__":
    raise SystemExit(main())
