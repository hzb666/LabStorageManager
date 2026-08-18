"""SQLite schema consistency checks."""
from __future__ import annotations

import logging

from sqlalchemy import Connection, inspect
from sqlmodel import SQLModel

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_index_column_names(index) -> list[str]:
    """Extract column names from plain and ASC/DESC index expressions."""
    column_names: list[str] = []
    for expression in index.expressions:
        column = getattr(expression, "element", expression)
        column_name = getattr(column, "name", None)
        if column_name is None:
            column_name = getattr(column, "element", None)
        if column_name:
            column_names.append(str(column_name))
    return column_names


def check_sqlite_schema_consistency(connection: Connection) -> None:
    inspector = inspect(connection)
    metadata = SQLModel.metadata

    mismatch_messages: list[str] = []

    for table_name, table in metadata.tables.items():
        if not inspector.has_table(table_name):
            mismatch_messages.append(f"table {table_name} is missing in database")
            continue

        db_columns = {column["name"] for column in inspector.get_columns(table_name)}
        model_columns = {column.name for column in table.columns}

        missing_columns = sorted(model_columns - db_columns)
        extra_columns = sorted(db_columns - model_columns)
        if missing_columns:
            mismatch_messages.append(
                f"table {table_name} missing columns: {', '.join(missing_columns)}"
            )
        if extra_columns:
            mismatch_messages.append(
                f"table {table_name} has extra columns: {', '.join(extra_columns)}"
            )

        expected_indexes = {
            index.name: _get_index_column_names(index)
            for index in table.indexes
            if index.name
        }
        actual_indexes = {
            index["name"]: index.get("column_names") or []
            for index in inspector.get_indexes(table_name)
            if index.get("name")
        }

        missing_indexes = sorted(set(expected_indexes) - set(actual_indexes))
        extra_indexes = sorted(
            index_name
            for index_name in (set(actual_indexes) - set(expected_indexes))
            if not index_name.startswith("sqlite_autoindex_")
        )
        if missing_indexes:
            mismatch_messages.append(
                f"table {table_name} missing indexes: {', '.join(missing_indexes)}"
            )
        if extra_indexes:
            mismatch_messages.append(
                f"table {table_name} has extra indexes: {', '.join(extra_indexes)}"
            )

        common_indexes = sorted(set(expected_indexes) & set(actual_indexes))
        for index_name in common_indexes:
            expected_columns = expected_indexes[index_name]
            actual_columns = actual_indexes[index_name]
            if expected_columns != actual_columns:
                mismatch_messages.append(
                    f"table {table_name} index {index_name} column mismatch: "
                    f"model={expected_columns}, db={actual_columns}"
                )

    if mismatch_messages:
        message = " | ".join(mismatch_messages)
        logger.warning(
            "SQLite schema consistency check found mismatches (%d): %s. "
            "Manual migration is required.",
            len(mismatch_messages),
            message,
        )
        if settings.use_secure_runtime():
            raise RuntimeError(
                "SQLite schema consistency check failed in secure runtime. "
                f"Manual migration is required: {message}"
            )
    else:
        logger.info("SQLite schema consistency check passed for all SQLModel tables.")
