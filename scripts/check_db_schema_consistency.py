"""Compare SQLModel metadata with SQLite schema and report mismatches."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from sqlalchemy import inspect
from sqlmodel import SQLModel

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models  # noqa: F401
from app.database import engine

IGNORED_EXTRA_TABLE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r".+_fts$"),
    re.compile(r".+_fts_(config|content|data|docsize|idx)$"),
    re.compile(r"sqlite_stat\d+$"),
)


def _is_ignored_extra_table(table_name: str) -> bool:
    return any(pattern.fullmatch(table_name) for pattern in IGNORED_EXTRA_TABLE_PATTERNS)


def build_report() -> dict[str, list[dict] | list[str]]:
    """Build a schema consistency report for tables, columns, indexes, FKs, and unique constraints."""
    insp = inspect(engine)
    meta = SQLModel.metadata

    report: dict[str, list[dict] | list[str]] = {
        "missing_tables": [],
        "extra_tables": [],
        "ignored_extra_tables": [],
        "column_mismatches": [],
        "index_mismatches": [],
        "fk_mismatches": [],
        "unique_mismatches": [],
    }

    model_tables = set(meta.tables.keys())
    db_tables = set(insp.get_table_names())

    report["missing_tables"] = sorted(model_tables - db_tables)
    raw_extra_tables = sorted(db_tables - model_tables)
    report["extra_tables"] = [table_name for table_name in raw_extra_tables if not _is_ignored_extra_table(table_name)]
    report["ignored_extra_tables"] = [table_name for table_name in raw_extra_tables if _is_ignored_extra_table(table_name)]

    for table_name, table in meta.tables.items():
        if table_name not in db_tables:
            continue

        db_cols = {col["name"]: col for col in insp.get_columns(table_name)}
        model_cols = {col.name: col for col in table.columns}

        missing_cols = sorted(set(model_cols) - set(db_cols))
        extra_cols = sorted(set(db_cols) - set(model_cols))
        if missing_cols or extra_cols:
            report["column_mismatches"].append(
                {
                    "table": table_name,
                    "missing_columns": missing_cols,
                    "extra_columns": extra_cols,
                }
            )

        for col_name in sorted(set(model_cols) & set(db_cols)):
            model_col = model_cols[col_name]
            db_col = db_cols[col_name]
            diffs: dict[str, dict[str, bool | str]] = {}

            model_type = str(model_col.type).upper()
            db_type = str(db_col["type"]).upper()
            if model_type != db_type:
                diffs["type"] = {"model": model_type, "db": db_type}

            model_nullable = bool(model_col.nullable)
            db_nullable = bool(db_col.get("nullable", True))
            if model_nullable != db_nullable:
                diffs["nullable"] = {"model": model_nullable, "db": db_nullable}

            model_pk = bool(model_col.primary_key)
            db_pk = bool(db_col.get("primary_key", False))
            if model_pk != db_pk:
                diffs["primary_key"] = {"model": model_pk, "db": db_pk}

            if diffs:
                report["column_mismatches"].append(
                    {
                        "table": table_name,
                        "column": col_name,
                        "diffs": diffs,
                    }
                )

        model_indexes = {
            index.name: [col.name for col in index.columns]
            for index in table.indexes
            if index.name
        }
        db_indexes = {
            index["name"]: index.get("column_names") or []
            for index in insp.get_indexes(table_name)
            if index.get("name")
        }

        missing_indexes = sorted(set(model_indexes) - set(db_indexes))
        extra_indexes = sorted(set(db_indexes) - set(model_indexes))
        if missing_indexes or extra_indexes:
            report["index_mismatches"].append(
                {
                    "table": table_name,
                    "missing_indexes": missing_indexes,
                    "extra_indexes": extra_indexes,
                }
            )

        for index_name in sorted(set(model_indexes) & set(db_indexes)):
            if model_indexes[index_name] != db_indexes[index_name]:
                report["index_mismatches"].append(
                    {
                        "table": table_name,
                        "index": index_name,
                        "model_columns": model_indexes[index_name],
                        "db_columns": db_indexes[index_name],
                    }
                )

        model_fks = set()
        for constraint in table.foreign_key_constraints:
            columns = tuple(col.name for col in constraint.columns)
            elements = list(constraint.elements)
            ref_table = elements[0].column.table.name if elements else None
            ref_columns = tuple(element.column.name for element in elements)
            ondelete = (constraint.ondelete or "").upper()
            onupdate = (constraint.onupdate or "").upper()
            model_fks.add((columns, ref_table, ref_columns, ondelete, onupdate))

        db_fks = set()
        for fk in insp.get_foreign_keys(table_name):
            columns = tuple(fk.get("constrained_columns") or [])
            ref_table = fk.get("referred_table")
            ref_columns = tuple(fk.get("referred_columns") or [])
            options = fk.get("options") or {}
            ondelete = str(options.get("ondelete") or "").upper()
            onupdate = str(options.get("onupdate") or "").upper()
            db_fks.add((columns, ref_table, ref_columns, ondelete, onupdate))

        missing_fks = sorted(model_fks - db_fks)
        extra_fks = sorted(db_fks - model_fks)
        if missing_fks or extra_fks:
            report["fk_mismatches"].append(
                {
                    "table": table_name,
                    "missing_fks": missing_fks,
                    "extra_fks": extra_fks,
                }
            )

        model_uniques = set()
        for constraint in table.constraints:
            if constraint.__class__.__name__ == "UniqueConstraint":
                model_uniques.add(tuple(col.name for col in constraint.columns))

        db_uniques = set()
        for unique in insp.get_unique_constraints(table_name):
            unique_columns = tuple(unique.get("column_names") or [])
            if unique_columns:
                db_uniques.add(unique_columns)

        missing_uniques = sorted(model_uniques - db_uniques)
        extra_uniques = sorted(db_uniques - model_uniques)
        if missing_uniques or extra_uniques:
            report["unique_mismatches"].append(
                {
                    "table": table_name,
                    "missing_uniques": missing_uniques,
                    "extra_uniques": extra_uniques,
                }
            )

    return report


def main() -> int:
    """Print report as JSON and return non-zero exit code when mismatches are found."""
    report = build_report()
    print(json.dumps(report, ensure_ascii=False, indent=2))

    mismatch_keys = (
        "missing_tables",
        "extra_tables",
        "column_mismatches",
        "index_mismatches",
        "fk_mismatches",
        "unique_mismatches",
    )
    has_mismatch = any(bool(report[key]) for key in mismatch_keys)
    return 1 if has_mismatch else 0


if __name__ == "__main__":
    raise SystemExit(main())
