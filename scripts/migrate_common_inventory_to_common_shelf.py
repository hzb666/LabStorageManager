"""一次性把 legacy common_inventory 迁移到 CommonShelf 新表。"""

from __future__ import annotations

import argparse
import shutil
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Connection, event, inspect, text
from sqlmodel import SQLModel, create_engine

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models  # noqa: F401
from app.database import (
    db_path as DEFAULT_DB_PATH,
    ensure_sqlite_inventory_fts,
    ensure_sqlite_performance_indexes,
)
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.pinyin_utils import PINYIN_FIELD_MAX_LENGTH, to_pinyin_parts

LEGACY_TABLE = "common_inventory"
LEGACY_LOG_TABLE = "common_inventory_operation_log"
TARGET_TABLE = "common_shelf"
TARGET_LOG_TABLE = "common_shelf_operation_log"
NAME_MAP_TABLE = "chemical_name_map"


@dataclass(frozen=True)
class MigrationSummary:
    legacy_rows: int
    legacy_log_rows: int
    target_rows_before: int
    target_log_rows_before: int
    rows_to_insert: int
    log_rows_to_insert: int
    name_map_rows_to_insert: int


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


def _ensure_target_schema(engine) -> None:
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        ensure_sqlite_performance_indexes(connection)
        ensure_sqlite_inventory_fts(connection)


def _table_exists(connection: Connection, table_name: str) -> bool:
    return inspect(connection).has_table(table_name)


def _count_rows(connection: Connection, table_name: str) -> int:
    return int(connection.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one() or 0)


def _shared_columns(connection: Connection, source_table: str, target_table: str) -> list[str]:
    inspector = inspect(connection)
    source_columns = {column["name"] for column in inspector.get_columns(source_table)}
    target_columns = [column["name"] for column in inspector.get_columns(target_table)]
    return [column for column in target_columns if column in source_columns]


def _check_common_shelf_conflicts(connection: Connection) -> None:
    id_conflicts = connection.execute(
        text(
            f"""
            SELECT legacy.id, legacy.internal_code, target.internal_code AS target_internal_code
            FROM {LEGACY_TABLE} AS legacy
            JOIN {TARGET_TABLE} AS target ON target.id = legacy.id
            WHERE COALESCE(target.internal_code, '') != COALESCE(legacy.internal_code, '')
            LIMIT 10
            """
        )
    ).mappings().all()
    if id_conflicts:
        raise RuntimeError(f"发现 {TARGET_TABLE}.id 已占用且 internal_code 不一致，示例: {id_conflicts}")

    code_conflicts = connection.execute(
        text(
            f"""
            SELECT legacy.id, legacy.internal_code, target.id AS target_id
            FROM {LEGACY_TABLE} AS legacy
            JOIN {TARGET_TABLE} AS target ON target.internal_code = legacy.internal_code
            WHERE target.id != legacy.id
            LIMIT 10
            """
        )
    ).mappings().all()
    if code_conflicts:
        raise RuntimeError(f"发现 {TARGET_TABLE}.internal_code 已占用但 id 不一致，示例: {code_conflicts}")


def _check_common_shelf_log_conflicts(connection: Connection) -> None:
    conflicts = connection.execute(
        text(
            f"""
            SELECT legacy.id, legacy.common_inventory_id, target.common_shelf_id, legacy.action, target.action AS target_action
            FROM {LEGACY_LOG_TABLE} AS legacy
            JOIN {TARGET_LOG_TABLE} AS target ON target.id = legacy.id
            WHERE target.common_shelf_id != legacy.common_inventory_id
               OR COALESCE(target.action, '') != COALESCE(legacy.action, '')
            LIMIT 10
            """
        )
    ).mappings().all()
    if conflicts:
        raise RuntimeError(f"发现 {TARGET_LOG_TABLE}.id 已占用且日志内容不一致，示例: {conflicts}")


def _validate_legacy_cas_numbers(connection: Connection) -> None:
    rows = connection.execute(
        text(f"SELECT id, cas_number FROM {LEGACY_TABLE} ORDER BY id ASC")
    ).mappings().all()
    invalid_rows: list[dict[str, object]] = []
    for row in rows:
        cas_number = normalize_cas(str(row["cas_number"] or ""))
        is_valid, error_message = validate_cas_format(cas_number)
        if not cas_number or not is_valid:
            invalid_rows.append(
                {
                    "id": row["id"],
                    "cas_number": row["cas_number"],
                    "error": error_message,
                }
            )
        if len(invalid_rows) >= 10:
            break

    if invalid_rows:
        raise RuntimeError(f"legacy common_inventory 存在非法 CAS，示例: {invalid_rows}")


def _truncate_pinyin(value: str) -> str:
    return value[:PINYIN_FIELD_MAX_LENGTH] if len(value) > PINYIN_FIELD_MAX_LENGTH else value


