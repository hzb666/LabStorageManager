"""Archive historical search query logs into standalone SQLite files."""
from __future__ import annotations

import argparse
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.core.time_utils import get_utc_now, format_sqlite_datetime, subtract_months
from app.search_query_log_db import QUERY_LOG_DB_PATH

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_MONTHS = 3


@dataclass(frozen=True)
class LogTableConfig:
    table_name: str
    time_column: str
    enabled: bool = True


QUERY_LOG_TABLE_MAP: dict[str, LogTableConfig] = {
    "search_logs": LogTableConfig(
        table_name="search_logs",
        time_column="created_at",
        enabled=True,
    ),
}


@dataclass(frozen=True)
class TableArchivePlan:
    logical_name: str
    config: LogTableConfig
    row_count: int


@dataclass(frozen=True)
class ArchiveResult:
    logical_name: str
    table_name: str
    archived_rows: int
    deleted_rows: int


def _quote_identifier(name: str) -> str:
    if not name or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for char in name):
        raise ValueError(f"Invalid identifier: {name}")
    return f'"{name}"'


def _resolve_cutoff(now: datetime) -> datetime:
    return subtract_months(now, ARCHIVE_MONTHS)


def _resolve_output_dir(output_dir: str) -> Path:
    candidate = Path(output_dir)
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate


def _build_archive_path(output_dir: Path, now: datetime) -> Path:
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    return output_dir / f"query-log-archive-{timestamp}.db"


def _open_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=3000;")
    return connection


def _get_table_sql(connection: sqlite3.Connection, table_name: str) -> str:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    if row is None or not row["sql"]:
        raise ValueError(f"Table schema not found: {table_name}")
    return str(row["sql"])


