"""SQLite / database compatibility helpers.

SQLAlchemy's ``.returning()`` on DELETE/UPDATE statements, and raw SQL ``RETURNING``
clauses, both require SQLite >= 3.35.0 (released 2021-03-12).  This module exposes
a runtime flag and ready-to-use helpers so every call site can fall back gracefully
to a SELECT-then-DELETE pattern when running on an older SQLite build.
"""
from __future__ import annotations

import sqlite3
from typing import TypeVar

from sqlmodel import Session, SQLModel, select

# SQLAlchemy .returning() 和原生 RETURNING 都需要 SQLite >= 3.35.0。
SQLITE_SUPPORTS_RETURNING: bool = (
    tuple(int(x) for x in sqlite3.sqlite_version.split(".")) >= (3, 35, 0)
)

_ModelT = TypeVar("_ModelT", bound=SQLModel)


def exec_delete_returning_first(
    db: Session,
    delete_stmt,
    model_cls: type[_ModelT],
) -> _ModelT | None:
    """Execute ``DELETE … RETURNING`` and return the first deleted row as a model instance.

    Falls back to SELECT + DELETE within the same transaction on SQLite < 3.35.
    """
    if SQLITE_SUPPORTS_RETURNING:
        row = db.exec(delete_stmt.returning(*model_cls.__table__.columns)).first()
        if row is None:
            return None
        return model_cls.model_validate(dict(row._mapping))
    # 旧 SQLite 先读取单行，再执行删除。
    existing = db.exec(select(model_cls).where(delete_stmt.whereclause)).first()
    if existing is None:
        return None
    db.exec(delete_stmt)
    return existing


def exec_delete_returning_all(
    db: Session,
    delete_stmt,
    model_cls: type[_ModelT],
) -> list[_ModelT]:
    """Execute ``DELETE … RETURNING`` and return all deleted rows as model instances.

    Falls back to SELECT + DELETE within the same transaction on SQLite < 3.35.
    """
    if SQLITE_SUPPORTS_RETURNING:
        rows = db.exec(delete_stmt.returning(*model_cls.__table__.columns)).all()
        return [model_cls.model_validate(dict(row._mapping)) for row in rows]
    # 旧 SQLite 先读取全部匹配行，再执行删除。
    existing = db.exec(select(model_cls).where(delete_stmt.whereclause)).all()
    if not existing:
        return []
    db.exec(delete_stmt)
    return existing