def _build_missing_name_map_rows(connection: Connection) -> list[dict[str, object]]:
    existing_cas_numbers = {
        str(row["cas_number"])
        for row in connection.execute(text(f"SELECT cas_number FROM {NAME_MAP_TABLE}")).mappings().all()
        if row["cas_number"]
    }
    legacy_rows = connection.execute(
        text(
            f"""
            SELECT cas_number, name_snapshot, created_at, updated_at, id
            FROM {LEGACY_TABLE}
            WHERE TRIM(COALESCE(cas_number, '')) != ''
              AND TRIM(COALESCE(name_snapshot, '')) != ''
            ORDER BY cas_number ASC, updated_at DESC, id DESC
            """
        )
    ).mappings().all()

    latest_by_cas: dict[str, dict[str, object]] = {}
    for row in legacy_rows:
        normalized_cas = normalize_cas(str(row["cas_number"] or ""))
        if not normalized_cas or normalized_cas in existing_cas_numbers or normalized_cas in latest_by_cas:
            continue
        latest_by_cas[normalized_cas] = dict(row)

    inserts: list[dict[str, object]] = []
    for cas_number, row in latest_by_cas.items():
        name = str(row["name_snapshot"]).strip()
        name_pinyin, name_initials = to_pinyin_parts(name)
        inserts.append(
            {
                "cas_number": cas_number,
                "name": name,
                "english_name": None,
                "alias_1": None,
                "alias_2": None,
                "alias_3": None,
                "category": None,
                "name_pinyin": _truncate_pinyin(name_pinyin) if name_pinyin else None,
                "name_initials": _truncate_pinyin(name_initials) if name_initials else None,
                "alias_1_pinyin": None,
                "alias_1_initials": None,
                "alias_2_pinyin": None,
                "alias_2_initials": None,
                "alias_3_pinyin": None,
                "alias_3_initials": None,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"] or row["created_at"],
            }
        )
    return inserts


def _build_summary(connection: Connection) -> MigrationSummary:
    legacy_rows = _count_rows(connection, LEGACY_TABLE) if _table_exists(connection, LEGACY_TABLE) else 0
    legacy_log_rows = _count_rows(connection, LEGACY_LOG_TABLE) if _table_exists(connection, LEGACY_LOG_TABLE) else 0
    target_rows_before = _count_rows(connection, TARGET_TABLE)
    target_log_rows_before = _count_rows(connection, TARGET_LOG_TABLE)

    rows_to_insert = int(
        connection.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM {LEGACY_TABLE} AS legacy
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM {TARGET_TABLE} AS target
                    WHERE target.id = legacy.id
                )
                """
            )
        ).scalar_one()
        or 0
    )
    log_rows_to_insert = int(
        connection.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM {LEGACY_LOG_TABLE} AS legacy
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM {TARGET_LOG_TABLE} AS target
                    WHERE target.id = legacy.id
                )
                """
            )
        ).scalar_one()
        or 0
    )
    name_map_rows_to_insert = len(_build_missing_name_map_rows(connection))
    return MigrationSummary(
        legacy_rows=legacy_rows,
        legacy_log_rows=legacy_log_rows,
        target_rows_before=target_rows_before,
        target_log_rows_before=target_log_rows_before,
        rows_to_insert=rows_to_insert,
        log_rows_to_insert=log_rows_to_insert,
        name_map_rows_to_insert=name_map_rows_to_insert,
    )


def _insert_common_shelf_rows(connection: Connection) -> int:
    shared_columns = _shared_columns(connection, LEGACY_TABLE, TARGET_TABLE)
    if not shared_columns:
        return 0

    column_clause = ", ".join(shared_columns)
    result = connection.execute(
        text(
            f"""
            INSERT INTO {TARGET_TABLE} ({column_clause})
            SELECT {column_clause}
            FROM {LEGACY_TABLE} AS legacy
            WHERE NOT EXISTS (
                SELECT 1
                FROM {TARGET_TABLE} AS target
                WHERE target.id = legacy.id
            )
            """
        )
    )
    return int(result.rowcount or 0)


def _insert_common_shelf_log_rows(connection: Connection) -> int:
    result = connection.execute(
        text(
            f"""
            INSERT INTO {TARGET_LOG_TABLE} (
                id,
                common_shelf_id,
                operator_id,
                action,
                created_at,
                item_name,
                cas_number,
                snapshot_json,
                notes
            )
            SELECT
                legacy.id,
                legacy.common_inventory_id,
                legacy.operator_id,
                legacy.action,
                legacy.created_at,
                legacy.item_name,
                legacy.cas_number,
                legacy.snapshot_json,
                legacy.notes
            FROM {LEGACY_LOG_TABLE} AS legacy
            WHERE NOT EXISTS (
                SELECT 1
                FROM {TARGET_LOG_TABLE} AS target
                WHERE target.id = legacy.id
            )
            """
        )
    )
    return int(result.rowcount or 0)