def _get_index_sqls(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(
        """
        SELECT sql
        FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
        ORDER BY name
        """,
        (table_name,),
    ).fetchall()
    return [str(row["sql"]) for row in rows if row["sql"]]


def _get_table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({_quote_identifier(table_name)})").fetchall()
    columns = [str(row["name"]) for row in rows]
    if not columns:
        raise ValueError(f"No columns found for table: {table_name}")
    return columns


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _count_archivable_rows(
    connection: sqlite3.Connection,
    config: LogTableConfig,
    cutoff: datetime,
) -> int:
    if not _table_exists(connection, config.table_name):
        return 0

    row = connection.execute(
        f"""
        SELECT COUNT(*)
        FROM {_quote_identifier(config.table_name)}
        WHERE {_quote_identifier(config.time_column)} < ?
        """,
        (format_sqlite_datetime(cutoff),),
    ).fetchone()
    return int(row[0]) if row is not None else 0


def _create_archive_meta_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS archive_meta (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            archived_at TEXT NOT NULL,
            source_db_path TEXT NOT NULL,
            archive_db_path TEXT NOT NULL,
            table_name TEXT NOT NULL,
            time_column TEXT NOT NULL,
            cutoff_at TEXT NOT NULL,
            row_count INTEGER NOT NULL
        )
        """
    )


def _copy_table_schema(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table_name: str,
) -> None:
    target.execute(_get_table_sql(source, table_name))
    for index_sql in _get_index_sqls(source, table_name):
        target.execute(index_sql)


def _copy_table_rows(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    config: LogTableConfig,
    cutoff: datetime,
) -> int:
    columns = _get_table_columns(source, config.table_name)
    quoted_columns = ", ".join(_quote_identifier(column) for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    cutoff_value = format_sqlite_datetime(cutoff)

    read_cursor = source.execute(
        f"""
        SELECT {quoted_columns}
        FROM {_quote_identifier(config.table_name)}
        WHERE {_quote_identifier(config.time_column)} < ?
        """,
        (cutoff_value,),
    )
    write_sql = (
        f"INSERT INTO {_quote_identifier(config.table_name)} ({quoted_columns}) "
        f"VALUES ({placeholders})"
    )

    inserted = 0
    while True:
        rows = read_cursor.fetchmany(1000)
        if not rows:
            break
        payload = [tuple(row[column] for column in columns) for row in rows]
        target.executemany(write_sql, payload)
        inserted += len(payload)
    return inserted


def _insert_archive_meta_rows(
    connection: sqlite3.Connection,
    *,
    batch_id: str,
    archived_at: datetime,
    source_db_path_value: str,
    archive_db_path_value: str,
    cutoff: datetime,
    results: Iterable[ArchiveResult],
) -> None:
    payload = [
        (
            batch_id,
            format_sqlite_datetime(archived_at),
            source_db_path_value,
            archive_db_path_value,
            result.table_name,
            QUERY_LOG_TABLE_MAP[result.logical_name].time_column,
            format_sqlite_datetime(cutoff),
            result.archived_rows,
        )
        for result in results
    ]
    connection.executemany(
        """
        INSERT INTO archive_meta (
            batch_id,
            archived_at,
            source_db_path,
            archive_db_path,
            table_name,
            time_column,
            cutoff_at,
            row_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        payload,
    )


def _delete_archived_rows(
    connection: sqlite3.Connection,
    plans: list[TableArchivePlan],
    cutoff: datetime,
) -> list[ArchiveResult]:
    cutoff_value = format_sqlite_datetime(cutoff)
    results: list[ArchiveResult] = []
    connection.execute("BEGIN IMMEDIATE")
    try:
        for plan in plans:
            cursor = connection.execute(
                f"""
                DELETE FROM {_quote_identifier(plan.config.table_name)}
                WHERE {_quote_identifier(plan.config.time_column)} < ?
                """,
                (cutoff_value,),
            )
            deleted_rows = int(cursor.rowcount if cursor.rowcount is not None else 0)
            if deleted_rows != plan.row_count:
                raise RuntimeError(
                    f"Deleted row count mismatch for {plan.config.table_name}: "
                    f"expected {plan.row_count}, got {deleted_rows}"
                )
            results.append(
                ArchiveResult(
                    logical_name=plan.logical_name,
                    table_name=plan.config.table_name,
                    archived_rows=plan.row_count,
                    deleted_rows=deleted_rows,
                )
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return results


def _resolve_selected_tables(requested_tables: list[str]) -> list[str]:
    selected: list[str] = []
    for table_name in requested_tables:
        if table_name not in QUERY_LOG_TABLE_MAP:
            raise ValueError(f"Unknown query log table: {table_name}")
        config = QUERY_LOG_TABLE_MAP[table_name]
        if not config.enabled:
            raise ValueError(f"Query log table is disabled: {table_name}")
        if table_name not in selected:
            selected.append(table_name)
    return selected


def _build_archive_plan(
    connection: sqlite3.Connection,
    selected_tables: list[str],
    cutoff: datetime,
) -> list[TableArchivePlan]:
    plans: list[TableArchivePlan] = []
    for logical_name in selected_tables:
        config = QUERY_LOG_TABLE_MAP[logical_name]
        plans.append(
            TableArchivePlan(
                logical_name=logical_name,
                config=config,
                row_count=_count_archivable_rows(connection, config, cutoff),
            )
        )
    return plans


def _print_plan_summary(
    plans: list[TableArchivePlan],
    *,
    cutoff: datetime,
    dry_run: bool,
    archive_path: Path | None,
) -> None:
    print(f"dry_run={str(dry_run).lower()}")
    print(f"cutoff={format_sqlite_datetime(cutoff)}")
    if archive_path is not None:
        print(f"archive_path={archive_path}")
    for plan in plans:
        print(
            f"table={plan.logical_name} "
            f"physical={plan.config.table_name} "
            f"rows={plan.row_count}"
        )


def _run_archive(
    *,
    source_db_path: Path,
    output_dir: Path,
    selected_tables: list[str],
    dry_run: bool,
    emit_summary: bool = True,
) -> int:
    if not source_db_path.exists():
        raise FileNotFoundError(f"Source database not found: {source_db_path}")

    now = get_utc_now()
    cutoff = _resolve_cutoff(now)

    with _open_connection(source_db_path) as source_connection:
        plans = _build_archive_plan(source_connection, selected_tables, cutoff)
        total_rows = sum(plan.row_count for plan in plans)
        archivable_plans = [plan for plan in plans if plan.row_count > 0]
        if total_rows == 0:
            if emit_summary:
                _print_plan_summary(plans, cutoff=cutoff, dry_run=dry_run, archive_path=None)
                print("No rows eligible for archive.")
            return 0

        if dry_run:
            if emit_summary:
                _print_plan_summary(plans, cutoff=cutoff, dry_run=True, archive_path=None)
            return 0

        output_dir.mkdir(parents=True, exist_ok=True)
        archive_path = _build_archive_path(output_dir, now)
        if archive_path.exists():
            raise FileExistsError(f"Archive database already exists: {archive_path}")
        batch_id = uuid.uuid4().hex
        copied_results: list[ArchiveResult] = []

        try:
            with _open_connection(archive_path) as archive_connection:
                archive_connection.execute("BEGIN")
                try:
                    _create_archive_meta_table(archive_connection)
                    for plan in archivable_plans:
                        _copy_table_schema(source_connection, archive_connection, plan.config.table_name)
                        copied_rows = _copy_table_rows(
                            source_connection,
                            archive_connection,
                            plan.config,
                            cutoff,
                        )
                        if copied_rows != plan.row_count:
                            raise RuntimeError(
                                f"Archived row count mismatch for {plan.config.table_name}: "
                                f"expected {plan.row_count}, got {copied_rows}"
                            )
                        copied_results.append(
                            ArchiveResult(
                                logical_name=plan.logical_name,
                                table_name=plan.config.table_name,
                                archived_rows=copied_rows,
                                deleted_rows=0,
                            )
                        )

                    _insert_archive_meta_rows(
                        archive_connection,
                        batch_id=batch_id,
                        archived_at=now,
                        source_db_path_value=str(source_db_path),
                        archive_db_path_value=str(archive_path),
                        cutoff=cutoff,
                        results=copied_results,
                    )
                    archive_connection.commit()
                except Exception:
                    archive_connection.rollback()
                    raise

            deleted_results = _delete_archived_rows(source_connection, archivable_plans, cutoff)
        except Exception:
            if archive_path.exists():
                archive_path.unlink(missing_ok=True)
            raise

    if emit_summary:
        _print_plan_summary(plans, cutoff=cutoff, dry_run=False, archive_path=archive_path)
        for result in deleted_results:
            print(
                f"archived_table={result.logical_name} "
                f"archived_rows={result.archived_rows} "
                f"deleted_rows={result.deleted_rows}"
            )
    return 0


def resolve_query_log_archive_output_dir(output_dir: str | Path) -> Path:
    """Resolve the archive output directory using the CLI-compatible rules."""
    return _resolve_output_dir(str(output_dir))


def run_query_log_archive(
    *,
    output_dir: str | Path | None = None,
    selected_tables: list[str] | None = None,
    dry_run: bool = False,
    emit_summary: bool = True,
) -> int:
    """Archive search query logs for backend services and CLI callers."""
    requested_tables = selected_tables
    if requested_tables is None:
        requested_tables = [
            name for name, config in QUERY_LOG_TABLE_MAP.items() if config.enabled
        ]
    return _run_archive(
        source_db_path=QUERY_LOG_DB_PATH,
        output_dir=resolve_query_log_archive_output_dir(output_dir or settings.query_log_dir),
        selected_tables=_resolve_selected_tables(list(requested_tables)),
        dry_run=dry_run,
        emit_summary=emit_summary,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Archive historical search query logs into a standalone SQLite file.")
    parser.add_argument(
        "--tables",
        nargs="+",
        default=[name for name, config in QUERY_LOG_TABLE_MAP.items() if config.enabled],
        help="Logical query log table names to archive",
    )
    parser.add_argument(
        "--output-dir",
        default=settings.query_log_dir,
        help="Directory for archive database files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print archive statistics without writing files or deleting source rows",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        return run_query_log_archive(
            output_dir=args.output_dir,
            selected_tables=list(args.tables),
            dry_run=bool(args.dry_run),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Archive failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
