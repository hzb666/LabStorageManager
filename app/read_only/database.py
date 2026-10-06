from __future__ import annotations

import sqlite3
from collections.abc import Generator

from sqlalchemy import event
from sqlalchemy.pool import NullPool
from sqlmodel import Session, create_engine

from app.read_only.snapshot import resolve_snapshot_path


def _connect_snapshot() -> sqlite3.Connection:
    path = resolve_snapshot_path()
    return sqlite3.connect(
        f"{path.as_uri()}?mode=ro&immutable=1",
        uri=True,
        check_same_thread=False,
        timeout=1,
    )


snapshot_engine = create_engine(
    "sqlite://",
    creator=_connect_snapshot,
    poolclass=NullPool,
)


@event.listens_for(snapshot_engine, "connect")
def _configure_read_only_connection(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA query_only=ON")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=1000")
    cursor.close()


def get_snapshot_db() -> Generator[Session, None, None]:
    with Session(snapshot_engine, autoflush=False, expire_on_commit=False) as session:
        yield session