def _insert_name_map_rows(connection: Connection) -> int:
    rows = _build_missing_name_map_rows(connection)
    if not rows:
        return 0

    connection.execute(
        text(
            f"""
            INSERT INTO {NAME_MAP_TABLE} (
                cas_number,
                name,
                english_name,
                alias_1,
                alias_2,
                alias_3,
                category,
                name_pinyin,
                name_initials,
                alias_1_pinyin,
                alias_1_initials,
                alias_2_pinyin,
                alias_2_initials,
                alias_3_pinyin,
                alias_3_initials,
                created_at,
                updated_at
            ) VALUES (
                :cas_number,
                :name,
                :english_name,
                :alias_1,
                :alias_2,
                :alias_3,
                :category,
                :name_pinyin,
                :name_initials,
                :alias_1_pinyin,
                :alias_1_initials,
                :alias_2_pinyin,
                :alias_2_initials,
                :alias_3_pinyin,
                :alias_3_initials,
                :created_at,
                :updated_at
            )
            """
        ),
        rows,
    )
    return len(rows)


def _drop_legacy_tables(connection: Connection) -> None:
    connection.execute(text(f"DROP TABLE IF EXISTS {LEGACY_LOG_TABLE}"))
    connection.execute(text(f"DROP TABLE IF EXISTS {LEGACY_TABLE}"))


def _backup_database(database_path: Path) -> Path:
    backup_path = database_path.with_name(f"{database_path.stem}.pre_common_shelf_migration{database_path.suffix}")
    shutil.copy2(database_path, backup_path)
    return backup_path


def _print_summary(summary: MigrationSummary) -> None:
    print("迁移概览：")
    print(f"- legacy common_inventory 行数: {summary.legacy_rows}")
    print(f"- legacy common_inventory_operation_log 行数: {summary.legacy_log_rows}")
    print(f"- 目标 common_shelf 现有行数: {summary.target_rows_before}")
    print(f"- 目标 common_shelf_operation_log 现有行数: {summary.target_log_rows_before}")
    print(f"- 待插入 common_shelf 行数: {summary.rows_to_insert}")
    print(f"- 待插入 common_shelf_operation_log 行数: {summary.log_rows_to_insert}")
    print(f"- 待补齐 chemical_name_map 行数: {summary.name_map_rows_to_insert}")


def run_migration(*, database_path: Path, apply: bool, backup: bool, drop_legacy: bool) -> int:
    if not database_path.exists():
        raise FileNotFoundError(f"数据库文件不存在: {database_path}")

    working_database_path = database_path
    dry_run_copy_path: Path | None = None
    if not apply:
        dry_run_copy_path = database_path.with_name(
            f".{database_path.stem}.common_shelf_migration_dry_run_{uuid.uuid4().hex}{database_path.suffix}"
        )
        shutil.copy2(database_path, dry_run_copy_path)
        working_database_path = dry_run_copy_path

    if apply and backup:
        backup_path = _backup_database(database_path)
        print(f"已备份数据库: {backup_path}")

    engine = None
    try:
        engine = _build_engine(working_database_path)
        _ensure_target_schema(engine)

        with engine.begin() as connection:
            if not _table_exists(connection, LEGACY_TABLE):
                print(f"未发现旧表 {LEGACY_TABLE}，无需迁移。")
                return 0

            if not _table_exists(connection, LEGACY_LOG_TABLE):
                raise RuntimeError(f"缺少旧日志表 {LEGACY_LOG_TABLE}")

            _validate_legacy_cas_numbers(connection)
            _check_common_shelf_conflicts(connection)
            _check_common_shelf_log_conflicts(connection)

            summary = _build_summary(connection)
            _print_summary(summary)

            if not apply:
                print("dry-run 完成，未写入正式数据库。")
                return 0

            inserted_rows = _insert_common_shelf_rows(connection)
            inserted_log_rows = _insert_common_shelf_log_rows(connection)
            inserted_name_map_rows = _insert_name_map_rows(connection)

            if drop_legacy:
                _drop_legacy_tables(connection)

        print("迁移完成：")
        print(f"- 新增 common_shelf 行数: {inserted_rows}")
        print(f"- 新增 common_shelf_operation_log 行数: {inserted_log_rows}")
        print(f"- 新增 chemical_name_map 行数: {inserted_name_map_rows}")
        if drop_legacy:
            print("- 已删除 legacy 表 common_inventory / common_inventory_operation_log")
        return 0
    finally:
        if engine is not None:
            engine.dispose()
        if dry_run_copy_path is not None and dry_run_copy_path.exists():
            try:
                dry_run_copy_path.unlink()
            except PermissionError:
                print(f"警告：未能删除 dry-run 临时库 {dry_run_copy_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="把 legacy common_inventory 迁移到 CommonShelf 新表")
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
        help="写入前先备份数据库文件，只在 --apply 时生效",
    )
    parser.add_argument(
        "--drop-legacy",
        action="store_true",
        help="迁移成功后删除 legacy 表 common_inventory / common_inventory_operation_log",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return run_migration(
        database_path=args.database.resolve(),
        apply=args.apply,
        backup=args.backup,
        drop_legacy=args.drop_legacy,
    )


if __name__ == "__main__":
    raise SystemExit(main())
